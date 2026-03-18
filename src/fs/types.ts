/**
 * Content that can be a string or a lazy-loaded function.
 * Lazy functions are called on first read and their result is cached.
 */
export type LazyFileContent = string | (() => string | Promise<string>);

/**
 * Metadata about a file or directory entry.
 */
export interface FileStat {
	/** Returns true if this entry is a regular file. */
	isFile(): boolean;
	/** Returns true if this entry is a directory. */
	isDirectory(): boolean;
	/** Size in bytes (string length for text content). */
	size: number;
	/** Unix permission bits (e.g. 0o644 for files, 0o755 for directories). */
	mode: number;
	/** Last modification time. */
	mtime: Date;
	/** Creation time. */
	ctime: Date;
}

/**
 * Abstract filesystem interface.
 *
 * All paths must be absolute (start with `/`). Implementations should
 * normalize paths and prevent traversal above the root directory.
 */
export interface FileSystem {
	/**
	 * Read the contents of a file.
	 * Returns a string or a Promise<string> if the content is lazy and async.
	 *
	 * @param path - Absolute path to the file
	 * @returns File content as a string, or a Promise resolving to the content
	 * @throws {FsError} ENOENT if the file does not exist
	 * @throws {FsError} EISDIR if the path is a directory
	 */
	readFile(path: string): string | Promise<string>;

	/**
	 * Write content to a file, creating it if it does not exist or overwriting if it does.
	 * Parent directories are created automatically.
	 *
	 * @param path - Absolute path to the file
	 * @param content - UTF-8 string content to write
	 */
	writeFile(path: string, content: string): void;

	/**
	 * Append content to an existing file, or create it if it does not exist.
	 *
	 * @param path - Absolute path to the file
	 * @param content - UTF-8 string content to append
	 * @throws {FsError} EISDIR if the path is a directory
	 */
	appendFile(path: string, content: string): void;

	/**
	 * Check whether a path exists (file or directory).
	 * Never throws.
	 *
	 * @param path - Absolute path to check
	 * @returns true if the path exists
	 */
	exists(path: string): boolean;

	/**
	 * Get metadata about a file or directory.
	 *
	 * @param path - Absolute path to stat
	 * @returns FileStat with type, size, mode, and timestamps
	 * @throws {FsError} ENOENT if the path does not exist
	 */
	stat(path: string): FileStat;

	/**
	 * List entries in a directory.
	 *
	 * @param path - Absolute path to the directory
	 * @returns Sorted array of entry names (not full paths)
	 * @throws {FsError} ENOENT if the directory does not exist
	 * @throws {FsError} ENOTDIR if the path is not a directory
	 */
	readdir(path: string): string[];

	/**
	 * Create a directory.
	 *
	 * @param path - Absolute path for the new directory
	 * @param options - If recursive is true, create parent directories as needed
	 * @throws {FsError} EEXIST if the directory already exists (unless recursive)
	 * @throws {FsError} ENOENT if the parent directory does not exist (unless recursive)
	 */
	mkdir(path: string, options?: { recursive?: boolean }): void;

	/**
	 * Remove a directory.
	 *
	 * @param path - Absolute path to the directory
	 * @param options - If recursive is true, remove all contents first
	 * @throws {FsError} ENOENT if the directory does not exist
	 * @throws {FsError} ENOTEMPTY if the directory is not empty (unless recursive)
	 */
	rmdir(path: string, options?: { recursive?: boolean }): void;

	/**
	 * Remove a file.
	 *
	 * @param path - Absolute path to the file
	 * @throws {FsError} ENOENT if the file does not exist
	 * @throws {FsError} EISDIR if the path is a directory
	 */
	unlink(path: string): void;

	/**
	 * Rename (move) a file or directory.
	 *
	 * @param oldPath - Current absolute path
	 * @param newPath - New absolute path
	 * @throws {FsError} ENOENT if the source does not exist
	 */
	rename(oldPath: string, newPath: string): void;

	/**
	 * Copy a file.
	 *
	 * @param src - Absolute path to the source file
	 * @param dest - Absolute path for the destination
	 * @throws {FsError} ENOENT if the source file does not exist
	 */
	copyFile(src: string, dest: string): void;

	/**
	 * Change the permission bits of a file or directory.
	 *
	 * @param path - Absolute path
	 * @param mode - Unix permission bits (e.g. 0o755)
	 * @throws {FsError} ENOENT if the path does not exist
	 */
	chmod(path: string, mode: number): void;

	/**
	 * Resolve a path to its canonical form, verifying that it exists.
	 *
	 * @param path - Absolute path to resolve
	 * @returns The normalized, canonical path
	 * @throws {FsError} ENOENT if the path does not exist
	 */
	realpath(path: string): string;

	/**
	 * Create a symbolic link.
	 *
	 * @param target - The target the symlink points to
	 * @param linkPath - Absolute path for the new symlink
	 * @throws {FsError} EEXIST if the link path already exists
	 */
	symlink(target: string, linkPath: string): void;

	/**
	 * Read the target of a symbolic link.
	 *
	 * @param path - Absolute path to the symlink
	 * @returns The symlink target string
	 * @throws {FsError} ENOENT if the path does not exist
	 * @throws {FsError} EINVAL if the path is not a symlink
	 */
	readlink(path: string): string;
}
