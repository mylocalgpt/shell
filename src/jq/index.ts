/**
 * Public API for the jq engine.
 *
 * Independently importable - no shell dependency.
 */

import { JqRuntimeError } from './errors.js';
import { createEnv, evaluate, jsonPretty, jsonStringify, parseJsonStream } from './evaluator.js';
import type { JqLimits, JsonValue } from './evaluator.js';
import { parseJq } from './parser.js';

// Re-exports
export type { JqNode } from './ast.js';
export type { JsonValue, JsonObject, JqLimits, JqEnv } from './evaluator.js';
export { JqError, JqParseError, JqRuntimeError, JqTypeError, JqHaltError } from './errors.js';
export type { JqPosition } from './errors.js';
export { parseJq } from './parser.js';
export {
	evaluate,
	createEnv,
	jqCompare,
	jsonStringify,
	jsonPretty,
	parseJsonStream,
} from './evaluator.js';

/**
 * Options for the jq() function.
 * Designed for extension by later phases.
 */
export interface JqOptions {
	/** Output strings without quotes. */
	rawOutput?: boolean;
	/** Compact output (no whitespace). */
	compactOutput?: boolean;
	/** Sort object keys in output. */
	sortKeys?: boolean;
	/** Use tabs for indentation. */
	tab?: boolean;
	/** Use null as input (ignore actual input). */
	nullInput?: boolean;
	/** Collect all inputs into an array before filtering. */
	slurp?: boolean;
	/** Bind named variables as strings. */
	args?: Record<string, string>;
	/** Bind named variables as parsed JSON. */
	argjson?: Record<string, JsonValue>;
	/** Execution limits. */
	limits?: Partial<JqLimits>;
}

/**
 * Run a jq filter on JSON input and return the formatted output.
 *
 * @param input - JSON string (may contain concatenated values)
 * @param filter - jq filter expression
 * @param options - Output options
 * @returns Formatted output string
 * @throws JqParseError on syntax errors
 * @throws JqRuntimeError on evaluation errors
 * @throws JqTypeError on type mismatches
 */
export function jq(input: string, filter: string, options?: JqOptions): string {
	const ast = parseJq(filter);
	const env = createEnv(options?.limits);

	// Bind user args
	if (options?.args) {
		const keys = Object.keys(options.args);
		for (let i = 0; i < keys.length; i++) {
			env.variables.set(keys[i], options.args[keys[i]]);
		}
	}
	if (options?.argjson) {
		const keys = Object.keys(options.argjson);
		for (let i = 0; i < keys.length; i++) {
			env.variables.set(keys[i], options.argjson[keys[i]]);
		}
	}

	// Parse input(s)
	let inputs: JsonValue[];
	if (options?.nullInput) {
		inputs = [null];
	} else {
		const trimmed = input.trim();
		if (trimmed.length === 0) {
			throw new JqRuntimeError('no input provided');
		}
		inputs = parseJsonStream(trimmed);
		if (inputs.length === 0) {
			throw new JqRuntimeError('no input provided');
		}
	}

	if (options?.slurp) {
		inputs = [inputs];
	}

	// Evaluate
	const outputs: JsonValue[] = [];
	for (let i = 0; i < inputs.length; i++) {
		for (const result of evaluate(ast, inputs[i], env)) {
			outputs.push(result);
		}
	}

	// Format output
	const rawOutput = options?.rawOutput ?? false;
	const compact = options?.compactOutput ?? false;
	const sortKeys = options?.sortKeys ?? false;
	const indent = options?.tab ? '\t' : '  ';

	const lines: string[] = [];
	for (let i = 0; i < outputs.length; i++) {
		const v = outputs[i];
		if (rawOutput && typeof v === 'string') {
			lines.push(v);
		} else if (compact) {
			lines.push(jsonStringify(v, sortKeys));
		} else {
			lines.push(jsonPretty(v, indent, sortKeys));
		}
	}

	return lines.join('\n');
}
