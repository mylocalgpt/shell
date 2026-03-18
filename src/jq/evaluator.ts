/**
 * Generator-based evaluator for the jq filter language.
 *
 * jq is fundamentally a generator language: most operations produce
 * zero, one, or many outputs. The evaluator uses JS generators to
 * model this naturally without intermediate arrays.
 */

import type { JqNode, ObjectEntry } from './ast.js';
import { JqRuntimeError, JqTypeError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A JSON-compatible value. Plain JS primitives, arrays, and objects.
 * No wrapping, no classes.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object with string keys. */
export interface JsonObject {
	[key: string]: JsonValue;
}

/** Execution limits for the jq engine. */
export interface JqLimits {
	maxLoopIterations: number;
	maxCallDepth: number;
	maxStringLength: number;
	maxArraySize: number;
	maxOutputSize: number;
}

/** Default execution limits. */
export const DEFAULT_JQ_LIMITS: JqLimits = {
	maxLoopIterations: 100_000,
	maxCallDepth: 200,
	maxStringLength: 1_000_000,
	maxArraySize: 100_000,
	maxOutputSize: 10_000_000,
};

/** A user-defined function. */
export interface JqFuncDef {
	params: string[];
	body: JqNode;
}

/**
 * Evaluation environment. Passed through the evaluator.
 * Variable bindings and function definitions use Maps.
 */
export interface JqEnv {
	variables: Map<string, JsonValue>;
	functions: Map<string, JqFuncDef>;
	depth: number;
	limits: JqLimits;
	outputSize: number;
	stderrSink?: (msg: string) => void;
	envVars?: Map<string, string>;
	inputSource?: () => Generator<JsonValue>;
	nowFn?: () => number;
}

/** Sentinel thrown to represent jq `empty` (zero outputs). */
export const JQ_EMPTY = Symbol('jq-empty');

/** Sentinel for break $label. */
export class JqBreak {
	readonly label: string;
	constructor(label: string) {
		this.label = label;
	}
}

// ---------------------------------------------------------------------------
// Helper: create a child environment with new variable bindings
// ---------------------------------------------------------------------------

export function childEnv(parent: JqEnv, bindings?: Map<string, JsonValue>): JqEnv {
	const vars = new Map(parent.variables);
	if (bindings) {
		for (const [k, v] of bindings) {
			vars.set(k, v);
		}
	}
	return {
		variables: vars,
		functions: parent.functions,
		depth: parent.depth,
		limits: parent.limits,
		outputSize: parent.outputSize,
		stderrSink: parent.stderrSink,
		envVars: parent.envVars,
		inputSource: parent.inputSource,
		nowFn: parent.nowFn,
	};
}

export function createEnv(limits?: Partial<JqLimits>): JqEnv {
	const l: JqLimits = { ...DEFAULT_JQ_LIMITS };
	if (limits) {
		if (limits.maxLoopIterations !== undefined) l.maxLoopIterations = limits.maxLoopIterations;
		if (limits.maxCallDepth !== undefined) l.maxCallDepth = limits.maxCallDepth;
		if (limits.maxStringLength !== undefined) l.maxStringLength = limits.maxStringLength;
		if (limits.maxArraySize !== undefined) l.maxArraySize = limits.maxArraySize;
		if (limits.maxOutputSize !== undefined) l.maxOutputSize = limits.maxOutputSize;
	}
	return {
		variables: new Map(),
		functions: new Map(),
		depth: 0,
		limits: l,
		outputSize: 0,
	};
}

// ---------------------------------------------------------------------------
// jq value helpers
// ---------------------------------------------------------------------------

function isTruthy(v: JsonValue): boolean {
	return v !== false && v !== null;
}

function typeOf(v: JsonValue): string {
	if (v === null) return 'null';
	if (typeof v === 'boolean') return 'boolean';
	if (typeof v === 'number') return 'number';
	if (typeof v === 'string') return 'string';
	if (Array.isArray(v)) return 'array';
	return 'object';
}

/** jq type ordering for comparison: null < false < true < number < string < array < object */
function typeOrder(v: JsonValue): number {
	if (v === null) return 0;
	if (v === false) return 1;
	if (v === true) return 2;
	if (typeof v === 'number') return 3;
	if (typeof v === 'string') return 4;
	if (Array.isArray(v)) return 5;
	return 6;
}

/**
 * Compare two jq values using jq ordering.
 * Returns negative, zero, or positive.
 */
export function jqCompare(a: JsonValue, b: JsonValue): number {
	const ta = typeOrder(a);
	const tb = typeOrder(b);
	if (ta !== tb) return ta - tb;

	// Same type
	if (a === null) return 0;
	if (typeof a === 'boolean') return 0; // true vs true or false vs false (same type order means same boolean)
	if (typeof a === 'number' && typeof b === 'number') {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	}
	if (typeof a === 'string' && typeof b === 'string') {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		const len = Math.min(a.length, b.length);
		for (let i = 0; i < len; i++) {
			const cmp = jqCompare(a[i], b[i]);
			if (cmp !== 0) return cmp;
		}
		return a.length - b.length;
	}
	// Objects: compare sorted key-value pairs
	if (
		typeof a === 'object' &&
		a !== null &&
		typeof b === 'object' &&
		b !== null &&
		!Array.isArray(a) &&
		!Array.isArray(b)
	) {
		const keysA = Object.keys(a).sort();
		const keysB = Object.keys(b).sort();
		const len = Math.min(keysA.length, keysB.length);
		for (let i = 0; i < len; i++) {
			if (keysA[i] < keysB[i]) return -1;
			if (keysA[i] > keysB[i]) return 1;
			const cmp = jqCompare(a[keysA[i]], b[keysB[i]]);
			if (cmp !== 0) return cmp;
		}
		return keysA.length - keysB.length;
	}
	return 0;
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
	return jqCompare(a, b) === 0;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a jq AST node against an input value, yielding zero or more outputs.
 */
export function* evaluate(node: JqNode, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	switch (node.type) {
		case 'Identity':
			yield input;
			return;

		case 'RecursiveDescent':
			yield* recursiveDescent(input);
			return;

		case 'Field':
			yield* evalField(node.name, input);
			return;

		case 'Index':
			yield* evalIndex(node, input, env);
			return;

		case 'Slice':
			yield* evalSlice(node, input, env);
			return;

		case 'Iterate':
			yield* evalIterate(input);
			return;

		case 'Pipe':
			for (const intermediate of evaluate(node.left, input, env)) {
				yield* evaluate(node.right, intermediate, env);
			}
			return;

		case 'Comma':
			yield* evaluate(node.left, input, env);
			yield* evaluate(node.right, input, env);
			return;

		case 'Literal':
			yield node.value;
			return;

		case 'ArrayConstruction': {
			if (node.expr === null) {
				yield [];
				return;
			}
			const arr: JsonValue[] = [];
			for (const v of evaluate(node.expr, input, env)) {
				if (arr.length >= env.limits.maxArraySize) {
					throw new JqRuntimeError(`array size exceeds limit (${env.limits.maxArraySize})`);
				}
				arr.push(v);
			}
			yield arr;
			return;
		}

		case 'ObjectConstruction':
			yield* evalObjectConstruction(node.entries, input, env);
			return;

		case 'Arithmetic':
			yield* evalArithmetic(node.op, node.left, node.right, input, env);
			return;

		case 'Comparison':
			yield* evalComparison(node.op, node.left, node.right, input, env);
			return;

		case 'Logic':
			yield* evalLogic(node.op, node.left, node.right, input, env);
			return;

		case 'Not':
			yield* evalNot(node.expr, input, env);
			return;

		case 'Negate':
			yield* evalNegate(node.expr, input, env);
			return;

		case 'Alternative':
			yield* evalAlternative(node.left, node.right, input, env);
			return;

		case 'Optional':
			yield* evalOptional(node.expr, input, env);
			return;

		case 'StringInterpolation':
			yield* evalStringInterpolation(node.parts, input, env);
			return;

		case 'Variable':
			yield* evalVariable(node.name, env);
			return;

		case 'Format':
			yield* evalFormat(node, input, env);
			return;

		// Placeholders for Phase 3 nodes - throw clear errors
		case 'If':
		case 'TryCatch':
		case 'Reduce':
		case 'Foreach':
		case 'Label':
		case 'Break':
		case 'FunctionDef':
		case 'FunctionCall':
		case 'VariableBinding':
		case 'Update':
		case 'UpdateOp':
			throw new JqRuntimeError(`${node.type} not yet implemented`);

		default: {
			const _exhaustive: never = node;
			throw new JqRuntimeError(`unknown node type: ${(_exhaustive as JqNode).type}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Node handlers
// ---------------------------------------------------------------------------

function* recursiveDescent(input: JsonValue): Generator<JsonValue> {
	// Use explicit stack to avoid stack overflow on deeply nested inputs
	const stack: JsonValue[] = [input];
	while (stack.length > 0) {
		const v = stack.pop() as JsonValue;
		yield v;
		if (Array.isArray(v)) {
			// Push in reverse order so we iterate left-to-right
			for (let i = v.length - 1; i >= 0; i--) {
				stack.push(v[i]);
			}
		} else if (v !== null && typeof v === 'object') {
			const keys = Object.keys(v);
			for (let i = keys.length - 1; i >= 0; i--) {
				stack.push(v[keys[i]]);
			}
		}
	}
}

function* evalField(name: string, input: JsonValue): Generator<JsonValue> {
	if (input === null) {
		yield null;
		return;
	}
	if (typeof input === 'object' && !Array.isArray(input)) {
		yield (input as JsonObject)[name] ?? null;
		return;
	}
	throw new JqTypeError(`cannot index ${typeOf(input)} with string "${name}"`);
}

function* evalIndex(node: { index: JqNode }, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	for (const idx of evaluate(node.index, input, env)) {
		if (typeof idx === 'number') {
			if (Array.isArray(input)) {
				const i = idx < 0 ? input.length + idx : idx;
				yield input[i] ?? null;
			} else if (input === null) {
				yield null;
			} else {
				throw new JqTypeError(`cannot index ${typeOf(input)} with number`);
			}
		} else if (typeof idx === 'string') {
			if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
				yield (input as JsonObject)[idx] ?? null;
			} else if (input === null) {
				yield null;
			} else {
				throw new JqTypeError(`cannot index ${typeOf(input)} with string "${idx}"`);
			}
		} else {
			throw new JqTypeError(`invalid index type: ${typeOf(idx)}`);
		}
	}
}

function* evalSlice(
	node: { from: JqNode | null; to: JqNode | null },
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	if (input === null) {
		yield null;
		return;
	}

	if (Array.isArray(input)) {
		const len = input.length;
		let from = 0;
		let to = len;
		if (node.from !== null) {
			for (const v of evaluate(node.from, input, env)) {
				from = typeof v === 'number' ? v : 0;
			}
		}
		if (node.to !== null) {
			for (const v of evaluate(node.to, input, env)) {
				to = typeof v === 'number' ? v : len;
			}
		}
		if (from < 0) from = Math.max(0, len + from);
		if (to < 0) to = Math.max(0, len + to);
		from = Math.min(from, len);
		to = Math.min(to, len);
		yield input.slice(from, to);
		return;
	}

	if (typeof input === 'string') {
		const len = input.length;
		let from = 0;
		let to = len;
		if (node.from !== null) {
			for (const v of evaluate(node.from, input, env)) {
				from = typeof v === 'number' ? v : 0;
			}
		}
		if (node.to !== null) {
			for (const v of evaluate(node.to, input, env)) {
				to = typeof v === 'number' ? v : len;
			}
		}
		if (from < 0) from = Math.max(0, len + from);
		if (to < 0) to = Math.max(0, len + to);
		from = Math.min(from, len);
		to = Math.min(to, len);
		yield input.slice(from, to);
		return;
	}

	throw new JqTypeError(`cannot slice ${typeOf(input)}`);
}

function* evalIterate(input: JsonValue): Generator<JsonValue> {
	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			yield input[i];
		}
		return;
	}
	if (input !== null && typeof input === 'object') {
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			yield (input as JsonObject)[keys[i]];
		}
		return;
	}
	throw new JqTypeError(`cannot iterate over ${typeOf(input)}`);
}

function* evalObjectConstruction(
	entries: ObjectEntry[],
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	// Object construction can produce multiple outputs when expressions produce multiple outputs.
	// We use a recursive approach to handle the cartesian product.
	yield* buildObject(entries, 0, {}, input, env);
}

function* buildObject(
	entries: ObjectEntry[],
	idx: number,
	acc: JsonObject,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	if (idx >= entries.length) {
		yield acc;
		return;
	}

	const entry = entries[idx];

	// Evaluate key
	for (const keyVal of evaluate(entry.key, input, env)) {
		const key = typeof keyVal === 'string' ? keyVal : jsonStringify(keyVal);

		if (entry.value === null) {
			// Shorthand without value - for identifiers, this means .ident
			const obj: JsonObject = {};
			const keys = Object.keys(acc);
			for (let i = 0; i < keys.length; i++) {
				obj[keys[i]] = acc[keys[i]];
			}
			obj[key] = null;
			yield* buildObject(entries, idx + 1, obj, input, env);
		} else {
			// Evaluate value
			for (const val of evaluate(entry.value, input, env)) {
				const obj: JsonObject = {};
				const keys = Object.keys(acc);
				for (let i = 0; i < keys.length; i++) {
					obj[keys[i]] = acc[keys[i]];
				}
				obj[key] = val;
				yield* buildObject(entries, idx + 1, obj, input, env);
			}
		}
	}
}

function* evalArithmetic(
	op: '+' | '-' | '*' | '/' | '%',
	leftNode: JqNode,
	rightNode: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	for (const left of evaluate(leftNode, input, env)) {
		for (const right of evaluate(rightNode, input, env)) {
			yield applyArithmetic(op, left, right);
		}
	}
}

function applyArithmetic(
	op: '+' | '-' | '*' | '/' | '%',
	left: JsonValue,
	right: JsonValue,
): JsonValue {
	if (op === '+') {
		// Number + Number
		if (typeof left === 'number' && typeof right === 'number') return left + right;
		// String + String
		if (typeof left === 'string' && typeof right === 'string') return left + right;
		// Array + Array
		if (Array.isArray(left) && Array.isArray(right)) {
			const result: JsonValue[] = [];
			for (let i = 0; i < left.length; i++) result.push(left[i]);
			for (let i = 0; i < right.length; i++) result.push(right[i]);
			return result;
		}
		// Object + Object (merge)
		if (
			left !== null &&
			typeof left === 'object' &&
			!Array.isArray(left) &&
			right !== null &&
			typeof right === 'object' &&
			!Array.isArray(right)
		) {
			const result: JsonObject = {};
			const lKeys = Object.keys(left);
			for (let i = 0; i < lKeys.length; i++) result[lKeys[i]] = (left as JsonObject)[lKeys[i]];
			const rKeys = Object.keys(right);
			for (let i = 0; i < rKeys.length; i++) result[rKeys[i]] = (right as JsonObject)[rKeys[i]];
			return result;
		}
		// null + x = x, x + null = x
		if (left === null) return right;
		if (right === null) return left;
		throw new JqTypeError(`${typeOf(left)} and ${typeOf(right)} cannot be added`);
	}

	if (op === '-') {
		if (typeof left === 'number' && typeof right === 'number') return left - right;
		// Array - Array (remove elements)
		if (Array.isArray(left) && Array.isArray(right)) {
			const result: JsonValue[] = [];
			for (let i = 0; i < left.length; i++) {
				let found = false;
				for (let j = 0; j < right.length; j++) {
					if (deepEqual(left[i], right[j])) {
						found = true;
						break;
					}
				}
				if (!found) result.push(left[i]);
			}
			return result;
		}
		throw new JqTypeError(`${typeOf(left)} and ${typeOf(right)} cannot be subtracted`);
	}

	if (op === '*') {
		if (typeof left === 'number' && typeof right === 'number') return left * right;
		// String * Object: format/interpolation (rare, skip for now)
		// Object * Object: recursive merge
		if (
			left !== null &&
			typeof left === 'object' &&
			!Array.isArray(left) &&
			right !== null &&
			typeof right === 'object' &&
			!Array.isArray(right)
		) {
			return recursiveMerge(left as JsonObject, right as JsonObject);
		}
		throw new JqTypeError(`${typeOf(left)} and ${typeOf(right)} cannot be multiplied`);
	}

	if (op === '/') {
		if (typeof left === 'number' && typeof right === 'number') {
			if (right === 0) throw new JqRuntimeError('division by zero');
			return left / right;
		}
		// String / String: split
		if (typeof left === 'string' && typeof right === 'string') {
			return left.split(right);
		}
		throw new JqTypeError(`${typeOf(left)} and ${typeOf(right)} cannot be divided`);
	}

	if (op === '%') {
		if (typeof left === 'number' && typeof right === 'number') {
			if (right === 0) throw new JqRuntimeError('modulo by zero');
			return left % right;
		}
		throw new JqTypeError(`${typeOf(left)} and ${typeOf(right)} cannot use modulo`);
	}

	throw new JqRuntimeError(`unknown arithmetic operator: ${op}`);
}

function recursiveMerge(a: JsonObject, b: JsonObject): JsonObject {
	const result: JsonObject = {};
	const aKeys = Object.keys(a);
	for (let i = 0; i < aKeys.length; i++) {
		result[aKeys[i]] = a[aKeys[i]];
	}
	const bKeys = Object.keys(b);
	for (let i = 0; i < bKeys.length; i++) {
		const key = bKeys[i];
		const av = result[key];
		const bv = b[key];
		if (
			av !== null &&
			typeof av === 'object' &&
			!Array.isArray(av) &&
			bv !== null &&
			typeof bv === 'object' &&
			!Array.isArray(bv)
		) {
			result[key] = recursiveMerge(av as JsonObject, bv as JsonObject);
		} else {
			result[key] = bv;
		}
	}
	return result;
}

function* evalComparison(
	op: '==' | '!=' | '<' | '>' | '<=' | '>=',
	leftNode: JqNode,
	rightNode: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	for (const left of evaluate(leftNode, input, env)) {
		for (const right of evaluate(rightNode, input, env)) {
			const cmp = jqCompare(left, right);
			switch (op) {
				case '==':
					yield cmp === 0;
					break;
				case '!=':
					yield cmp !== 0;
					break;
				case '<':
					yield cmp < 0;
					break;
				case '>':
					yield cmp > 0;
					break;
				case '<=':
					yield cmp <= 0;
					break;
				case '>=':
					yield cmp >= 0;
					break;
			}
		}
	}
}

function* evalLogic(
	op: 'and' | 'or',
	leftNode: JqNode,
	rightNode: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	for (const left of evaluate(leftNode, input, env)) {
		if (op === 'and') {
			if (!isTruthy(left)) {
				yield false;
			} else {
				for (const right of evaluate(rightNode, input, env)) {
					yield isTruthy(right);
				}
			}
		} else {
			// or
			if (isTruthy(left)) {
				yield true;
			} else {
				for (const right of evaluate(rightNode, input, env)) {
					yield isTruthy(right);
				}
			}
		}
	}
}

function* evalNot(expr: JqNode, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	for (const v of evaluate(expr, input, env)) {
		yield !isTruthy(v);
	}
}

function* evalNegate(expr: JqNode, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	for (const v of evaluate(expr, input, env)) {
		if (typeof v !== 'number') {
			throw new JqTypeError(`cannot negate ${typeOf(v)}`);
		}
		yield -v;
	}
}

function* evalAlternative(
	leftNode: JqNode,
	rightNode: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	let hasOutput = false;
	for (const v of evaluate(leftNode, input, env)) {
		if (isTruthy(v)) {
			yield v;
			hasOutput = true;
		}
	}
	if (!hasOutput) {
		yield* evaluate(rightNode, input, env);
	}
}

function* evalOptional(expr: JqNode, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	try {
		yield* evaluate(expr, input, env);
	} catch (e) {
		if (e instanceof JqRuntimeError || e instanceof JqTypeError) {
			// Suppress errors, yield nothing
			return;
		}
		throw e;
	}
}

function* evalStringInterpolation(
	parts: JqNode[],
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	// Parts alternate between string literals and expressions.
	// We need to handle the cartesian product of all expression outputs.
	yield* buildString(parts, 0, '', input, env);
}

function* buildString(
	parts: JqNode[],
	idx: number,
	acc: string,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	if (idx >= parts.length) {
		yield acc;
		return;
	}

	const part = parts[idx];
	if (part.type === 'Literal' && typeof part.value === 'string') {
		yield* buildString(parts, idx + 1, acc + part.value, input, env);
	} else {
		for (const v of evaluate(part, input, env)) {
			const s = typeof v === 'string' ? v : jsonStringify(v);
			yield* buildString(parts, idx + 1, acc + s, input, env);
		}
	}
}

function* evalVariable(name: string, env: JqEnv): Generator<JsonValue> {
	if (name === 'ENV') {
		const obj: JsonObject = {};
		if (env.envVars) {
			for (const [k, v] of env.envVars) {
				obj[k] = v;
			}
		}
		yield obj;
		return;
	}
	const val = env.variables.get(name);
	if (val !== undefined) {
		yield val;
		return;
	}
	throw new JqRuntimeError(`$${name} is not defined`);
}

function* evalFormat(
	node: { name: string; str: JqNode | null },
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	// Basic format support - full implementation in Phase 4
	if (node.str !== null) {
		// Format with string argument
		for (const v of evaluate(node.str, input, env)) {
			const s = typeof v === 'string' ? v : jsonStringify(v);
			yield applyFormat(node.name, s);
		}
	} else {
		// Format applied to input
		const s = typeof input === 'string' ? input : jsonStringify(input);
		yield applyFormat(node.name, s);
	}
}

function applyFormat(name: string, value: string): string {
	switch (name) {
		case 'json':
			return JSON.stringify(value);
		case 'text':
			return value;
		case 'html': {
			let result = '';
			for (let i = 0; i < value.length; i++) {
				const ch = value[i];
				if (ch === '<') result += '&lt;';
				else if (ch === '>') result += '&gt;';
				else if (ch === '&') result += '&amp;';
				else if (ch === "'") result += '&#39;';
				else if (ch === '"') result += '&quot;';
				else result += ch;
			}
			return result;
		}
		case 'sh': {
			return `'${value.replace(/'/g, "'\\''")}'`;
		}
		default:
			throw new JqRuntimeError(`unknown format: @${name}`);
	}
}

// ---------------------------------------------------------------------------
// JSON stringify (for output formatting)
// ---------------------------------------------------------------------------

/**
 * Stringify a JsonValue to a JSON string. Compact format.
 * Handles the jq convention where numbers with no fractional part
 * are printed without decimal point.
 */
export function jsonStringify(value: JsonValue, sortKeys?: boolean): string {
	if (value === null) return 'null';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			if (Number.isNaN(value)) return 'null';
			return value > 0 ? '1.7976931348623157e+308' : '-1.7976931348623157e+308';
		}
		return String(value);
	}
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (let i = 0; i < value.length; i++) {
			parts.push(jsonStringify(value[i], sortKeys));
		}
		return `[${parts.join(',')}]`;
	}
	// Object
	let keys = Object.keys(value);
	if (sortKeys) keys = keys.slice().sort();
	const parts: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		parts.push(
			`${JSON.stringify(keys[i])}:${jsonStringify((value as JsonObject)[keys[i]], sortKeys)}`,
		);
	}
	return `{${parts.join(',')}}`;
}

/**
 * Pretty-print a JsonValue with indentation.
 */
export function jsonPretty(value: JsonValue, indent: string, sortKeys: boolean): string {
	return prettyInner(value, indent, 0, sortKeys);
}

function prettyInner(value: JsonValue, indent: string, depth: number, sortKeys: boolean): string {
	if (value === null) return 'null';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			if (Number.isNaN(value)) return 'null';
			return value > 0 ? '1.7976931348623157e+308' : '-1.7976931348623157e+308';
		}
		return String(value);
	}
	if (typeof value === 'string') return JSON.stringify(value);

	const prefix = repeatString(indent, depth + 1);
	const closing = repeatString(indent, depth);

	if (Array.isArray(value)) {
		if (value.length === 0) return '[]';
		const items: string[] = [];
		for (let i = 0; i < value.length; i++) {
			items.push(`${prefix}${prettyInner(value[i], indent, depth + 1, sortKeys)}`);
		}
		return `[\n${items.join(',\n')}\n${closing}]`;
	}

	// Object
	let keys = Object.keys(value);
	if (sortKeys) keys = keys.slice().sort();
	if (keys.length === 0) return '{}';
	const entries: string[] = [];
	for (let i = 0; i < keys.length; i++) {
		const k = keys[i];
		const v = prettyInner((value as JsonObject)[k], indent, depth + 1, sortKeys);
		entries.push(`${prefix}${JSON.stringify(k)}: ${v}`);
	}
	return `{\n${entries.join(',\n')}\n${closing}}`;
}

function repeatString(s: string, n: number): string {
	let result = '';
	for (let i = 0; i < n; i++) {
		result += s;
	}
	return result;
}

// ---------------------------------------------------------------------------
// JSON stream parser
// ---------------------------------------------------------------------------

/**
 * Parse concatenated JSON values from a string.
 * Handles `{...}{...}` and `{...}\n{...}` and arrays, numbers, etc.
 */
export function parseJsonStream(input: string): JsonValue[] {
	const results: JsonValue[] = [];
	let pos = 0;

	while (pos < input.length) {
		// Skip whitespace
		while (pos < input.length && isWhitespace(input[pos])) {
			pos++;
		}
		if (pos >= input.length) break;

		// Try to parse a JSON value starting at pos
		const start = pos;
		try {
			const value = parseOneJson(input, pos);
			results.push(value.value);
			pos = value.end;
		} catch {
			throw new JqRuntimeError(
				`invalid JSON at position ${start}: ${input.slice(start, start + 20)}...`,
			);
		}
	}

	return results;
}

function isWhitespace(ch: string): boolean {
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function parseOneJson(input: string, start: number): { value: JsonValue; end: number } {
	// Skip whitespace
	let pos = start;
	while (pos < input.length && isWhitespace(input[pos])) pos++;

	if (pos >= input.length) {
		throw new Error('unexpected end of input');
	}

	const ch = input[pos];

	// String
	if (ch === '"') {
		return parseJsonString(input, pos);
	}

	// Number
	if (ch === '-' || (ch >= '0' && ch <= '9')) {
		return parseJsonNumber(input, pos);
	}

	// Boolean/null
	if (input.startsWith('true', pos)) {
		return { value: true, end: pos + 4 };
	}
	if (input.startsWith('false', pos)) {
		return { value: false, end: pos + 5 };
	}
	if (input.startsWith('null', pos)) {
		return { value: null, end: pos + 4 };
	}

	// Array
	if (ch === '[') {
		return parseJsonArray(input, pos);
	}

	// Object
	if (ch === '{') {
		return parseJsonObject(input, pos);
	}

	throw new Error(`unexpected character: ${ch}`);
}

function parseJsonString(input: string, start: number): { value: string; end: number } {
	let pos = start + 1; // skip opening "
	let result = '';

	while (pos < input.length) {
		const ch = input[pos];
		if (ch === '"') {
			return { value: result, end: pos + 1 };
		}
		if (ch === '\\') {
			pos++;
			if (pos >= input.length) throw new Error('unterminated string');
			const esc = input[pos];
			switch (esc) {
				case '"':
					result += '"';
					break;
				case '\\':
					result += '\\';
					break;
				case '/':
					result += '/';
					break;
				case 'b':
					result += '\b';
					break;
				case 'f':
					result += '\f';
					break;
				case 'n':
					result += '\n';
					break;
				case 'r':
					result += '\r';
					break;
				case 't':
					result += '\t';
					break;
				case 'u': {
					const hex = input.slice(pos + 1, pos + 5);
					if (hex.length < 4) throw new Error('invalid unicode escape');
					result += String.fromCharCode(Number.parseInt(hex, 16));
					pos += 4;
					break;
				}
				default:
					result += esc;
			}
			pos++;
			continue;
		}
		result += ch;
		pos++;
	}

	throw new Error('unterminated string');
}

function parseJsonNumber(input: string, start: number): { value: number; end: number } {
	let pos = start;
	if (input[pos] === '-') pos++;

	// Integer part
	if (pos < input.length && input[pos] === '0') {
		pos++;
	} else {
		while (pos < input.length && input[pos] >= '0' && input[pos] <= '9') {
			pos++;
		}
	}

	// Fractional part
	if (pos < input.length && input[pos] === '.') {
		pos++;
		while (pos < input.length && input[pos] >= '0' && input[pos] <= '9') {
			pos++;
		}
	}

	// Exponent
	if (pos < input.length && (input[pos] === 'e' || input[pos] === 'E')) {
		pos++;
		if (pos < input.length && (input[pos] === '+' || input[pos] === '-')) pos++;
		while (pos < input.length && input[pos] >= '0' && input[pos] <= '9') {
			pos++;
		}
	}

	const num = Number(input.slice(start, pos));
	return { value: num, end: pos };
}

function parseJsonArray(input: string, start: number): { value: JsonValue[]; end: number } {
	let pos = start + 1; // skip [
	const result: JsonValue[] = [];

	while (pos < input.length && isWhitespace(input[pos])) pos++;
	if (pos < input.length && input[pos] === ']') {
		return { value: result, end: pos + 1 };
	}

	for (;;) {
		const elem = parseOneJson(input, pos);
		result.push(elem.value);
		pos = elem.end;

		while (pos < input.length && isWhitespace(input[pos])) pos++;
		if (pos < input.length && input[pos] === ']') {
			return { value: result, end: pos + 1 };
		}
		if (pos < input.length && input[pos] === ',') {
			pos++;
			continue;
		}
		throw new Error('expected , or ] in array');
	}
}

function parseJsonObject(input: string, start: number): { value: JsonObject; end: number } {
	let pos = start + 1; // skip {
	const result: JsonObject = {};

	while (pos < input.length && isWhitespace(input[pos])) pos++;
	if (pos < input.length && input[pos] === '}') {
		return { value: result, end: pos + 1 };
	}

	for (;;) {
		while (pos < input.length && isWhitespace(input[pos])) pos++;
		const key = parseJsonString(input, pos);
		pos = key.end;

		while (pos < input.length && isWhitespace(input[pos])) pos++;
		if (pos >= input.length || input[pos] !== ':') throw new Error('expected : in object');
		pos++;

		const val = parseOneJson(input, pos);
		result[key.value] = val.value;
		pos = val.end;

		while (pos < input.length && isWhitespace(input[pos])) pos++;
		if (pos < input.length && input[pos] === '}') {
			return { value: result, end: pos + 1 };
		}
		if (pos < input.length && input[pos] === ',') {
			pos++;
			continue;
		}
		throw new Error('expected , or } in object');
	}
}
