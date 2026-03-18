import type { FileStat, FileSystem, LazyFileContent } from './types.js';

/**
 * Filesystem error with a code property matching Node.js conventions.
 */
export class FsError extends Error {
	/** Error code (e.g. 'ENOENT', 'EISDIR', 'ENOTDIR', 'EEXIST', 'ENOTEMPTY'). */
	readonly code: string;
	/** The path that caused the error. */
	readonly path: string;

	constructor(code: string, path: string, message?: string) {
		super(message ?? `${code}: ${path}`);
		this.code = code;
		this.path = path;
		this.name = 'FsError';
	}
}

interface FileNode {
	content: LazyFileContent;
	type: 'file' | 'directory' | 'symlink';
	/** Symlink target (only set when type is 'symlink'). */
	symlinkTarget?: string;
	mode: number;
	mtime: Date;
	ctime: Date;
}

/** Virtual device paths that have special behavior. */
const VIRTUAL_DEVICES = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr']);

/**
 * Normalize a path: resolve `.`, `..`, collapse double slashes, strip trailing slash.
 * Prevents traversal above root.
 * All paths must be absolute.
 */
function normalizePath(input: string): string {
	if (!input.startsWith('/')) {
		throw new FsError('EINVAL', input, `Path must be absolute: ${input}`);
	}

	const segments: string[] = [];
	const parts = input.split('/');

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === '' || part === '.') {
			continue;
		}
		if (part === '..') {
			// Prevent traversal above root - just pop if we can, otherwise stay at root
			if (segments.length > 0) {
				segments.pop();
			}
			continue;
		}
		segments.push(part);
	}

	if (segments.length === 0) {
		return '/';
	}
	return `/${segments.join('/')}`;
}

/**
 * Get the parent directory of a path.
 */
function parentDir(path: string): string {
	const lastSlash = path.lastIndexOf('/');
	if (lastSlash <= 0) {
		return '/';
	}
	return path.slice(0, lastSlash);
}

/**
 * In-memory filesystem implementation.
 *
 * Uses a flat Map keyed by normalized absolute paths. Supports lazy file
 * content (sync or async functions that are called on first read and cached).
 * Virtual devices (/dev/null, /dev/stdin, /dev/stdout, /dev/stderr) are built in.
 */
export class InMemoryFs implements FileSystem {
	private readonly nodes: Map<string, FileNode> = new Map();

	/**
	 * Create a new in-memory filesystem.
	 *
	 * @param initialFiles - Optional record of path-to-content entries to pre-populate
	 */
	constructor(initialFiles?: Record<string, string>) {
		// Create root directory
		this.nodes.set('/', {
			content: '',
			type: 'directory',
			mode: 0o755,
			mtime: new Date(),
			ctime: new Date(),
		});

		// Register virtual devices
		for (const dev of VIRTUAL_DEVICES) {
			this.ensureParentDirs(dev);
			this.nodes.set(dev, {
				content: '',
				type: 'file',
				mode: 0o666,
				mtime: new Date(),
				ctime: new Date(),
			});
		}

		// Populate initial files
		if (initialFiles) {
			const keys = Object.keys(initialFiles);
			for (let i = 0; i < keys.length; i++) {
				const path = keys[i];
				this.writeFile(path, initialFiles[path]);
			}
		}
	}

	readFile(path: string): string | Promise<string> {
		const normalized = normalizePath(path);

		// Virtual device: /dev/null always returns empty
		if (normalized === '/dev/null') {
			return '';
		}
		// Other /dev/* devices return empty
		if (VIRTUAL_DEVICES.has(normalized)) {
			return '';
		}

		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		if (node.type === 'directory') {
			throw new FsError(
				'EISDIR',
				normalized,
				`EISDIR: illegal operation on a directory: ${normalized}`,
			);
		}

		// Handle lazy content
		if (typeof node.content === 'function') {
			const result = node.content();
			if (typeof result === 'string') {
				// Sync lazy: cache the result
				node.content = result;
				return result;
			}
			// Async lazy: resolve, cache, and return
			return result.then((resolved: string) => {
				node.content = resolved;
				return resolved;
			});
		}

		return node.content;
	}

	writeFile(path: string, content: string): void {
		const normalized = normalizePath(path);

		// Virtual device: /dev/null discards writes
		if (normalized === '/dev/null') {
			return;
		}
		// Other /dev/* devices discard writes
		if (VIRTUAL_DEVICES.has(normalized)) {
			return;
		}

		this.ensureParentDirs(normalized);

		const existing = this.nodes.get(normalized);
		const now = new Date();
		this.nodes.set(normalized, {
			content,
			type: 'file',
			mode: existing?.type === 'file' ? existing.mode : 0o644,
			mtime: now,
			ctime: existing ? existing.ctime : now,
		});
	}

	appendFile(path: string, content: string): void {
		const normalized = normalizePath(path);

		if (VIRTUAL_DEVICES.has(normalized)) {
			return;
		}

		const node = this.nodes.get(normalized);
		if (node && node.type === 'directory') {
			throw new FsError(
				'EISDIR',
				normalized,
				`EISDIR: illegal operation on a directory: ${normalized}`,
			);
		}

		if (!node) {
			this.writeFile(path, content);
			return;
		}

		// Must resolve lazy content before appending
		if (typeof node.content === 'function') {
			const result = node.content();
			if (typeof result !== 'string') {
				throw new FsError(
					'EAGAIN',
					normalized,
					`Cannot append to file with async lazy content that has not been read yet: ${normalized}`,
				);
			}
			node.content = result;
		}

		node.content = node.content + content;
		node.mtime = new Date();
	}

	exists(path: string): boolean {
		try {
			const normalized = normalizePath(path);
			return this.nodes.has(normalized);
		} catch {
			return false;
		}
	}

	stat(path: string): FileStat {
		const normalized = normalizePath(path);
		const node = this.resolveNode(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}

		const isFile = node.type === 'file';
		const size = isFile && typeof node.content === 'string' ? node.content.length : 0;

		return {
			isFile(): boolean {
				return isFile;
			},
			isDirectory(): boolean {
				return !isFile;
			},
			size,
			mode: node.mode,
			mtime: node.mtime,
			ctime: node.ctime,
		};
	}

	readdir(path: string): string[] {
		const normalized = normalizePath(path);
		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		if (node.type !== 'directory') {
			throw new FsError('ENOTDIR', normalized, `ENOTDIR: not a directory: ${normalized}`);
		}

		const prefix = normalized === '/' ? '/' : `${normalized}/`;
		const entries: string[] = [];

		for (const key of this.nodes.keys()) {
			if (key === normalized) {
				continue;
			}
			if (!key.startsWith(prefix)) {
				continue;
			}
			// Only direct children: no additional '/' after the prefix
			const rest = key.slice(prefix.length);
			if (rest.length > 0 && !rest.includes('/')) {
				entries.push(rest);
			}
		}

		entries.sort();
		return entries;
	}

	mkdir(path: string, options?: { recursive?: boolean }): void {
		const normalized = normalizePath(path);
		const existing = this.nodes.get(normalized);

		if (existing) {
			if (options?.recursive && existing.type === 'directory') {
				return; // Already exists and recursive - no error
			}
			throw new FsError('EEXIST', normalized, `EEXIST: file already exists: ${normalized}`);
		}

		if (options?.recursive) {
			this.ensureParentDirs(normalized);
		} else {
			const parent = parentDir(normalized);
			const parentNode = this.nodes.get(parent);
			if (!parentNode) {
				throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${parent}`);
			}
			if (parentNode.type !== 'directory') {
				throw new FsError('ENOTDIR', parent, `ENOTDIR: not a directory: ${parent}`);
			}
		}

		const now = new Date();
		this.nodes.set(normalized, {
			content: '',
			type: 'directory',
			mode: 0o755,
			mtime: now,
			ctime: now,
		});
	}

	rmdir(path: string, options?: { recursive?: boolean }): void {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			throw new FsError('EPERM', normalized, 'EPERM: operation not permitted on root directory');
		}

		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		if (node.type !== 'directory') {
			throw new FsError('ENOTDIR', normalized, `ENOTDIR: not a directory: ${normalized}`);
		}

		const children = this.readdir(normalized);

		if (children.length > 0 && !options?.recursive) {
			throw new FsError('ENOTEMPTY', normalized, `ENOTEMPTY: directory not empty: ${normalized}`);
		}

		if (options?.recursive) {
			// Remove all descendants
			const prefix = `${normalized}/`;
			const keysToRemove: string[] = [];
			for (const key of this.nodes.keys()) {
				if (key.startsWith(prefix)) {
					keysToRemove.push(key);
				}
			}
			for (let i = 0; i < keysToRemove.length; i++) {
				this.nodes.delete(keysToRemove[i]);
			}
		}

		this.nodes.delete(normalized);
	}

	unlink(path: string): void {
		const normalized = normalizePath(path);
		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		if (node.type === 'directory') {
			throw new FsError(
				'EISDIR',
				normalized,
				`EISDIR: illegal operation on a directory: ${normalized}`,
			);
		}
		this.nodes.delete(normalized);
	}

	rename(oldPath: string, newPath: string): void {
		const normalizedOld = normalizePath(oldPath);
		const normalizedNew = normalizePath(newPath);

		const node = this.nodes.get(normalizedOld);
		if (!node) {
			throw new FsError(
				'ENOENT',
				normalizedOld,
				`ENOENT: no such file or directory: ${normalizedOld}`,
			);
		}

		// Ensure parent directory of new path exists
		this.ensureParentDirs(normalizedNew);

		if (node.type === 'directory') {
			// Move the directory and all its descendants
			const oldPrefix = `${normalizedOld}/`;
			const entriesToMove: Array<[string, FileNode]> = [];

			for (const [key, value] of this.nodes.entries()) {
				if (key.startsWith(oldPrefix)) {
					const newKey = normalizedNew + key.slice(normalizedOld.length);
					entriesToMove.push([newKey, value]);
				}
			}

			// Remove old entries
			this.nodes.delete(normalizedOld);
			for (const [key] of this.nodes.entries()) {
				if (key.startsWith(oldPrefix)) {
					this.nodes.delete(key);
				}
			}

			// Add new entries
			this.nodes.set(normalizedNew, node);
			for (let i = 0; i < entriesToMove.length; i++) {
				this.nodes.set(entriesToMove[i][0], entriesToMove[i][1]);
			}
		} else {
			this.nodes.delete(normalizedOld);
			this.nodes.set(normalizedNew, node);
		}

		node.mtime = new Date();
	}

	copyFile(src: string, dest: string): void {
		const normalizedSrc = normalizePath(src);
		const normalizedDest = normalizePath(dest);

		const node = this.nodes.get(normalizedSrc);
		if (!node) {
			throw new FsError(
				'ENOENT',
				normalizedSrc,
				`ENOENT: no such file or directory: ${normalizedSrc}`,
			);
		}
		if (node.type === 'directory') {
			throw new FsError(
				'EISDIR',
				normalizedSrc,
				`EISDIR: illegal operation on a directory: ${normalizedSrc}`,
			);
		}

		this.ensureParentDirs(normalizedDest);

		const now = new Date();
		this.nodes.set(normalizedDest, {
			content: typeof node.content === 'string' ? node.content : node.content,
			type: 'file',
			mode: node.mode,
			mtime: now,
			ctime: now,
		});
	}

	chmod(path: string, mode: number): void {
		const normalized = normalizePath(path);
		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		node.mode = mode;
	}

	realpath(path: string): string {
		const normalized = normalizePath(path);
		if (!this.nodes.has(normalized)) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		return normalized;
	}

	symlink(target: string, linkPath: string): void {
		const normalized = normalizePath(linkPath);
		if (this.nodes.has(normalized)) {
			throw new FsError('EEXIST', normalized, `EEXIST: file already exists: ${normalized}`);
		}
		this.ensureParentDirs(normalized);
		const now = new Date();
		this.nodes.set(normalized, {
			content: '',
			type: 'symlink',
			symlinkTarget: target,
			mode: 0o777,
			mtime: now,
			ctime: now,
		});
	}

	readlink(path: string): string {
		const normalized = normalizePath(path);
		const node = this.nodes.get(normalized);
		if (!node) {
			throw new FsError('ENOENT', normalized, `ENOENT: no such file or directory: ${normalized}`);
		}
		if (node.type !== 'symlink') {
			throw new FsError('EINVAL', normalized, `EINVAL: invalid argument: ${normalized}`);
		}
		return node.symlinkTarget ?? '';
	}

	/**
	 * Add a file with lazy content (sync or async function).
	 * The function is called on first read and its result is cached.
	 *
	 * @param path - Absolute path for the file
	 * @param content - A function returning the file content
	 */
	addLazyFile(path: string, content: () => string | Promise<string>): void {
		const normalized = normalizePath(path);
		this.ensureParentDirs(normalized);

		const now = new Date();
		this.nodes.set(normalized, {
			content,
			type: 'file',
			mode: 0o644,
			mtime: now,
			ctime: now,
		});
	}

	/**
	 * Resolve a node, following symlinks up to a maximum depth.
	 */
	private resolveNode(normalized: string, depth?: number): FileNode | undefined {
		const maxDepth = depth ?? 40;
		const node = this.nodes.get(normalized);
		if (!node) return undefined;
		if (node.type !== 'symlink' || maxDepth <= 0) return node;

		// Follow symlink
		const target = node.symlinkTarget ?? '';
		let resolvedTarget: string;
		if (target.startsWith('/')) {
			resolvedTarget = normalizePath(target);
		} else {
			const dir = parentDir(normalized);
			resolvedTarget = normalizePath(dir === '/' ? `/${target}` : `${dir}/${target}`);
		}
		return this.resolveNode(resolvedTarget, maxDepth - 1);
	}

	/**
	 * Ensure all parent directories for a path exist, creating them if needed.
	 */
	private ensureParentDirs(path: string): void {
		const parts = path.split('/').filter((p) => p.length > 0);
		let current = '';

		for (let i = 0; i < parts.length - 1; i++) {
			current += `/${parts[i]}`;
			if (!this.nodes.has(current)) {
				const now = new Date();
				this.nodes.set(current, {
					content: '',
					type: 'directory',
					mode: 0o755,
					mtime: now,
					ctime: now,
				});
			}
		}
	}
}
