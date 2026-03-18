# Filesystem

In-memory virtual filesystem. Flat Map storage, lazy file content, no real OS interaction.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/fs/types.ts` | 172 | FileSystem interface, FsError, LazyFileContent type |
| `src/fs/memory.ts` | 592 | InMemoryFs implementation |

## Storage Model

**Flat `Map<string, FileNode>`** keyed by normalized absolute paths.

```
FileNode {
  content: LazyFileContent    // string | (() => string | Promise<string>)
  type: 'file' | 'directory' | 'symlink'
  symlinkTarget?: string      // for symlinks only
  mode: number                // e.g. 0o644, informational only
  mtime: Date
  ctime: Date
}
```

No tree structure. Parent-child relationships derived by path prefix. Directory listing scans all keys matching `parentPath + '/'` prefix.

## Lazy Files

`LazyFileContent = string | (() => string | Promise<string>)`

- **Eager:** content is a string, returned directly
- **Lazy:** content is a function, called on first read, result cached in-place
- **Async lazy:** function returns a Promise, resolved and cached

**Registration:**
```typescript
fs.addLazyFile('/path/to/file', () => fetchContentFromSomewhere());
```

Parent directories are created automatically. Content function called at most once.

## Path Normalization

`normalizePath()` in `src/fs/memory.ts`:
- Requires absolute paths (starts with `/`)
- Resolves `.` (skip) and `..` (pop segment)
- Collapses consecutive `/`
- Strips trailing `/`
- **Traversal prevention:** `..` at root stays at root (cannot escape `/`)

## Virtual Devices

Created during `InMemoryFs` constructor:

| Path | Read behavior | Write behavior |
|------|---------------|----------------|
| `/dev/null` | Returns `''` | Silently discarded |
| `/dev/stdin` | Returns `''` | Silently discarded |
| `/dev/stdout` | Returns `''` | Silently discarded |
| `/dev/stderr` | Returns `''` | Silently discarded |

All virtual devices have mode `0o666`.

## Symlinks

- **Storage:** FileNode with `type: 'symlink'` and `symlinkTarget` field
- **Resolution depth limit:** 40 (hardcoded). Returns symlink node itself if exceeded.
- **Relative targets:** resolved from symlink's parent directory
- **API:** `symlink(target, linkPath)` creates, `readlink(path)` returns raw target

## Key Methods

| Method | Returns | Notes |
|--------|---------|-------|
| `readFile(path)` | `string \| Promise<string>` | Lazy files may return Promise |
| `writeFile(path, content)` | `void` | Creates file and parent dirs |
| `appendFile(path, content)` | `void` | Creates if not exists |
| `stat(path)` | `FileStat` | Follows symlinks |
| `lstat(path)` | `FileStat` | Does not follow symlinks |
| `readdir(path)` | `string[]` | Direct children names only |
| `mkdir(path, recursive?)` | `void` | Recursive creates parents |
| `chmod(path, mode)` | `void` | Stores mode, does not enforce |
| `addLazyFile(path, loader)` | `void` | Register lazy-loaded file |

## Gotchas

- **Subshells share the filesystem.** Unlike real bash (separate processes), writes in `$(...)` or `(...)` are visible to the parent shell. This is by design - cloning a Map on every subshell would be expensive and rarely matters for AI agent scripts.
- **`readFile` returns `string | Promise<string>`.** Callers must handle both. Use `await` or check `typeof result === 'string'` for sync path.
- **chmod is informational only.** Mode bits are stored but never enforced. `cat` reads any file regardless of permissions. This is intentional - permission enforcement adds complexity without real security value in a virtual FS.
- **No hard links.** Only symlinks are supported.
- **Directory listing is O(n).** Scans all map keys with matching prefix. Fine for typical AI agent scripts, but not for filesystems with millions of entries.
