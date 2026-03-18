import type { CommandRegistry } from '../commands/registry.js';
import type { Command, CommandContext, CommandResult } from '../commands/types.js';
import type { FileSystem } from '../fs/types.js';
import type {
	BraceGroup,
	CaseStatement,
	CommandNode,
	ConditionalExpression,
	ForCStatement,
	ForStatement,
	FunctionDefinition,
	IfStatement,
	List,
	Pipeline,
	Program,
	Redirection,
	SimpleCommand,
	Subshell,
	UntilStatement,
	WhileStatement,
	Word,
} from '../parser/ast.js';
import { parse } from '../parser/parser.js';
import type { ExecutionLimits } from '../security/limits.js';
import { DEFAULT_LIMITS } from '../security/limits.js';
import { globMatch } from '../utils/glob.js';
import {
	BreakSignal,
	ContinueSignal,
	ErrexitError,
	ExitSignal,
	LimitExceededError,
	ReturnSignal,
} from './errors.js';
import {
	type ExpansionOpts,
	type ShellState,
	evaluateArithmetic,
	expandWord,
} from './expansion.js';

/** Shell runtime options (separate from ShellOptions in index.ts). */
export interface ShellRuntimeOptions {
	errexit: boolean;
	pipefail: boolean;
	nounset: boolean;
	noglob: boolean;
	noclobber: boolean;
	allexport: boolean;
	xtrace: boolean;
	verbose: boolean;
}

/** Create default shell runtime options. */
function defaultRuntimeOptions(): ShellRuntimeOptions {
	return {
		errexit: false,
		pipefail: false,
		nounset: false,
		noglob: false,
		noclobber: false,
		allexport: false,
		xtrace: false,
		verbose: false,
	};
}

/** A result helper. */
function makeResult(exitCode: number, stdout: string, stderr: string): CommandResult {
	return { exitCode, stdout, stderr };
}

/**
 * Interpreter that walks the AST and executes commands.
 */
export class Interpreter {
	private readonly fs: FileSystem;
	private readonly registry: CommandRegistry;
	private env: Map<string, string>;
	private locals: Array<Map<string, string>>;
	private functions: Map<string, FunctionDefinition>;
	private cwd: string;
	private exitCode: number;
	private options: ShellRuntimeOptions;
	private positionalParams: string[];
	private pipestatus: number[];
	private readonly limits: ExecutionLimits;
	private loopIterations: number;
	private callDepth: number;
	private commandCount: number;
	private conditionalDepth: number;
	private exportedVars: Set<string>;
	private readonlyVars: Set<string>;
	// Builtin handlers (populated by Phase 5)
	private builtins: Map<
		string,
		(args: string[], ctx: InterpreterContext) => Promise<CommandResult>
	>;

	constructor(
		fs: FileSystem,
		registry: CommandRegistry,
		env?: Map<string, string>,
		cwd?: string,
		limits?: Partial<ExecutionLimits>,
	) {
		this.fs = fs;
		this.registry = registry;
		this.env = env ?? new Map();
		this.locals = [];
		this.functions = new Map();
		this.cwd = cwd ?? '/';
		this.exitCode = 0;
		this.options = defaultRuntimeOptions();
		this.positionalParams = [];
		this.pipestatus = [0];
		this.limits = { ...DEFAULT_LIMITS, ...limits };
		this.loopIterations = 0;
		this.callDepth = 0;
		this.commandCount = 0;
		this.conditionalDepth = 0;
		this.exportedVars = new Set();
		this.readonlyVars = new Set();
		this.builtins = new Map();
	}

	/** Get the current shell state for the expansion engine. */
	private getShellState(): ShellState {
		return {
			env: this.env,
			positionalParams: this.positionalParams,
			arrays: new Map(),
			lastExitCode: this.exitCode,
			pid: 1,
			bgPid: 0,
			cwd: this.cwd,
			options: { nounset: this.options.nounset },
			fs: this.fs,
		};
	}

	/** Create expansion options. */
	private makeExpansionOpts(doubleQuoted?: boolean): ExpansionOpts {
		return {
			doubleQuoted: doubleQuoted ?? false,
			assignmentContext: false,
			casePattern: false,
			executor: (cmd: string) => this.executeCommandSubstitution(cmd),
			executeProgram: async (program) => {
				const savedEnv = this.env;
				this.env = new Map(savedEnv);
				try {
					const result = await this.execute(program);
					return result.stdout;
				} finally {
					this.env = savedEnv;
				}
			},
		};
	}

	/** Execute an AST node and return the result. */
	async execute(node: Program): Promise<CommandResult> {
		try {
			return await this.executeProgram(node);
		} catch (e) {
			if (e instanceof ExitSignal) {
				return makeResult(e.exitCode, '', '');
			}
			if (e instanceof ErrexitError) {
				return makeResult(e.exitCode, e.stdout, e.stderr);
			}
			throw e;
		}
	}

	/** Execute a Program node. */
	private async executeProgram(node: Program): Promise<CommandResult> {
		return this.executeList(node.body);
	}

	/** Execute a List node with &&, ||, ;, & operators. */
	private async executeList(node: List): Promise<CommandResult> {
		let result = makeResult(0, '', '');

		for (let i = 0; i < node.entries.length; i++) {
			const entry = node.entries[i];
			const prevExitCode = result.exitCode;
			const prevOp = i > 0 ? node.entries[i - 1].operator : '\n';

			// Short-circuit logic
			if (i > 0) {
				if (prevOp === '&&' && prevExitCode !== 0) continue;
				if (prevOp === '||' && prevExitCode === 0) continue;
			}

			// Track conditional depth for && and ||
			if (entry.operator === '&&' || entry.operator === '||') {
				this.conditionalDepth++;
			}

			try {
				const pipeResult = await this.executePipeline(entry.pipeline);
				result = {
					exitCode: pipeResult.exitCode,
					stdout: result.stdout + pipeResult.stdout,
					stderr: result.stderr + pipeResult.stderr,
				};
				this.exitCode = pipeResult.exitCode;
			} catch (e) {
				// For control flow signals (break, continue, return, exit),
				// attach accumulated output and re-throw
				if (
					e instanceof BreakSignal ||
					e instanceof ContinueSignal ||
					e instanceof ReturnSignal ||
					e instanceof ExitSignal
				) {
					(e as Error & { _stdout?: string; _stderr?: string })._stdout = result.stdout;
					(e as Error & { _stdout?: string; _stderr?: string })._stderr = result.stderr;
				}
				throw e;
			}

			if (entry.operator === '&&' || entry.operator === '||') {
				this.conditionalDepth--;
			}
		}

		return result;
	}

	/** Execute a Pipeline node. */
	private async executePipeline(node: Pipeline): Promise<CommandResult> {
		if (node.commands.length > this.limits.maxPipelineDepth) {
			throw new LimitExceededError(
				'maxPipelineDepth',
				node.commands.length,
				this.limits.maxPipelineDepth,
			);
		}

		// ! negation suppresses errexit
		if (node.negated) {
			this.conditionalDepth++;
		}

		const statuses: number[] = [];
		let stdin = '';
		let lastResult = makeResult(0, '', '');
		let combinedStderr = '';

		for (let i = 0; i < node.commands.length; i++) {
			const cmdResult = await this.executeCommand(node.commands[i], stdin);
			statuses.push(cmdResult.exitCode);
			combinedStderr += cmdResult.stderr;

			if (i < node.commands.length - 1) {
				// Pipe stdout to next command's stdin
				stdin = cmdResult.stdout;
			} else {
				lastResult = cmdResult;
			}
		}

		this.pipestatus = statuses;

		let exitCode: number;
		if (this.options.pipefail) {
			// Rightmost non-zero exit code
			exitCode = 0;
			for (let i = statuses.length - 1; i >= 0; i--) {
				if (statuses[i] !== 0) {
					exitCode = statuses[i];
					break;
				}
			}
		} else {
			exitCode = statuses[statuses.length - 1];
		}

		// ! negation
		if (node.negated) {
			exitCode = exitCode === 0 ? 1 : 0;
			this.conditionalDepth--;
		}

		return {
			exitCode,
			stdout: lastResult.stdout,
			stderr: combinedStderr,
		};
	}

	/** Execute a single command node with optional stdin. */
	private async executeCommand(node: CommandNode, stdin?: string): Promise<CommandResult> {
		this.commandCount++;
		if (this.commandCount > this.limits.maxCommandCount) {
			throw new LimitExceededError(
				'maxCommandCount',
				this.commandCount,
				this.limits.maxCommandCount,
			);
		}

		switch (node.type) {
			case 'SimpleCommand':
				return this.executeSimpleCommand(node, stdin ?? '');
			case 'IfStatement':
				return this.executeIf(node);
			case 'ForStatement':
				return this.executeFor(node);
			case 'ForCStatement':
				return this.executeForC(node);
			case 'WhileStatement':
				return this.executeWhile(node);
			case 'UntilStatement':
				return this.executeUntil(node);
			case 'CaseStatement':
				return this.executeCase(node);
			case 'Subshell':
				return this.executeSubshell(node);
			case 'BraceGroup':
				return this.executeBraceGroup(node);
			case 'FunctionDefinition':
				return this.executeFunctionDef(node);
			case 'ConditionalExpression':
				return this.executeConditionalExpression(node);
			default:
				return makeResult(0, '', '');
		}
	}

	/** Execute a SimpleCommand node. */
	private async executeSimpleCommand(node: SimpleCommand, stdin: string): Promise<CommandResult> {
		// 1. Process assignments
		const tempEnv = new Map<string, string>();
		for (let i = 0; i < node.assignments.length; i++) {
			const assign = node.assignments[i];
			let value = '';
			if (assign.value && assign.value.type !== 'ArrayExpression') {
				const expanded = await expandWord(
					assign.value,
					this.getShellState(),
					this.makeExpansionOpts(),
				);
				value = expanded.join(' ');
			}

			if (assign.append) {
				const existing = this.getVar(assign.name) ?? '';
				value = existing + value;
			}

			if (node.words.length === 0) {
				// No command: assign to env directly
				this.setVar(assign.name, value);
			} else {
				// Has command: temp assignment for command duration
				tempEnv.set(assign.name, value);
			}
		}

		// If no command words (just assignments), return success
		if (node.words.length === 0) {
			return makeResult(0, '', '');
		}

		// 2. Expand all words
		const expandedWords: string[] = [];
		try {
			for (let i = 0; i < node.words.length; i++) {
				const expanded = await expandWord(
					node.words[i],
					this.getShellState(),
					this.makeExpansionOpts(),
				);
				for (let j = 0; j < expanded.length; j++) {
					expandedWords.push(expanded[j]);
				}
			}
		} catch (e) {
			if (e instanceof Error && e.message.includes('unbound variable')) {
				const errResult = makeResult(1, '', `@mylocalgpt/shell: ${e.message}\n`);
				this.exitCode = 1;
				this.checkErrexit(errResult, '', '');
				return errResult;
			}
			throw e;
		}

		if (expandedWords.length === 0) {
			return makeResult(0, '', '');
		}

		const cmdName = expandedWords[0];
		const cmdArgs = expandedWords.slice(1);

		// 3. Apply redirections
		const redirState = this.applyRedirections(node.redirections, stdin);
		const effectiveStdin = redirState.stdin;

		// 4. Apply temp env
		const savedEnv = new Map<string, string | undefined>();
		for (const [key, val] of tempEnv) {
			savedEnv.set(key, this.env.get(key));
			this.env.set(key, val);
		}

		// 5. Resolve and execute command
		let result: CommandResult;
		try {
			result = await this.resolveAndExecute(cmdName, cmdArgs, effectiveStdin, redirState);
		} finally {
			// 6. Restore temp env
			for (const [key, val] of savedEnv) {
				if (val === undefined) {
					this.env.delete(key);
				} else {
					this.env.set(key, val);
				}
			}
		}

		// Apply output redirections
		result = this.applyOutputRedirections(result, redirState);

		this.exitCode = result.exitCode;

		// Errexit check
		this.checkErrexit(result, '', '');

		return result;
	}

	/** Resolve a command name and execute it. */
	private async resolveAndExecute(
		name: string,
		args: string[],
		stdin: string,
		_redirState: RedirectionState,
	): Promise<CommandResult> {
		// Check functions first
		const fn = this.functions.get(name);
		if (fn) {
			return this.callFunction(fn, args, stdin);
		}

		// Check builtins (Phase 5 will populate these)
		const builtin = this.builtins.get(name);
		if (builtin) {
			const ctx: InterpreterContext = {
				fs: this.fs,
				cwd: this.cwd,
				env: this.env,
				stdin,
				exec: (cmd: string) => this.executeString(cmd),
				interpreter: this,
			};
			return builtin(args, ctx);
		}

		// Check command registry
		const cmd = await this.registry.get(name);
		if (cmd) {
			const ctx: CommandContext = {
				fs: this.fs,
				cwd: this.cwd,
				env: this.env,
				stdin,
				exec: (cmd: string) => this.executeString(cmd),
			};
			return cmd.execute(args, ctx);
		}

		// Command not found
		return makeResult(127, '', `${name}: command not found\n`);
	}

	/** Call a user-defined function. */
	private async callFunction(
		fn: FunctionDefinition,
		args: string[],
		_stdin: string,
	): Promise<CommandResult> {
		this.callDepth++;
		if (this.callDepth > this.limits.maxCallDepth) {
			this.callDepth--;
			throw new LimitExceededError('maxCallDepth', this.callDepth, this.limits.maxCallDepth);
		}

		// Save and set positional params
		const savedParams = this.positionalParams;
		this.positionalParams = args;

		// Push local scope
		this.locals.push(new Map());

		let result: CommandResult;
		try {
			result = await this.executeCommand(fn.body);
		} catch (e) {
			if (e instanceof ReturnSignal) {
				result = makeResult(e.exitCode, '', '');
			} else {
				throw e;
			}
		} finally {
			// Pop local scope
			this.locals.pop();
			// Restore positional params
			this.positionalParams = savedParams;
			this.callDepth--;
		}

		return result;
	}

	/** Execute an if statement. */
	private async executeIf(node: IfStatement): Promise<CommandResult> {
		this.conditionalDepth++;
		const condResult = await this.executeList(node.condition);
		this.conditionalDepth--;

		if (condResult.exitCode === 0) {
			return this.executeList(node.then);
		}

		for (let i = 0; i < node.elifs.length; i++) {
			this.conditionalDepth++;
			const elifResult = await this.executeList(node.elifs[i].condition);
			this.conditionalDepth--;
			if (elifResult.exitCode === 0) {
				return this.executeList(node.elifs[i].then);
			}
		}

		if (node.else) {
			return this.executeList(node.else);
		}

		return makeResult(0, '', '');
	}

	/** Execute a for-in loop. */
	private async executeFor(node: ForStatement): Promise<CommandResult> {
		const words: string[] = [];
		for (let i = 0; i < node.words.length; i++) {
			const expanded = await expandWord(
				node.words[i],
				this.getShellState(),
				this.makeExpansionOpts(),
			);
			for (let j = 0; j < expanded.length; j++) {
				words.push(expanded[j]);
			}
		}

		// If no words specified, iterate over positional params
		const items = words.length > 0 ? words : this.positionalParams;

		let result = makeResult(0, '', '');

		for (let i = 0; i < items.length; i++) {
			this.loopIterations++;
			if (this.loopIterations > this.limits.maxLoopIterations) {
				throw new LimitExceededError(
					'maxLoopIterations',
					this.loopIterations,
					this.limits.maxLoopIterations,
				);
			}

			this.setVar(node.variable, items[i]);

			try {
				const bodyResult = await this.executeList(node.body);
				result = {
					exitCode: bodyResult.exitCode,
					stdout: result.stdout + bodyResult.stdout,
					stderr: result.stderr + bodyResult.stderr,
				};
			} catch (e) {
				// Capture any accumulated output from the signal
				const sig = e as Error & { _stdout?: string; _stderr?: string };
				if (sig._stdout) result = { ...result, stdout: result.stdout + sig._stdout };
				if (sig._stderr) result = { ...result, stderr: result.stderr + sig._stderr };

				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					continue;
				}
				throw e;
			}
		}

		return result;
	}

	/** Execute a C-style for loop. */
	private async executeForC(node: ForCStatement): Promise<CommandResult> {
		const state = this.getShellState();

		// Init
		if (node.init.expression) {
			evaluateArithmetic(node.init.expression, state);
		}

		let result = makeResult(0, '', '');

		while (true) {
			// Test
			if (node.test.expression) {
				const testVal = evaluateArithmetic(node.test.expression, state);
				if (testVal === 0) break;
			}

			this.loopIterations++;
			if (this.loopIterations > this.limits.maxLoopIterations) {
				throw new LimitExceededError(
					'maxLoopIterations',
					this.loopIterations,
					this.limits.maxLoopIterations,
				);
			}

			try {
				const bodyResult = await this.executeList(node.body);
				result = {
					exitCode: bodyResult.exitCode,
					stdout: result.stdout + bodyResult.stdout,
					stderr: result.stderr + bodyResult.stderr,
				};
			} catch (e) {
				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					// Fall through to update
				} else {
					throw e;
				}
			}

			// Update
			if (node.update.expression) {
				evaluateArithmetic(node.update.expression, state);
			}
		}

		return result;
	}

	/** Execute a while loop. */
	private async executeWhile(node: WhileStatement): Promise<CommandResult> {
		let result = makeResult(0, '', '');

		while (true) {
			this.loopIterations++;
			if (this.loopIterations > this.limits.maxLoopIterations) {
				throw new LimitExceededError(
					'maxLoopIterations',
					this.loopIterations,
					this.limits.maxLoopIterations,
				);
			}

			this.conditionalDepth++;
			const condResult = await this.executeList(node.condition);
			this.conditionalDepth--;

			if (condResult.exitCode !== 0) break;

			try {
				const bodyResult = await this.executeList(node.body);
				result = {
					exitCode: bodyResult.exitCode,
					stdout: result.stdout + bodyResult.stdout,
					stderr: result.stderr + bodyResult.stderr,
				};
			} catch (e) {
				// Capture any accumulated output from the signal
				const sig = e as Error & { _stdout?: string; _stderr?: string };
				if (sig._stdout) result = { ...result, stdout: result.stdout + sig._stdout };
				if (sig._stderr) result = { ...result, stderr: result.stderr + sig._stderr };

				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					continue;
				}
				throw e;
			}
		}

		return result;
	}

	/** Execute an until loop. */
	private async executeUntil(node: UntilStatement): Promise<CommandResult> {
		let result = makeResult(0, '', '');

		while (true) {
			this.loopIterations++;
			if (this.loopIterations > this.limits.maxLoopIterations) {
				throw new LimitExceededError(
					'maxLoopIterations',
					this.loopIterations,
					this.limits.maxLoopIterations,
				);
			}

			this.conditionalDepth++;
			const condResult = await this.executeList(node.condition);
			this.conditionalDepth--;

			if (condResult.exitCode === 0) break;

			try {
				const bodyResult = await this.executeList(node.body);
				result = {
					exitCode: bodyResult.exitCode,
					stdout: result.stdout + bodyResult.stdout,
					stderr: result.stderr + bodyResult.stderr,
				};
			} catch (e) {
				// Capture any accumulated output from the signal
				const sig = e as Error & { _stdout?: string; _stderr?: string };
				if (sig._stdout) result = { ...result, stdout: result.stdout + sig._stdout };
				if (sig._stderr) result = { ...result, stderr: result.stderr + sig._stderr };

				if (e instanceof BreakSignal) {
					if (e.levels > 1) throw new BreakSignal(e.levels - 1);
					break;
				}
				if (e instanceof ContinueSignal) {
					if (e.levels > 1) throw new ContinueSignal(e.levels - 1);
					continue;
				}
				throw e;
			}
		}

		return result;
	}

	/** Execute a case statement. */
	private async executeCase(node: CaseStatement): Promise<CommandResult> {
		const expanded = await expandWord(node.word, this.getShellState(), this.makeExpansionOpts());
		const value = expanded.join(' ');

		for (let i = 0; i < node.items.length; i++) {
			const item = node.items[i];
			let matched = false;

			for (let j = 0; j < item.patterns.length; j++) {
				const patExpanded = await expandWord(item.patterns[j], this.getShellState(), {
					...this.makeExpansionOpts(),
					casePattern: true,
				});
				const pattern = patExpanded.join(' ');
				if (globMatch(pattern, value) || pattern === '*') {
					matched = true;
					break;
				}
			}

			if (matched && item.body) {
				const result = await this.executeList(item.body);
				// ;; means stop, ;& means fall through, ;;& means test next
				if (item.terminator === ';;') return result;
				if (item.terminator === ';&') {
					// Fall through to next item's body
					if (i + 1 < node.items.length && node.items[i + 1].body) {
						return this.executeList(node.items[i + 1].body as List);
					}
					return result;
				}
				// ;;& - continue testing next patterns
			}
		}

		return makeResult(0, '', '');
	}

	/** Execute a subshell. */
	private async executeSubshell(node: Subshell): Promise<CommandResult> {
		// Clone env, share fs
		const savedEnv = this.env;
		const savedCwd = this.cwd;
		const savedExitCode = this.exitCode;
		const savedOptions = { ...this.options };

		this.env = new Map(savedEnv);

		try {
			return await this.executeList(node.body);
		} finally {
			this.env = savedEnv;
			this.cwd = savedCwd;
			this.exitCode = savedExitCode;
			this.options = savedOptions;
		}
	}

	/** Execute a brace group. */
	private async executeBraceGroup(node: BraceGroup): Promise<CommandResult> {
		return this.executeList(node.body);
	}

	/** Execute a function definition (registers the function). */
	private async executeFunctionDef(node: FunctionDefinition): Promise<CommandResult> {
		this.functions.set(node.name, node);
		return makeResult(0, '', '');
	}

	/** Execute a [[ conditional expression ]]. */
	private async executeConditionalExpression(_node: ConditionalExpression): Promise<CommandResult> {
		// Placeholder - Phase 5 builds will fully implement this
		return makeResult(0, '', '');
	}

	/** Execute a string as a command (for command substitution). */
	async executeString(input: string): Promise<CommandResult> {
		const program = parse(input);
		return this.execute(program);
	}

	/** Execute a command substitution, returning captured stdout. */
	private async executeCommandSubstitution(cmd: string): Promise<string> {
		const program = parse(cmd);
		// Execute in a subshell context
		const savedEnv = this.env;
		this.env = new Map(savedEnv);

		try {
			const result = await this.execute(program);
			return result.stdout;
		} finally {
			this.env = savedEnv;
		}
	}

	/** Get a variable value (checks locals then env). */
	getVar(name: string): string | undefined {
		// Check local scopes (innermost first)
		for (let i = this.locals.length - 1; i >= 0; i--) {
			if (this.locals[i].has(name)) {
				return this.locals[i].get(name);
			}
		}
		return this.env.get(name);
	}

	/** Set a variable value (in local scope if available, otherwise env). */
	setVar(name: string, value: string): void {
		if (this.readonlyVars.has(name)) {
			throw new Error(`${name}: readonly variable`);
		}

		if (this.locals.length > 0) {
			const topScope = this.locals[this.locals.length - 1];
			if (topScope.has(name)) {
				topScope.set(name, value);
				return;
			}
		}
		this.env.set(name, value);
	}

	/** Get the current working directory. */
	getCwd(): string {
		return this.cwd;
	}

	/** Set the current working directory. */
	setCwd(newCwd: string): void {
		this.cwd = newCwd;
	}

	/** Get runtime options. */
	getOptions(): ShellRuntimeOptions {
		return this.options;
	}

	/** Get the filesystem. */
	getFs(): FileSystem {
		return this.fs;
	}

	/**
	 * Check if errexit should trigger after a command.
	 * Throws ErrexitError if:
	 * - errexit is enabled
	 * - exitCode is non-zero
	 * - we are NOT in a conditional context
	 */
	private checkErrexit(
		result: CommandResult,
		accumulatedStdout: string,
		accumulatedStderr: string,
	): void {
		if (this.options.errexit && result.exitCode !== 0 && this.conditionalDepth === 0) {
			throw new ErrexitError(
				accumulatedStdout + result.stdout,
				accumulatedStderr + result.stderr,
				result.exitCode,
			);
		}
	}

	/** Apply redirections and return the modified I/O state. */
	private applyRedirections(redirections: Redirection[], stdin: string): RedirectionState {
		const state: RedirectionState = {
			stdin,
			stdoutFile: null,
			stderrFile: null,
			stdoutAppend: false,
			stderrAppend: false,
			mergeStderrToStdout: false,
			mergeStdoutToStderr: false,
			discardStdout: false,
			discardStderr: false,
		};

		for (let i = 0; i < redirections.length; i++) {
			const redir = redirections[i];
			const op = redir.operator;
			const fd = redir.fd;

			if (redir.heredoc) {
				state.stdin = redir.heredoc.content;
				continue;
			}

			// Get target path
			// (in a full implementation we'd expand the target word)
			let target = '';
			if (redir.target.type === 'LiteralWord') {
				target = redir.target.value;
			}

			if (op === '<') {
				if (target === '/dev/null') {
					state.stdin = '';
				} else {
					try {
						const content = this.fs.readFile(this.resolvePath(target));
						state.stdin = typeof content === 'string' ? content : '';
					} catch {
						state.stdin = '';
					}
				}
			} else if (op === '>') {
				if (target === '/dev/null') {
					if (fd === 2) state.discardStderr = true;
					else state.discardStdout = true;
				} else {
					if (fd === 2) {
						state.stderrFile = this.resolvePath(target);
						state.stderrAppend = false;
					} else {
						state.stdoutFile = this.resolvePath(target);
						state.stdoutAppend = false;
					}
				}
			} else if (op === '>>') {
				if (fd === 2) {
					state.stderrFile = this.resolvePath(target);
					state.stderrAppend = true;
				} else {
					state.stdoutFile = this.resolvePath(target);
					state.stdoutAppend = true;
				}
			} else if (op === '>&') {
				if (target === '1') {
					state.mergeStderrToStdout = true;
				} else if (target === '2') {
					state.mergeStdoutToStderr = true;
				} else if (target === '/dev/null' || fd === null) {
					state.stdoutFile = this.resolvePath(target);
					state.stderrFile = this.resolvePath(target);
				}
			} else if (op === '&>') {
				if (target === '/dev/null') {
					state.discardStdout = true;
					state.discardStderr = true;
				} else {
					const resolved = this.resolvePath(target);
					state.stdoutFile = resolved;
					state.stderrFile = resolved;
				}
			}
		}

		return state;
	}

	/** Apply output redirections to a command result. */
	private applyOutputRedirections(result: CommandResult, state: RedirectionState): CommandResult {
		let stdout = result.stdout;
		let stderr = result.stderr;

		if (state.mergeStderrToStdout) {
			stdout = stdout + stderr;
			stderr = '';
		}

		if (state.mergeStdoutToStderr) {
			stderr = stderr + stdout;
			stdout = '';
		}

		if (state.discardStdout) stdout = '';
		if (state.discardStderr) stderr = '';

		if (state.stdoutFile) {
			if (state.stdoutAppend) {
				this.fs.appendFile(state.stdoutFile, stdout);
			} else {
				this.fs.writeFile(state.stdoutFile, stdout);
			}
			stdout = '';
		}

		if (state.stderrFile && state.stderrFile !== state.stdoutFile) {
			if (state.stderrAppend) {
				this.fs.appendFile(state.stderrFile, stderr);
			} else {
				this.fs.writeFile(state.stderrFile, stderr);
			}
			stderr = '';
		}

		return { exitCode: result.exitCode, stdout, stderr };
	}

	/** Resolve a path relative to cwd. */
	private resolvePath(path: string): string {
		if (path.startsWith('/')) return path;
		if (this.cwd === '/') return `/${path}`;
		return `${this.cwd}/${path}`;
	}

	/** Register a builtin command handler. */
	registerBuiltin(
		name: string,
		handler: (args: string[], ctx: InterpreterContext) => Promise<CommandResult>,
	): void {
		this.builtins.set(name, handler);
	}
}

/** Interpreter context passed to builtin commands. */
export interface InterpreterContext {
	fs: FileSystem;
	cwd: string;
	env: Map<string, string>;
	stdin: string;
	exec: (cmd: string) => Promise<CommandResult>;
	interpreter: Interpreter;
}

/** State tracking for I/O redirections. */
interface RedirectionState {
	stdin: string;
	stdoutFile: string | null;
	stderrFile: string | null;
	stdoutAppend: boolean;
	stderrAppend: boolean;
	mergeStderrToStdout: boolean;
	mergeStdoutToStderr: boolean;
	discardStdout: boolean;
	discardStderr: boolean;
}
