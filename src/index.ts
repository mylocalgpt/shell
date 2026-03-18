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
	ConditionalExpr,
	ConditionalExpression,
	ConcatWord,
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
