import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { FsError } from '../fs/memory.js';
import type { FileStat, FileSystem } from '../fs/types.js';
import { globMatch } from '../utils/glob.js';
import type { ChangeSet, FileChange, OverlayFsOptions } from './types.js';

export type { ChangeSet, FileChange, OverlayFsOptions } from './types.js';

/** Normalize a virtual path: resolve `.`, `..`, collapse double slashes. */
function normalizePath(input: string): string {
  if (!input.startsWith('/')) {
    throw new FsError('EINVAL', input, `Path must be absolute: ${input}`);
  }
  const segments: string[] = [];
  const parts = input.split('/');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Get parent directory of a normalized path. */
function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return path.slice(0, lastSlash);
}

/** Translate a native fs error to FsError. */
function translateError(err: unknown, path: string): FsError {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code;
    return new FsError(code, path);
  }
  return new FsError('EIO', path, String(err));
}

/**
 * Read-through overlay filesystem.
 *
 * Reads from a real host directory, writes to an in-memory layer.
 * The host filesystem is never modified. Use `getChanges()` to
 * retrieve a changeset of all modifications.
 */
export class OverlayFs implements FileSystem {
  private readonly root: string;
  private readonly allowPaths: string[] | undefined;
  private readonly denyPaths: string[] | undefined;
  private readonly memoryFiles: Map<string, string> = new Map();
  private readonly memoryDirs: Set<string> = new Set();
  private readonly deletedPaths: Set<string> = new Set();
  private readonly memoryModes: Map<string, number> = new Map();
  private readonly memoryTimes: Map<string, { mtime: Date; ctime: Date }> = new Map();
  private readonly hostExisted: Set<string> = new Set();
  private readonly memorySymlinks: Map<string, string> = new Map();

  constructor(root: string, options?: OverlayFsOptions) {
    // Resolve symlinks in root itself so safeHostPath checks work on macOS
    // where /tmp -> /private/tmp
    let resolvedRoot = nodePath.resolve(root);
    try {
      resolvedRoot = nodeFs.realpathSync(resolvedRoot);
    } catch {
      // Root doesn't exist yet; use the unresolved path
    }
    this.root = resolvedRoot;
    this.allowPaths = options?.allowPaths;
    this.denyPaths = options?.denyPaths;
    // Root always exists as a directory in the overlay
    this.memoryDirs.add('/');
  }

  /** Map virtual path to host filesystem path. */
  private hostPath(virtualPath: string): string {
    return nodePath.join(this.root, virtualPath);
  }

  /** Check if a virtual path is allowed by access control rules. */
  private isAllowed(virtualPath: string): boolean {
    if (this.denyPaths) {
      for (let i = 0; i < this.denyPaths.length; i++) {
        if (globMatch(this.denyPaths[i], virtualPath, true)) return false;
      }
    }
    if (this.allowPaths) {
      for (let i = 0; i < this.allowPaths.length; i++) {
        if (globMatch(this.allowPaths[i], virtualPath, true)) return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Resolve a host path via realpathSync and verify it stays under root.
   * Returns the resolved absolute host path, or throws EACCES if it escapes.
   */
  private safeHostPath(virtualPath: string): string {
    const raw = this.hostPath(virtualPath);
    let resolved: string;
    try {
      resolved = nodeFs.realpathSync(raw);
    } catch {
      // Path doesn't exist on host; return raw (caller handles ENOENT)
      return raw;
    }
    const resolvedNorm = nodePath.normalize(resolved);
    const rootNorm = nodePath.normalize(this.root);
    if (resolvedNorm !== rootNorm && !resolvedNorm.startsWith(`${rootNorm}${nodePath.sep}`)) {
      throw new FsError('EACCES', virtualPath, `path escapes overlay root: ${virtualPath}`);
    }
    return resolved;
  }

  /** Check if a path exists on the host filesystem. */
  private hostExists(virtualPath: string): boolean {
    try {
      nodeFs.statSync(this.safeHostPath(virtualPath));
      return true;
    } catch {
      return false;
    }
  }

  /** Check if a path is a directory on the host filesystem. */
  private hostIsDirectory(virtualPath: string): boolean {
    try {
      return nodeFs.statSync(this.hostPath(virtualPath)).isDirectory();
    } catch {
      return false;
    }
  }

  readFile(path: string): string {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    // Check memory first
    const memContent = this.memoryFiles.get(p);
    if (memContent !== undefined) return memContent;

    // Check memory symlinks
    const symlinkTarget = this.memorySymlinks.get(p);
    if (symlinkTarget) {
      const resolved = symlinkTarget.startsWith('/')
        ? symlinkTarget
        : normalizePath(`${parentDir(p)}/${symlinkTarget}`);
      return this.readFile(resolved);
    }

    // Check access control
    if (!this.isAllowed(p)) {
      throw new FsError('ENOENT', p);
    }

    // Read from host (safeHostPath checks symlinks don't escape root)
    try {
      return nodeFs.readFileSync(this.safeHostPath(p), 'utf-8');
    } catch (err) {
      if (err instanceof FsError) throw err;
      throw translateError(err, p);
    }
  }

  writeFile(path: string, content: string): void {
    const p = normalizePath(path);

    // Track whether the file existed on host before first write
    if (!this.hostExisted.has(p) && !this.memoryFiles.has(p)) {
      if (this.hostExists(p)) {
        this.hostExisted.add(p);
      }
    }

    // Ensure parent directories exist
    this.ensureParentDirs(p);

    this.memoryFiles.set(p, content);
    this.deletedPaths.delete(p);

    const now = new Date();
    this.memoryTimes.set(p, { mtime: now, ctime: now });
  }

  appendFile(path: string, content: string): void {
    const p = normalizePath(path);
    let existing = '';
    try {
      existing = this.readFile(p);
    } catch {
      // File doesn't exist, start fresh
    }
    this.writeFile(p, existing + content);
  }

  exists(path: string): boolean {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) return false;
    if (this.memoryFiles.has(p)) return true;
    if (this.memoryDirs.has(p)) return true;
    if (this.memorySymlinks.has(p)) return true;

    if (!this.isAllowed(p)) return false;

    return this.hostExists(p);
  }

  stat(path: string): FileStat {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    // Memory file
    const memContent = this.memoryFiles.get(p);
    if (memContent !== undefined) {
      const times = this.memoryTimes.get(p) ?? { mtime: new Date(), ctime: new Date() };
      const mode = this.memoryModes.get(p) ?? 0o644;
      return {
        isFile: () => true,
        isDirectory: () => false,
        size: memContent.length,
        mode,
        mtime: times.mtime,
        ctime: times.ctime,
      };
    }

    // Memory directory
    if (this.memoryDirs.has(p)) {
      const times = this.memoryTimes.get(p) ?? { mtime: new Date(), ctime: new Date() };
      const mode = this.memoryModes.get(p) ?? 0o755;
      return {
        isFile: () => false,
        isDirectory: () => true,
        size: 0,
        mode,
        mtime: times.mtime,
        ctime: times.ctime,
      };
    }

    if (!this.isAllowed(p)) {
      throw new FsError('ENOENT', p);
    }

    // Host filesystem
    try {
      const hostStat = nodeFs.statSync(this.safeHostPath(p));
      const mode = this.memoryModes.get(p) ?? hostStat.mode & 0o7777;
      return {
        isFile: () => hostStat.isFile(),
        isDirectory: () => hostStat.isDirectory(),
        size: hostStat.size,
        mode,
        mtime: hostStat.mtime,
        ctime: hostStat.ctime,
      };
    } catch (err) {
      throw translateError(err, p);
    }
  }

  readdir(path: string): string[] {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    const entries = new Set<string>();

    // Host entries
    if (this.isAllowed(p)) {
      try {
        const hostEntries = nodeFs.readdirSync(this.safeHostPath(p));
        for (let i = 0; i < hostEntries.length; i++) {
          const childPath = p === '/' ? `/${hostEntries[i]}` : `${p}/${hostEntries[i]}`;
          if (!this.deletedPaths.has(childPath)) {
            entries.add(hostEntries[i]);
          }
        }
      } catch {
        // Host directory may not exist
      }
    }

    // Memory file entries
    for (const [filePath] of this.memoryFiles) {
      if (parentDir(filePath) === p) {
        const name = filePath.slice(p === '/' ? 1 : p.length + 1);
        if (name && !name.includes('/')) {
          entries.add(name);
        }
      }
    }

    // Memory directory entries
    for (const dirPath of this.memoryDirs) {
      if (dirPath !== p && parentDir(dirPath) === p) {
        const name = dirPath.slice(p === '/' ? 1 : p.length + 1);
        if (name && !name.includes('/')) {
          entries.add(name);
        }
      }
    }

    if (entries.size === 0 && !this.memoryDirs.has(p) && !this.hostIsDirectory(p)) {
      throw new FsError('ENOENT', p);
    }

    const result = Array.from(entries);
    result.sort();
    return result;
  }

  mkdir(path: string, options?: { recursive?: boolean }): void {
    const p = normalizePath(path);

    if (options?.recursive) {
      const segments = p.split('/').filter(Boolean);
      let current = '';
      for (let i = 0; i < segments.length; i++) {
        current += `/${segments[i]}`;
        this.memoryDirs.add(current);
        this.deletedPaths.delete(current);
      }
    } else {
      const parent = parentDir(p);
      if (!this.exists(parent)) {
        throw new FsError('ENOENT', p);
      }
      if (this.memoryDirs.has(p) || this.hostIsDirectory(p)) {
        throw new FsError('EEXIST', p);
      }
      this.memoryDirs.add(p);
      this.deletedPaths.delete(p);
    }

    const now = new Date();
    this.memoryTimes.set(p, { mtime: now, ctime: now });
  }

  rmdir(path: string, options?: { recursive?: boolean }): void {
    const p = normalizePath(path);

    if (!this.exists(p)) {
      throw new FsError('ENOENT', p);
    }

    if (options?.recursive) {
      // Delete all children
      for (const [filePath] of this.memoryFiles) {
        if (filePath.startsWith(`${p}/`)) {
          this.memoryFiles.delete(filePath);
          this.deletedPaths.add(filePath);
        }
      }
      for (const dirPath of this.memoryDirs) {
        if (dirPath.startsWith(`${p}/`)) {
          this.memoryDirs.delete(dirPath);
          this.deletedPaths.add(dirPath);
        }
      }
      this.memoryDirs.delete(p);
      this.deletedPaths.add(p);
    } else {
      // Check if empty
      const entries = this.readdir(p);
      if (entries.length > 0) {
        throw new FsError('ENOTEMPTY', p);
      }
      this.memoryDirs.delete(p);
      this.deletedPaths.add(p);
    }
  }

  unlink(path: string): void {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    if (!this.memoryFiles.has(p) && !this.memorySymlinks.has(p) && !this.hostExists(p)) {
      throw new FsError('ENOENT', p);
    }

    this.memoryFiles.delete(p);
    this.memorySymlinks.delete(p);
    this.deletedPaths.add(p);
  }

  rename(oldPath: string, newPath: string): void {
    const op = normalizePath(oldPath);
    const np = normalizePath(newPath);

    const content = this.readFile(op);
    this.writeFile(np, content);
    this.unlink(op);
  }

  copyFile(src: string, dest: string): void {
    const content = this.readFile(src);
    this.writeFile(dest, content);
  }

  chmod(path: string, mode: number): void {
    const p = normalizePath(path);
    if (!this.exists(p)) {
      throw new FsError('ENOENT', p);
    }
    this.memoryModes.set(p, mode);
  }

  realpath(path: string): string {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    // Memory paths are already canonical
    if (this.memoryFiles.has(p) || this.memoryDirs.has(p)) {
      return p;
    }

    // For host paths, resolve and ensure it stays within root
    try {
      const resolved = nodeFs.realpathSync(this.hostPath(p));
      const resolvedNorm = nodePath.normalize(resolved);
      const rootNorm = nodePath.normalize(this.root);
      if (resolvedNorm !== rootNorm && !resolvedNorm.startsWith(`${rootNorm}${nodePath.sep}`)) {
        throw new FsError('EACCES', p, `realpath: resolved path escapes root: ${p}`);
      }
      // Return canonical virtual path (resolved host path relative to root)
      if (resolvedNorm === rootNorm) return '/';
      return `/${nodePath.relative(rootNorm, resolvedNorm).split(nodePath.sep).join('/')}`;
    } catch (err) {
      if (err instanceof FsError) throw err;
      throw translateError(err, p);
    }
  }

  symlink(target: string, linkPath: string): void {
    const lp = normalizePath(linkPath);
    if (this.exists(lp)) {
      throw new FsError('EEXIST', lp);
    }
    this.memorySymlinks.set(lp, target);
    this.deletedPaths.delete(lp);
  }

  readlink(path: string): string {
    const p = normalizePath(path);

    if (this.deletedPaths.has(p)) {
      throw new FsError('ENOENT', p);
    }

    const memTarget = this.memorySymlinks.get(p);
    if (memTarget !== undefined) return memTarget;

    try {
      return nodeFs.readlinkSync(this.safeHostPath(p), 'utf-8');
    } catch (err) {
      throw translateError(err, p);
    }
  }

  /**
   * Get all changes made in the overlay.
   * Returns created files, modified files (with content), and deleted paths.
   */
  getChanges(): ChangeSet {
    const created: FileChange[] = [];
    const modified: FileChange[] = [];

    for (const [path, content] of this.memoryFiles) {
      if (this.hostExisted.has(path)) {
        modified.push({ path, content });
      } else {
        created.push({ path, content });
      }
    }

    const deleted = Array.from(this.deletedPaths);

    return { created, modified, deleted };
  }

  /** Ensure parent directories exist in memory. */
  private ensureParentDirs(path: string): void {
    const segments = path.split('/').filter(Boolean);
    let current = '';
    for (let i = 0; i < segments.length - 1; i++) {
      current += `/${segments[i]}`;
      this.memoryDirs.add(current);
    }
  }
}
