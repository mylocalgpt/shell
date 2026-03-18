// Types - filesystem
export type { FileSystem, FileStat, LazyFileContent } from './fs/types.js';

// Types - commands
export type { Command, CommandContext, CommandResult, LazyCommandDef } from './commands/types.js';

// Types - security
export type { ExecutionLimits } from './security/limits.js';

// Values - security
export { DEFAULT_LIMITS } from './security/limits.js';

// Types - parser
export type { AST, BaseNode } from './parser/ast.js';

// Shell
import type { CommandResult } from './commands/types.js';
import type { FileSystem } from './fs/types.js';
import type { ExecutionLimits } from './security/limits.js';

/**
 * Options for creating a Shell instance.
 */
export interface ShellOptions {
	/** Custom filesystem implementation. Defaults to a new InMemoryFs. */
	fs?: FileSystem;
	/** Initial environment variables. Converted to a Map internally. */
	env?: Record<string, string>;
	/** Initial working directory. Defaults to "/". */
	cwd?: string;
	/** Execution limits. Merged with DEFAULT_LIMITS. */
	limits?: Partial<ExecutionLimits>;
}

/**
 * Virtual bash interpreter.
 * Executes shell commands against an in-memory filesystem.
 */
export class Shell {
	private readonly options: ShellOptions;

	constructor(options?: ShellOptions) {
		this.options = options ?? {};
	}

	/**
	 * Execute a shell command string and return the result.
	 *
	 * @param command - The shell command to execute
	 * @returns stdout, stderr, and exit code
	 */
	async exec(command: string): Promise<CommandResult> {
		void command;
		throw new Error('not implemented: Shell.exec');
	}
}

export const VERSION: '0.0.0' = '0.0.0' as const;
