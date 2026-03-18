/**
 * jq-specific error classes.
 *
 * All jq errors extend JqError which carries an optional source position.
 * The evaluator, parser, and tokenizer each throw the appropriate subclass.
 */

/** Source position within a jq filter string. */
export interface JqPosition {
	offset: number;
	line: number;
	column: number;
}

/** Base class for all jq errors. */
export class JqError extends Error {
	readonly position: JqPosition | undefined;

	constructor(message: string, position?: JqPosition) {
		super(message);
		this.name = 'JqError';
		this.position = position;
	}
}

/** Tokenizer or parser error with position info. */
export class JqParseError extends JqError {
	constructor(message: string, position?: JqPosition) {
		super(message, position);
		this.name = 'JqParseError';
	}
}

/** Evaluation error (wrong value, missing key, etc.). */
export class JqRuntimeError extends JqError {
	constructor(message: string, position?: JqPosition) {
		super(message, position);
		this.name = 'JqRuntimeError';
	}
}

/** Type mismatch during evaluation. */
export class JqTypeError extends JqError {
	constructor(message: string, position?: JqPosition) {
		super(message, position);
		this.name = 'JqTypeError';
	}
}

/** Thrown by halt/halt_error builtins. Carries an exit code. */
export class JqHaltError extends JqError {
	readonly exitCode: number;

	constructor(message: string, exitCode: number, position?: JqPosition) {
		super(message, position);
		this.name = 'JqHaltError';
		this.exitCode = exitCode;
	}
}
