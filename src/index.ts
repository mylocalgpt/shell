// Types - filesystem
export type { FileStat, FileSystem, LazyFileContent } from './fs/types.js';

// Types - commands
export type { Command, CommandContext, CommandResult, LazyCommandDef } from './commands/types.js';

// Types - security
export type { ExecutionLimits } from './security/limits.js';

// Types - parser
export type {
	AST,
	ASTNode,
	Assignment,
	BaseNode,
	BraceGroup,
	CaseItem,
	CaseStatement,
	CommandNode,
	CompoundCommand,
	ConcatWord,
	ConditionalExpr,
	ConditionalExpression,
	ForCStatement,
	ForStatement,
	FunctionDefinition,
	HereDoc,
	IfStatement,
	List,
	ListEntry,
	Pipeline,
	Program,
	Redirection,
	SimpleCommand,
	SourcePosition,
	Subshell,
	UntilStatement,
	WhileStatement,
	Word,
	WordPart,
} from './parser/ast.js';
export type { Token, TokenType } from './parser/lexer.js';

// Values - filesystem
export { FsError, InMemoryFs } from './fs/memory.js';

// Values - commands
export { CommandRegistry } from './commands/registry.js';

// Values - security
export { DEFAULT_LIMITS } from './security/limits.js';

// Values - parser
export { Lexer, LexerError, tokenize } from './parser/lexer.js';
export { ParseError, parse } from './parser/parser.js';

// Values - interpreter
export { Interpreter } from './interpreter/interpreter.js';
export {
	BreakSignal,
	ContinueSignal,
	ErrexitError,
	ExitSignal,
	LimitExceededError,
	ReturnSignal,
} from './interpreter/errors.js';
export { registerBuiltins } from './interpreter/builtins.js';

import { registerDefaultCommands } from './commands/defaults.js';
import { CommandRegistry } from './commands/registry.js';
// Shell
import type { CommandResult } from './commands/types.js';
import { InMemoryFs } from './fs/memory.js';
import type { FileSystem } from './fs/types.js';
import { registerBuiltins } from './interpreter/builtins.js';
import { Interpreter } from './interpreter/interpreter.js';
import { parse as parseInput } from './parser/parser.js';
import type { ExecutionLimits } from './security/limits.js';

/** Default environment variables for a new shell. */
const DEFAULT_ENV: Record<string, string> = {
	HOME: '/root',
	USER: 'root',
	PATH: '/usr/bin:/bin',
	SHELL: '/bin/bash',
	PWD: '/',
	TERM: 'xterm',
	LANG: 'en_US.UTF-8',
	IFS: ' \t\n',
	BASH_VERSION: '5.2.0(1)-release',
};

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
 *
 * The filesystem persists across exec() calls. Environment, functions,
 * and working directory are reset to their initial state for each call.
 */
export class Shell {
	private readonly fs: FileSystem;
	private readonly initialEnv: Map<string, string>;
	private readonly initialCwd: string;
	private readonly limits: Partial<ExecutionLimits>;
	private readonly registry: CommandRegistry;

	constructor(options?: ShellOptions) {
		this.fs = options?.fs ?? new InMemoryFs();
		this.initialCwd = options?.cwd ?? '/';
		this.limits = options?.limits ?? {};
		this.registry = new CommandRegistry();
		registerDefaultCommands(this.registry);

		// Build initial env from defaults + user overrides
		this.initialEnv = new Map<string, string>();
		const keys = Object.keys(DEFAULT_ENV);
		for (let i = 0; i < keys.length; i++) {
			this.initialEnv.set(keys[i], DEFAULT_ENV[keys[i]]);
		}
		if (options?.env) {
			const userKeys = Object.keys(options.env);
			for (let i = 0; i < userKeys.length; i++) {
				this.initialEnv.set(userKeys[i], options.env[userKeys[i]]);
			}
		}
		// Set PWD to match cwd
		this.initialEnv.set('PWD', this.initialCwd);
	}

	/**
	 * Get the command registry for registering custom commands.
	 *
	 * @returns The command registry instance
	 */
	getRegistry(): CommandRegistry {
		return this.registry;
	}

	/**
	 * Get the filesystem used by this shell.
	 *
	 * @returns The filesystem instance
	 */
	getFs(): FileSystem {
		return this.fs;
	}

	/**
	 * Execute a shell command string and return the result.
	 * Never throws to the caller. All errors are returned as
	 * { stdout, stderr, exitCode }.
	 *
	 * @param command - The shell command to execute
	 * @returns stdout, stderr, and exit code
	 */
	async exec(command: string): Promise<CommandResult> {
		// Parse
		let ast: import('./parser/ast.js').Program;
		try {
			ast = parseInput(command);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exitCode: 2, stdout: '', stderr: `@mylocalgpt/shell: ${msg}\n` };
		}

		// Create fresh interpreter with a copy of the initial env
		const env = new Map(this.initialEnv);
		const interpreter = new Interpreter(this.fs, this.registry, env, this.initialCwd, this.limits);
		registerBuiltins(interpreter);

		// Execute
		try {
			return await interpreter.execute(ast);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exitCode: 1, stdout: '', stderr: `@mylocalgpt/shell: ${msg}\n` };
		}
	}
}

export const VERSION: '0.0.0' = '0.0.0' as const;
