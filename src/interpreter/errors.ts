import type { SourcePosition } from '../parser/ast.js';

/** Thrown when set -e (errexit) triggers on a non-zero exit. */
export class ErrexitError extends Error {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;

	constructor(stdout: string, stderr: string, exitCode: number) {
		super(`errexit: command failed with exit code ${exitCode}`);
		this.name = 'ErrexitError';
		this.stdout = stdout;
		this.stderr = stderr;
		this.exitCode = exitCode;
	}
}

/** Thrown when an execution limit is exceeded. */
export class LimitExceededError extends Error {
	readonly limitName: string;
	readonly currentValue: number;
	readonly maxValue: number;

	constructor(limitName: string, currentValue: number, maxValue: number) {
		super(`limit exceeded: ${limitName} (${currentValue} >= ${maxValue})`);
		this.name = 'LimitExceededError';
		this.limitName = limitName;
		this.currentValue = currentValue;
		this.maxValue = maxValue;
	}
}

/** Control flow signal for the return builtin. */
export class ReturnSignal extends Error {
	readonly exitCode: number;

	constructor(exitCode: number) {
		super('return');
		this.name = 'ReturnSignal';
		this.exitCode = exitCode;
	}
}

/** Control flow signal for the break builtin. */
export class BreakSignal extends Error {
	readonly levels: number;

	constructor(levels: number) {
		super('break');
		this.name = 'BreakSignal';
		this.levels = levels;
	}
}

/** Control flow signal for the continue builtin. */
export class ContinueSignal extends Error {
	readonly levels: number;

	constructor(levels: number) {
		super('continue');
		this.name = 'ContinueSignal';
		this.levels = levels;
	}
}

/** Control flow signal for the exit builtin. */
export class ExitSignal extends Error {
	readonly exitCode: number;

	constructor(exitCode: number) {
		super('exit');
		this.name = 'ExitSignal';
		this.exitCode = exitCode;
	}
}

/** Re-export ParseError from the parser module. */
export { ParseError } from '../parser/parser.js';
