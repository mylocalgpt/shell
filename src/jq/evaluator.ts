/**
 * Generator-based evaluator for the jq filter language.
 *
 * jq is fundamentally a generator language: most operations produce
 * zero, one, or many outputs. The evaluator uses JS generators to
 * model this naturally without intermediate arrays.
 */

import type {
	BindingPattern,
	Foreach,
	FunctionCall,
	FunctionDef,
	If,
	JqNode,
	ObjectEntry,
	Reduce,
	TryCatch,
	UpdateOp,
	VariableBinding,
} from './ast.js';
import { JqHaltError, JqRuntimeError, JqTypeError } from './errors.js';

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

		case 'If':
			yield* evalIf(node, input, env);
			return;

		case 'TryCatch':
			yield* evalTryCatch(node, input, env);
			return;

		case 'Reduce':
			yield* evalReduce(node, input, env);
			return;

		case 'Foreach':
			yield* evalForeach(node, input, env);
			return;

		case 'Label':
			yield* evalLabel(node, input, env);
			return;

		case 'Break':
			throw new JqBreak(node.name);

		case 'FunctionDef':
			yield* evalFunctionDef(node, input, env);
			return;

		case 'FunctionCall':
			yield* evalFunctionCall(node, input, env);
			return;

		case 'VariableBinding':
			yield* evalVariableBinding(node, input, env);
			return;

		case 'Update':
			yield* evalUpdate(node.path, node.value, input, env);
			return;

		case 'UpdateOp':
			yield* evalUpdateOp(node, input, env);
			return;

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
// Control flow handlers (Phase 3)
// ---------------------------------------------------------------------------

function* evalIf(node: If, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	for (const condVal of evaluate(node.condition, input, env)) {
		if (isTruthy(condVal)) {
			const thenBranch = node.then;
			yield* evaluate(thenBranch, input, env);
		} else {
			// Check elif chains
			let handled = false;
			for (let i = 0; i < node.elifs.length; i++) {
				const elif = node.elifs[i];
				let elifMatched = false;
				for (const elifCond of evaluate(elif.condition, input, env)) {
					if (isTruthy(elifCond)) {
						yield* evaluate(elif.body, input, env);
						elifMatched = true;
						break;
					}
				}
				if (elifMatched) {
					handled = true;
					break;
				}
			}
			if (!handled) {
				if (node.else !== null) {
					yield* evaluate(node.else, input, env);
				} else {
					yield input;
				}
			}
		}
	}
}

function* evalTryCatch(node: TryCatch, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	try {
		yield* evaluate(node.expr, input, env);
	} catch (e) {
		if (e instanceof JqBreak) throw e; // don't catch break signals
		if (node.catch !== null) {
			const errMsg = e instanceof Error ? e.message : String(e);
			yield* evaluate(node.catch, errMsg, env);
		}
		// No catch clause: implicit empty (yield nothing)
	}
}

function* evalReduce(node: Reduce, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	// Evaluate INIT to get starting accumulator
	let acc: JsonValue = null;
	for (const v of evaluate(node.init, input, env)) {
		acc = v;
		break; // Take first output of init
	}

	let iterations = 0;
	for (const item of evaluate(node.expr, input, env)) {
		if (iterations++ >= env.limits.maxLoopIterations) {
			throw new JqRuntimeError('reduce iteration limit exceeded');
		}
		const innerEnv = childEnv(env);
		innerEnv.variables.set(node.variable, item);
		// Evaluate update with acc as input
		for (const newAcc of evaluate(node.update, acc, innerEnv)) {
			acc = newAcc;
			break; // Take first output of update
		}
	}

	yield acc;
}

function* evalForeach(node: Foreach, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	// Evaluate INIT to get starting accumulator
	let acc: JsonValue = null;
	for (const v of evaluate(node.init, input, env)) {
		acc = v;
		break;
	}

	let iterations = 0;
	for (const item of evaluate(node.expr, input, env)) {
		if (iterations++ >= env.limits.maxLoopIterations) {
			throw new JqRuntimeError('foreach iteration limit exceeded');
		}
		const innerEnv = childEnv(env);
		innerEnv.variables.set(node.variable, item);
		// Evaluate update
		for (const newAcc of evaluate(node.update, acc, innerEnv)) {
			acc = newAcc;
			break;
		}
		// Yield extract or accumulator
		if (node.extract !== null) {
			yield* evaluate(node.extract, acc, innerEnv);
		} else {
			yield acc;
		}
	}
}

function* evalLabel(
	node: { name: string; body: JqNode },
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	try {
		yield* evaluate(node.body, input, env);
	} catch (e) {
		if (e instanceof JqBreak && e.label === node.name) {
			// Break caught by matching label
			return;
		}
		throw e;
	}
}

function* evalVariableBinding(
	node: VariableBinding,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	for (const val of evaluate(node.expr, input, env)) {
		const innerEnv = childEnv(env);
		bindPattern(innerEnv, node.pattern, val);
		yield* evaluate(node.body, input, innerEnv);
	}
}

function bindPattern(env: JqEnv, pattern: BindingPattern, value: JsonValue): void {
	switch (pattern.kind) {
		case 'variable':
			env.variables.set(pattern.name, value);
			break;
		case 'array':
			if (Array.isArray(value)) {
				for (let i = 0; i < pattern.elements.length; i++) {
					bindPattern(env, pattern.elements[i], i < value.length ? value[i] : null);
				}
			}
			break;
		case 'object':
			if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
				for (let i = 0; i < pattern.entries.length; i++) {
					const entry = pattern.entries[i];
					bindPattern(env, entry.pattern, (value as JsonObject)[entry.key] ?? null);
				}
			}
			break;
	}
}

// ---------------------------------------------------------------------------
// Function handlers (Phase 3)
// ---------------------------------------------------------------------------

function* evalFunctionDef(node: FunctionDef, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	// Register function in environment and evaluate `next`
	const newEnv = childEnv(env);
	const key = `${node.name}/${node.params.length}`;
	newEnv.functions = new Map(env.functions);
	newEnv.functions.set(key, { params: node.params, body: node.body });
	yield* evaluate(node.next, input, newEnv);
}

function* evalFunctionCall(node: FunctionCall, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	const { name, args } = node;

	// Look up user-defined function by name/arity
	const key = `${name}/${args.length}`;
	const funcDef = env.functions.get(key);

	if (funcDef) {
		if (env.depth >= env.limits.maxCallDepth) {
			throw new JqRuntimeError(`maximum call depth exceeded (${env.limits.maxCallDepth})`);
		}
		const callEnv = childEnv(env);
		callEnv.depth = env.depth + 1;
		callEnv.functions = env.functions;

		// Bind parameters as closures: each parameter is a filter (JqNode) that gets
		// evaluated in the caller's context with the caller's input.
		// We implement this by wrapping each arg as a zero-arity function that
		// evaluates the arg expression with the original input and env.
		const closureFunctions = new Map(env.functions);
		for (let i = 0; i < funcDef.params.length; i++) {
			const paramName = funcDef.params[i];
			const argNode = args[i];
			// Register param as a zero-arity function whose body is the arg expression
			// But we need it evaluated in the CALLER's context with CALLER's input.
			// We achieve this by creating a wrapper node that captures the caller's env.
			closureFunctions.set(`${paramName}/0`, {
				params: [],
				body: argNode,
			});
		}
		callEnv.functions = closureFunctions;

		yield* evaluate(funcDef.body, input, callEnv);
		return;
	}

	// Not a user function - this is a builtin call placeholder.
	// Phase 4 will add builtin dispatch here.
	// For now, handle a few essential builtins inline.
	yield* evalBuiltinCall(name, args, input, env);
}

/** Minimal builtin dispatch. Full builtin library added in Phase 4. */
function* evalBuiltinCall(
	name: string,
	args: JqNode[],
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	switch (name) {
		case 'not':
			yield !isTruthy(input);
			return;
		case 'length':
			if (typeof input === 'string') yield input.length;
			else if (Array.isArray(input)) yield input.length;
			else if (input === null) yield 0;
			else if (typeof input === 'object') yield Object.keys(input).length;
			else if (typeof input === 'number') yield Math.abs(input);
			else throw new JqTypeError(`${typeOf(input)} has no length`);
			return;
		case 'keys':
		case 'keys_unsorted': {
			if (Array.isArray(input)) {
				const result: JsonValue[] = [];
				for (let i = 0; i < input.length; i++) result.push(i);
				yield result;
			} else if (input !== null && typeof input === 'object') {
				const k = Object.keys(input);
				if (name === 'keys') k.sort();
				yield k;
			} else {
				throw new JqTypeError(`${typeOf(input)} has no keys`);
			}
			return;
		}
		case 'values': {
			if (Array.isArray(input)) {
				yield input;
			} else if (input !== null && typeof input === 'object') {
				yield Object.values(input);
			} else {
				throw new JqTypeError(`${typeOf(input)} has no values`);
			}
			return;
		}
		case 'type':
			yield typeOf(input);
			return;
		case 'empty':
			return; // Zero outputs
		case 'error': {
			const msg = args.length > 0 ? collectFirst(args[0], input, env) : input;
			const errMsg = typeof msg === 'string' ? msg : jsonStringify(msg);
			throw new JqRuntimeError(errMsg);
		}
		case 'null':
			yield null;
			return;
		case 'true':
			yield true;
			return;
		case 'false':
			yield false;
			return;
		case 'add': {
			if (!Array.isArray(input)) throw new JqTypeError('add requires array input');
			if (input.length === 0) {
				yield null;
				return;
			}
			let acc: JsonValue = input[0];
			for (let i = 1; i < input.length; i++) {
				acc = applyArithmetic('+', acc, input[i]);
			}
			yield acc;
			return;
		}
		case 'any': {
			if (args.length === 0) {
				// any on array
				if (!Array.isArray(input)) throw new JqTypeError('any requires array input');
				let found = false;
				for (let i = 0; i < input.length; i++) {
					if (isTruthy(input[i])) {
						found = true;
						break;
					}
				}
				yield found;
			} else {
				// any(f)
				if (!Array.isArray(input)) throw new JqTypeError('any requires array input');
				let found = false;
				for (let i = 0; i < input.length; i++) {
					for (const v of evaluate(args[0], input[i], env)) {
						if (isTruthy(v)) {
							found = true;
							break;
						}
					}
					if (found) break;
				}
				yield found;
			}
			return;
		}
		case 'all': {
			if (args.length === 0) {
				if (!Array.isArray(input)) throw new JqTypeError('all requires array input');
				let result = true;
				for (let i = 0; i < input.length; i++) {
					if (!isTruthy(input[i])) {
						result = false;
						break;
					}
				}
				yield result;
			} else {
				if (!Array.isArray(input)) throw new JqTypeError('all requires array input');
				let result = true;
				for (let i = 0; i < input.length; i++) {
					for (const v of evaluate(args[0], input[i], env)) {
						if (!isTruthy(v)) {
							result = false;
							break;
						}
					}
					if (!result) break;
				}
				yield result;
			}
			return;
		}
		case 'map': {
			if (args.length < 1) throw new JqRuntimeError('map requires 1 argument');
			if (!Array.isArray(input)) throw new JqTypeError('map requires array input');
			const result: JsonValue[] = [];
			for (let i = 0; i < input.length; i++) {
				for (const v of evaluate(args[0], input[i], env)) {
					result.push(v);
				}
			}
			yield result;
			return;
		}
		case 'map_values': {
			if (args.length < 1) throw new JqRuntimeError('map_values requires 1 argument');
			if (Array.isArray(input)) {
				const result: JsonValue[] = [];
				for (let i = 0; i < input.length; i++) {
					for (const v of evaluate(args[0], input[i], env)) {
						result.push(v);
					}
				}
				yield result;
			} else if (input !== null && typeof input === 'object') {
				const result: JsonObject = {};
				const ks = Object.keys(input);
				for (let i = 0; i < ks.length; i++) {
					for (const v of evaluate(args[0], (input as JsonObject)[ks[i]], env)) {
						result[ks[i]] = v;
					}
				}
				yield result;
			} else {
				throw new JqTypeError(`${typeOf(input)} cannot be iterated`);
			}
			return;
		}
		case 'select': {
			if (args.length < 1) throw new JqRuntimeError('select requires 1 argument');
			for (const v of evaluate(args[0], input, env)) {
				if (isTruthy(v)) {
					yield input;
				}
			}
			return;
		}
		case 'has': {
			if (args.length < 1) throw new JqRuntimeError('has requires 1 argument');
			const key = collectFirst(args[0], input, env);
			if (Array.isArray(input) && typeof key === 'number') {
				yield key >= 0 && key < input.length;
			} else if (
				input !== null &&
				typeof input === 'object' &&
				!Array.isArray(input) &&
				typeof key === 'string'
			) {
				yield key in input;
			} else {
				throw new JqTypeError(`cannot check has on ${typeOf(input)}`);
			}
			return;
		}
		case 'in': {
			if (args.length < 1) throw new JqRuntimeError('in requires 1 argument');
			const obj = collectFirst(args[0], input, env);
			if (
				typeof input === 'string' &&
				obj !== null &&
				typeof obj === 'object' &&
				!Array.isArray(obj)
			) {
				yield input in obj;
			} else if (typeof input === 'number' && Array.isArray(obj)) {
				yield input >= 0 && input < obj.length;
			} else {
				throw new JqTypeError('in requires object/array argument');
			}
			return;
		}
		case 'contains': {
			if (args.length < 1) throw new JqRuntimeError('contains requires 1 argument');
			const other = collectFirst(args[0], input, env);
			yield jqContains(input, other);
			return;
		}
		case 'to_entries': {
			if (input === null || typeof input !== 'object' || Array.isArray(input)) {
				throw new JqTypeError(`${typeOf(input)} cannot be converted to entries`);
			}
			const entries: JsonValue[] = [];
			const ks = Object.keys(input);
			for (let i = 0; i < ks.length; i++) {
				entries.push({ key: ks[i], value: (input as JsonObject)[ks[i]] });
			}
			yield entries;
			return;
		}
		case 'from_entries': {
			if (!Array.isArray(input)) throw new JqTypeError('from_entries requires array input');
			const obj: JsonObject = {};
			for (let i = 0; i < input.length; i++) {
				const entry = input[i];
				if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
					const e = entry as JsonObject;
					const k = e.key ?? e.name ?? '';
					const v = e.value ?? null;
					obj[typeof k === 'string' ? k : String(k)] = v;
				}
			}
			yield obj;
			return;
		}
		case 'with_entries': {
			if (args.length < 1) throw new JqRuntimeError('with_entries requires 1 argument');
			if (input === null || typeof input !== 'object' || Array.isArray(input)) {
				throw new JqTypeError(`${typeOf(input)} cannot be used with with_entries`);
			}
			const entries: JsonValue[] = [];
			const ks = Object.keys(input);
			for (let i = 0; i < ks.length; i++) {
				entries.push({ key: ks[i], value: (input as JsonObject)[ks[i]] });
			}
			const mapped: JsonValue[] = [];
			for (let i = 0; i < entries.length; i++) {
				for (const v of evaluate(args[0], entries[i], env)) {
					mapped.push(v);
				}
			}
			const result: JsonObject = {};
			for (let i = 0; i < mapped.length; i++) {
				const entry = mapped[i];
				if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
					const e = entry as JsonObject;
					const k = e.key ?? e.name ?? '';
					const v = e.value ?? null;
					result[typeof k === 'string' ? k : String(k)] = v;
				}
			}
			yield result;
			return;
		}
		case 'tostring':
			yield typeof input === 'string' ? input : jsonStringify(input);
			return;
		case 'tonumber': {
			if (typeof input === 'number') {
				yield input;
			} else if (typeof input === 'string') {
				const n = Number(input);
				if (Number.isNaN(n)) throw new JqRuntimeError(`cannot convert "${input}" to number`);
				yield n;
			} else {
				throw new JqTypeError(`${typeOf(input)} cannot be converted to number`);
			}
			return;
		}
		case 'tojson':
			yield jsonStringify(input);
			return;
		case 'fromjson': {
			if (typeof input !== 'string') throw new JqTypeError('fromjson requires string input');
			try {
				yield JSON.parse(input) as JsonValue;
			} catch {
				throw new JqRuntimeError('invalid JSON');
			}
			return;
		}
		case 'reverse': {
			if (typeof input === 'string') {
				let result = '';
				for (let i = input.length - 1; i >= 0; i--) result += input[i];
				yield result;
			} else if (Array.isArray(input)) {
				const result: JsonValue[] = [];
				for (let i = input.length - 1; i >= 0; i--) result.push(input[i]);
				yield result;
			} else {
				throw new JqTypeError(`${typeOf(input)} cannot be reversed`);
			}
			return;
		}
		case 'sort':
		case 'sort_by': {
			if (!Array.isArray(input)) throw new JqTypeError('sort requires array input');
			const arr = input.slice();
			if (name === 'sort_by' && args.length > 0) {
				// Compute sort keys
				const keys: JsonValue[] = [];
				for (let i = 0; i < arr.length; i++) {
					keys.push(collectFirst(args[0], arr[i], env));
				}
				// Sort by keys using jq ordering
				const indices: number[] = [];
				for (let i = 0; i < arr.length; i++) indices.push(i);
				indices.sort((a, b) => jqCompare(keys[a], keys[b]));
				const sorted: JsonValue[] = [];
				for (let i = 0; i < indices.length; i++) sorted.push(arr[indices[i]]);
				yield sorted;
			} else {
				arr.sort(jqCompare);
				yield arr;
			}
			return;
		}
		case 'group_by': {
			if (!Array.isArray(input) || args.length < 1)
				throw new JqTypeError('group_by requires array input and 1 argument');
			const keys: JsonValue[] = [];
			for (let i = 0; i < input.length; i++) {
				keys.push(collectFirst(args[0], input[i], env));
			}
			const indices: number[] = [];
			for (let i = 0; i < input.length; i++) indices.push(i);
			indices.sort((a, b) => jqCompare(keys[a], keys[b]));
			const groups: JsonValue[][] = [];
			let currentGroup: JsonValue[] = [];
			let currentKey: JsonValue = undefined as unknown as JsonValue;
			for (let i = 0; i < indices.length; i++) {
				const idx = indices[i];
				if (currentGroup.length === 0 || jqCompare(keys[idx], currentKey) !== 0) {
					if (currentGroup.length > 0) groups.push(currentGroup);
					currentGroup = [];
					currentKey = keys[idx];
				}
				currentGroup.push(input[idx]);
			}
			if (currentGroup.length > 0) groups.push(currentGroup);
			yield groups;
			return;
		}
		case 'unique':
		case 'unique_by': {
			if (!Array.isArray(input)) throw new JqTypeError('unique requires array input');
			if (name === 'unique_by' && args.length > 0) {
				const keys: JsonValue[] = [];
				for (let i = 0; i < input.length; i++) {
					keys.push(collectFirst(args[0], input[i], env));
				}
				const seen: JsonValue[] = [];
				const result: JsonValue[] = [];
				for (let i = 0; i < input.length; i++) {
					let found = false;
					for (let j = 0; j < seen.length; j++) {
						if (deepEqual(keys[i], seen[j])) {
							found = true;
							break;
						}
					}
					if (!found) {
						seen.push(keys[i]);
						result.push(input[i]);
					}
				}
				yield result;
			} else {
				const sorted = input.slice().sort(jqCompare);
				const result: JsonValue[] = [];
				for (let i = 0; i < sorted.length; i++) {
					if (i === 0 || !deepEqual(sorted[i], sorted[i - 1])) {
						result.push(sorted[i]);
					}
				}
				yield result;
			}
			return;
		}
		case 'flatten': {
			if (!Array.isArray(input)) throw new JqTypeError('flatten requires array input');
			const depth =
				args.length > 0 ? (collectFirst(args[0], input, env) as number) : Number.POSITIVE_INFINITY;
			yield flattenArray(input, typeof depth === 'number' ? depth : Number.POSITIVE_INFINITY);
			return;
		}
		case 'range': {
			if (args.length === 1) {
				const n = collectFirst(args[0], input, env) as number;
				for (let i = 0; i < n; i++) yield i;
			} else if (args.length >= 2) {
				const from = collectFirst(args[0], input, env) as number;
				const to = collectFirst(args[1], input, env) as number;
				const step = args.length >= 3 ? (collectFirst(args[2], input, env) as number) : 1;
				if (step > 0) {
					for (let i = from; i < to; i += step) yield i;
				} else if (step < 0) {
					for (let i = from; i > to; i += step) yield i;
				}
			}
			return;
		}
		case 'floor':
			if (typeof input !== 'number') throw new JqTypeError('floor requires number input');
			yield Math.floor(input);
			return;
		case 'ceil':
			if (typeof input !== 'number') throw new JqTypeError('ceil requires number input');
			yield Math.ceil(input);
			return;
		case 'round':
			if (typeof input !== 'number') throw new JqTypeError('round requires number input');
			yield Math.round(input);
			return;
		case 'fabs':
		case 'abs':
			if (typeof input !== 'number') throw new JqTypeError('abs requires number input');
			yield Math.abs(input);
			return;
		case 'sqrt':
			if (typeof input !== 'number') throw new JqTypeError('sqrt requires number input');
			yield Math.sqrt(input);
			return;
		case 'pow': {
			if (args.length < 2) throw new JqRuntimeError('pow requires 2 arguments');
			const base = collectFirst(args[0], input, env) as number;
			const exp = collectFirst(args[1], input, env) as number;
			yield base ** exp;
			return;
		}
		case 'log':
			if (typeof input !== 'number') throw new JqTypeError('log requires number input');
			yield Math.log(input);
			return;
		case 'log2':
			if (typeof input !== 'number') throw new JqTypeError('log2 requires number input');
			yield Math.log2(input);
			return;
		case 'log10':
			if (typeof input !== 'number') throw new JqTypeError('log10 requires number input');
			yield Math.log10(input);
			return;
		case 'exp':
			if (typeof input !== 'number') throw new JqTypeError('exp requires number input');
			yield Math.exp(input);
			return;
		case 'exp2':
			if (typeof input !== 'number') throw new JqTypeError('exp2 requires number input');
			yield 2 ** input;
			return;
		case 'nan':
			yield Number.NaN;
			return;
		case 'infinite':
			yield Number.POSITIVE_INFINITY;
			return;
		case 'isinfinite':
			yield typeof input === 'number' && !Number.isFinite(input) && !Number.isNaN(input);
			return;
		case 'isnan':
			yield typeof input === 'number' && Number.isNaN(input);
			return;
		case 'isnormal':
			yield typeof input === 'number' && Number.isFinite(input) && input !== 0;
			return;
		case 'isfinite':
			yield typeof input === 'number' && Number.isFinite(input);
			return;
		case 'min':
		case 'min_by': {
			if (!Array.isArray(input) || input.length === 0)
				throw new JqTypeError('min requires non-empty array');
			if (name === 'min_by' && args.length > 0) {
				let minVal = input[0];
				let minKey = collectFirst(args[0], input[0], env);
				for (let i = 1; i < input.length; i++) {
					const k = collectFirst(args[0], input[i], env);
					if (jqCompare(k, minKey) < 0) {
						minVal = input[i];
						minKey = k;
					}
				}
				yield minVal;
			} else {
				let minVal = input[0];
				for (let i = 1; i < input.length; i++) {
					if (jqCompare(input[i], minVal) < 0) minVal = input[i];
				}
				yield minVal;
			}
			return;
		}
		case 'max':
		case 'max_by': {
			if (!Array.isArray(input) || input.length === 0)
				throw new JqTypeError('max requires non-empty array');
			if (name === 'max_by' && args.length > 0) {
				let maxVal = input[0];
				let maxKey = collectFirst(args[0], input[0], env);
				for (let i = 1; i < input.length; i++) {
					const k = collectFirst(args[0], input[i], env);
					if (jqCompare(k, maxKey) > 0) {
						maxVal = input[i];
						maxKey = k;
					}
				}
				yield maxVal;
			} else {
				let maxVal = input[0];
				for (let i = 1; i < input.length; i++) {
					if (jqCompare(input[i], maxVal) > 0) maxVal = input[i];
				}
				yield maxVal;
			}
			return;
		}
		case 'indices':
		case 'index':
		case 'rindex': {
			if (args.length < 1) throw new JqRuntimeError(`${name} requires 1 argument`);
			const target = collectFirst(args[0], input, env);
			if (typeof input === 'string' && typeof target === 'string') {
				if (name === 'rindex') {
					const idx = input.lastIndexOf(target);
					yield idx >= 0 ? idx : null;
				} else if (name === 'index') {
					const idx = input.indexOf(target);
					yield idx >= 0 ? idx : null;
				} else {
					const result: JsonValue[] = [];
					let pos = 0;
					while (pos <= input.length - target.length) {
						const idx = input.indexOf(target, pos);
						if (idx < 0) break;
						result.push(idx);
						pos = idx + 1;
					}
					yield result;
				}
			} else if (Array.isArray(input)) {
				if (name === 'rindex') {
					let found: JsonValue = null;
					for (let i = input.length - 1; i >= 0; i--) {
						if (deepEqual(input[i], target)) {
							found = i;
							break;
						}
					}
					yield found;
				} else if (name === 'index') {
					let found: JsonValue = null;
					for (let i = 0; i < input.length; i++) {
						if (deepEqual(input[i], target)) {
							found = i;
							break;
						}
					}
					yield found;
				} else {
					const result: JsonValue[] = [];
					for (let i = 0; i < input.length; i++) {
						if (deepEqual(input[i], target)) result.push(i);
					}
					yield result;
				}
			} else {
				throw new JqTypeError(`${name} requires string or array input`);
			}
			return;
		}
		case 'first': {
			if (args.length > 0) {
				for (const v of evaluate(args[0], input, env)) {
					yield v;
					return;
				}
			} else {
				if (Array.isArray(input) && input.length > 0) {
					yield input[0];
				}
			}
			return;
		}
		case 'last': {
			if (args.length > 0) {
				let lastVal: JsonValue = null;
				let hasOutput = false;
				for (const v of evaluate(args[0], input, env)) {
					lastVal = v;
					hasOutput = true;
				}
				if (hasOutput) yield lastVal;
			} else {
				if (Array.isArray(input) && input.length > 0) {
					yield input[input.length - 1];
				}
			}
			return;
		}
		case 'nth': {
			if (args.length < 1) throw new JqRuntimeError('nth requires at least 1 argument');
			const n = collectFirst(args[0], input, env);
			if (typeof n !== 'number') throw new JqTypeError('nth index must be a number');
			if (args.length >= 2) {
				let count = 0;
				for (const v of evaluate(args[1], input, env)) {
					if (count === n) {
						yield v;
						return;
					}
					count++;
				}
			} else {
				if (Array.isArray(input) && n >= 0 && n < input.length) {
					yield input[Math.floor(n)];
				}
			}
			return;
		}
		case 'limit': {
			if (args.length < 2) throw new JqRuntimeError('limit requires 2 arguments');
			const n = collectFirst(args[0], input, env);
			if (typeof n !== 'number') throw new JqTypeError('limit count must be a number');
			let count = 0;
			for (const v of evaluate(args[1], input, env)) {
				if (count >= n) return;
				yield v;
				count++;
			}
			return;
		}
		case 'isempty': {
			if (args.length < 1) throw new JqRuntimeError('isempty requires 1 argument');
			let hasOutput = false;
			for (const _v of evaluate(args[0], input, env)) {
				hasOutput = true;
				break;
			}
			yield !hasOutput;
			return;
		}
		case 'recurse': {
			const filter = args.length > 0 ? args[0] : null;
			const stack: JsonValue[] = [input];
			let iterations = 0;
			while (stack.length > 0) {
				if (iterations++ >= env.limits.maxLoopIterations) {
					throw new JqRuntimeError('recurse iteration limit exceeded');
				}
				const v = stack.pop() as JsonValue;
				yield v;
				if (filter !== null) {
					try {
						const results: JsonValue[] = [];
						for (const next of evaluate(filter, v, env)) {
							results.push(next);
						}
						for (let i = results.length - 1; i >= 0; i--) {
							stack.push(results[i]);
						}
					} catch {
						// Stop recursion on error
					}
				} else {
					// Default: recurse into arrays and objects
					if (Array.isArray(v)) {
						for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
					} else if (v !== null && typeof v === 'object') {
						const ks = Object.keys(v);
						for (let i = ks.length - 1; i >= 0; i--) stack.push((v as JsonObject)[ks[i]]);
					}
				}
			}
			return;
		}
		case 'walk': {
			if (args.length < 1) throw new JqRuntimeError('walk requires 1 argument');
			yield walkValue(input, args[0], env);
			return;
		}
		case 'ascii_downcase':
			if (typeof input !== 'string') throw new JqTypeError('ascii_downcase requires string');
			yield input.toLowerCase();
			return;
		case 'ascii_upcase':
			if (typeof input !== 'string') throw new JqTypeError('ascii_upcase requires string');
			yield input.toUpperCase();
			return;
		case 'ltrimstr': {
			if (typeof input !== 'string') throw new JqTypeError('ltrimstr requires string');
			const prefix = collectFirst(args[0], input, env);
			if (typeof prefix === 'string' && input.startsWith(prefix)) {
				yield input.slice(prefix.length);
			} else {
				yield input;
			}
			return;
		}
		case 'rtrimstr': {
			if (typeof input !== 'string') throw new JqTypeError('rtrimstr requires string');
			const suffix = collectFirst(args[0], input, env);
			if (typeof suffix === 'string' && input.endsWith(suffix)) {
				yield input.slice(0, input.length - suffix.length);
			} else {
				yield input;
			}
			return;
		}
		case 'startswith': {
			if (typeof input !== 'string') throw new JqTypeError('startswith requires string');
			const prefix = collectFirst(args[0], input, env);
			yield typeof prefix === 'string' && input.startsWith(prefix);
			return;
		}
		case 'endswith': {
			if (typeof input !== 'string') throw new JqTypeError('endswith requires string');
			const suffix = collectFirst(args[0], input, env);
			yield typeof suffix === 'string' && input.endsWith(suffix);
			return;
		}
		case 'split': {
			if (typeof input !== 'string') throw new JqTypeError('split requires string');
			if (args.length < 1) throw new JqRuntimeError('split requires 1 argument');
			const sep = collectFirst(args[0], input, env);
			if (typeof sep !== 'string') throw new JqTypeError('split separator must be string');
			yield input.split(sep);
			return;
		}
		case 'join': {
			if (!Array.isArray(input)) throw new JqTypeError('join requires array');
			if (args.length < 1) throw new JqRuntimeError('join requires 1 argument');
			const sep = collectFirst(args[0], input, env);
			if (typeof sep !== 'string') throw new JqTypeError('join separator must be string');
			const parts: string[] = [];
			for (let i = 0; i < input.length; i++) {
				const v = input[i];
				parts.push(typeof v === 'string' ? v : jsonStringify(v));
			}
			yield parts.join(sep);
			return;
		}
		case 'trim':
			if (typeof input !== 'string') throw new JqTypeError('trim requires string');
			yield input.trim();
			return;
		case 'ltrim':
			if (typeof input !== 'string') throw new JqTypeError('ltrim requires string');
			yield input.replace(/^\s+/, '');
			return;
		case 'rtrim':
			if (typeof input !== 'string') throw new JqTypeError('rtrim requires string');
			yield input.replace(/\s+$/, '');
			return;
		case 'explode': {
			if (typeof input !== 'string') throw new JqTypeError('explode requires string');
			const codes: JsonValue[] = [];
			for (let i = 0; i < input.length; i++) {
				codes.push(input.charCodeAt(i));
			}
			yield codes;
			return;
		}
		case 'implode': {
			if (!Array.isArray(input)) throw new JqTypeError('implode requires array');
			let result = '';
			for (let i = 0; i < input.length; i++) {
				const code = input[i];
				if (typeof code !== 'number') throw new JqTypeError('implode requires array of numbers');
				result += String.fromCharCode(code);
			}
			yield result;
			return;
		}
		case 'numbers':
			if (typeof input === 'number') yield input;
			return;
		case 'strings':
			if (typeof input === 'string') yield input;
			return;
		case 'booleans':
			if (typeof input === 'boolean') yield input;
			return;
		case 'nulls':
			if (input === null) yield input;
			return;
		case 'arrays':
			if (Array.isArray(input)) yield input;
			return;
		case 'objects':
			if (input !== null && typeof input === 'object' && !Array.isArray(input)) yield input;
			return;
		case 'iterables':
			if (
				Array.isArray(input) ||
				(input !== null && typeof input === 'object' && !Array.isArray(input))
			)
				yield input;
			return;
		case 'scalars':
			if (
				input === null ||
				typeof input === 'boolean' ||
				typeof input === 'number' ||
				typeof input === 'string'
			)
				yield input;
			return;
		case 'paths': {
			yield* emitPaths(input, args.length > 0 ? args[0] : null, env);
			return;
		}
		case 'leaf_paths': {
			yield* emitLeafPaths(input, []);
			return;
		}
		case 'path': {
			if (args.length < 1) throw new JqRuntimeError('path requires 1 argument');
			for (const p of evaluatePath(args[0], input, env)) {
				yield p[0];
			}
			return;
		}
		case 'getpath': {
			if (args.length < 1) throw new JqRuntimeError('getpath requires 1 argument');
			const path = collectFirst(args[0], input, env);
			if (!Array.isArray(path)) throw new JqTypeError('getpath requires array path');
			yield getPath(input, path);
			return;
		}
		case 'setpath': {
			if (args.length < 2) throw new JqRuntimeError('setpath requires 2 arguments');
			const path = collectFirst(args[0], input, env);
			const value = collectFirst(args[1], input, env);
			if (!Array.isArray(path)) throw new JqTypeError('setpath requires array path');
			yield setPath(input, path, value);
			return;
		}
		case 'delpaths': {
			if (args.length < 1) throw new JqRuntimeError('delpaths requires 1 argument');
			const paths = collectFirst(args[0], input, env);
			if (!Array.isArray(paths)) throw new JqTypeError('delpaths requires array of paths');
			let result = input;
			// Sort paths in reverse to delete from deepest first
			const sortedPaths = (paths as JsonValue[][]).slice().sort((a, b) => {
				const len = Math.min(a.length, b.length);
				for (let i = 0; i < len; i++) {
					const cmp = jqCompare(a[i], b[i]);
					if (cmp !== 0) return -cmp;
				}
				return b.length - a.length;
			});
			for (let i = 0; i < sortedPaths.length; i++) {
				result = deletePath(result, sortedPaths[i]);
			}
			yield result;
			return;
		}
		case 'del': {
			if (args.length < 1) throw new JqRuntimeError('del requires 1 argument');
			const paths: JsonValue[][] = [];
			for (const p of evaluatePath(args[0], input, env)) {
				paths.push(p[0] as JsonValue[]);
			}
			// Sort in reverse for safe deletion
			paths.sort((a, b) => {
				const len = Math.min(a.length, b.length);
				for (let i = 0; i < len; i++) {
					const cmp = jqCompare(a[i], b[i]);
					if (cmp !== 0) return -cmp;
				}
				return b.length - a.length;
			});
			let result = input;
			for (let i = 0; i < paths.length; i++) {
				result = deletePath(result, paths[i]);
			}
			yield result;
			return;
		}
		case 'transpose': {
			if (!Array.isArray(input)) throw new JqTypeError('transpose requires array');
			if (input.length === 0) {
				yield [];
				return;
			}
			let maxLen = 0;
			for (let i = 0; i < input.length; i++) {
				if (Array.isArray(input[i]) && (input[i] as JsonValue[]).length > maxLen) {
					maxLen = (input[i] as JsonValue[]).length;
				}
			}
			const result: JsonValue[][] = [];
			for (let j = 0; j < maxLen; j++) {
				const row: JsonValue[] = [];
				for (let i = 0; i < input.length; i++) {
					if (Array.isArray(input[i]) && j < (input[i] as JsonValue[]).length) {
						row.push((input[i] as JsonValue[])[j]);
					} else {
						row.push(null);
					}
				}
				result.push(row);
			}
			yield result;
			return;
		}
		case 'input':
		case 'inputs': {
			if (env.inputSource) {
				const gen = env.inputSource();
				if (name === 'input') {
					const next = gen.next();
					if (!next.done) yield next.value;
				} else {
					for (const v of gen) yield v;
				}
			}
			return;
		}
		case 'debug': {
			if (env.stderrSink) {
				const msg = args.length > 0 ? collectFirst(args[0], input, env) : input;
				env.stderrSink(`["DEBUG:",${jsonStringify(msg)}]\n`);
			}
			yield input;
			return;
		}
		case 'stderr': {
			if (env.stderrSink) {
				env.stderrSink(`${jsonStringify(input)}\n`);
			}
			yield input;
			return;
		}
		case 'halt':
			throw new JqHaltError('', 0);
		case 'halt_error': {
			const code = args.length > 0 ? (collectFirst(args[0], input, env) as number) : 5;
			throw new JqHaltError(
				typeof input === 'string' ? input : jsonStringify(input),
				typeof code === 'number' ? code : 5,
			);
		}
		case 'while': {
			if (args.length < 2) throw new JqRuntimeError('while requires 2 arguments');
			let current = input;
			let iterations = 0;
			for (;;) {
				if (iterations++ >= env.limits.maxLoopIterations) {
					throw new JqRuntimeError('while iteration limit exceeded');
				}
				let cond = false;
				for (const v of evaluate(args[0], current, env)) {
					cond = isTruthy(v);
					break;
				}
				if (!cond) return;
				yield current;
				for (const v of evaluate(args[1], current, env)) {
					current = v;
					break;
				}
			}
		}
		case 'until': {
			if (args.length < 2) throw new JqRuntimeError('until requires 2 arguments');
			let current = input;
			let iterations = 0;
			for (;;) {
				if (iterations++ >= env.limits.maxLoopIterations) {
					throw new JqRuntimeError('until iteration limit exceeded');
				}
				let cond = false;
				for (const v of evaluate(args[0], current, env)) {
					cond = isTruthy(v);
					break;
				}
				if (cond) {
					yield current;
					return;
				}
				for (const v of evaluate(args[1], current, env)) {
					current = v;
					break;
				}
			}
		}
		case 'repeat': {
			if (args.length < 1) throw new JqRuntimeError('repeat requires 1 argument');
			let current = input;
			let iterations = 0;
			for (;;) {
				if (iterations++ >= env.limits.maxLoopIterations) {
					throw new JqRuntimeError('repeat iteration limit exceeded');
				}
				yield current;
				for (const v of evaluate(args[0], current, env)) {
					current = v;
					break;
				}
			}
		}
		case 'env':
		case '$ENV': {
			const obj: JsonObject = {};
			if (env.envVars) {
				for (const [k, v] of env.envVars) {
					obj[k] = v;
				}
			}
			yield obj;
			return;
		}
		case 'now':
			yield env.nowFn ? env.nowFn() : Date.now() / 1000;
			return;
		case 'builtins': {
			// Return list of known builtins as name/arity strings
			yield [];
			return;
		}
		case 'utf8bytelength': {
			if (typeof input !== 'string') throw new JqTypeError('utf8bytelength requires string');
			let bytes = 0;
			for (let i = 0; i < input.length; i++) {
				const code = input.charCodeAt(i);
				if (code <= 0x7f) bytes += 1;
				else if (code <= 0x7ff) bytes += 2;
				else if (code <= 0xffff) bytes += 3;
				else bytes += 4;
			}
			yield bytes;
			return;
		}
		case 'inside': {
			if (args.length < 1) throw new JqRuntimeError('inside requires 1 argument');
			const container = collectFirst(args[0], input, env);
			yield jqContains(container, input);
			return;
		}
		case 'combinations': {
			if (!Array.isArray(input)) throw new JqTypeError('combinations requires array');
			if (args.length > 0) {
				// combinations(n) - n copies of input
				const n = collectFirst(args[0], input, env) as number;
				const arrs: JsonValue[][] = [];
				for (let i = 0; i < n; i++) arrs.push(input);
				yield* cartesian(arrs, 0, []);
			} else {
				// combinations - cartesian product of sub-arrays
				const arrs: JsonValue[][] = [];
				for (let i = 0; i < input.length; i++) {
					if (!Array.isArray(input[i]))
						throw new JqTypeError('combinations requires array of arrays');
					arrs.push(input[i] as JsonValue[]);
				}
				yield* cartesian(arrs, 0, []);
			}
			return;
		}
		case 'pick': {
			if (args.length < 1) throw new JqRuntimeError('pick requires 1 argument');
			const paths: JsonValue[][] = [];
			for (const p of evaluatePath(args[0], input, env)) {
				paths.push(p[0] as JsonValue[]);
			}
			let result: JsonValue = {};
			for (let i = 0; i < paths.length; i++) {
				const val = getPath(input, paths[i]);
				result = setPath(result, paths[i], val);
			}
			yield result;
			return;
		}
		default:
			throw new JqRuntimeError(`unknown function: ${name}/${args.length}`);
	}
}

/** Collect the first output of an expression, or return null if no outputs. */
function collectFirst(node: JqNode, input: JsonValue, env: JqEnv): JsonValue {
	for (const v of evaluate(node, input, env)) {
		return v;
	}
	return null;
}

function jqContains(a: JsonValue, b: JsonValue): boolean {
	if (a === b) return true;
	if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
	if (Array.isArray(a) && Array.isArray(b)) {
		for (let j = 0; j < b.length; j++) {
			let found = false;
			for (let i = 0; i < a.length; i++) {
				if (jqContains(a[i], b[j])) {
					found = true;
					break;
				}
			}
			if (!found) return false;
		}
		return true;
	}
	if (
		a !== null &&
		typeof a === 'object' &&
		!Array.isArray(a) &&
		b !== null &&
		typeof b === 'object' &&
		!Array.isArray(b)
	) {
		const bKeys = Object.keys(b);
		for (let i = 0; i < bKeys.length; i++) {
			if (!(bKeys[i] in a)) return false;
			if (!jqContains((a as JsonObject)[bKeys[i]], (b as JsonObject)[bKeys[i]])) return false;
		}
		return true;
	}
	return deepEqual(a, b);
}

function flattenArray(arr: JsonValue[], depth: number): JsonValue[] {
	const result: JsonValue[] = [];
	for (let i = 0; i < arr.length; i++) {
		if (Array.isArray(arr[i]) && depth > 0) {
			const flat = flattenArray(arr[i] as JsonValue[], depth - 1);
			for (let j = 0; j < flat.length; j++) result.push(flat[j]);
		} else {
			result.push(arr[i]);
		}
	}
	return result;
}

function* cartesian(arrs: JsonValue[][], idx: number, acc: JsonValue[]): Generator<JsonValue> {
	if (idx >= arrs.length) {
		yield acc.slice();
		return;
	}
	for (let i = 0; i < arrs[idx].length; i++) {
		acc.push(arrs[idx][i]);
		yield* cartesian(arrs, idx + 1, acc);
		acc.pop();
	}
}

function walkValue(input: JsonValue, filter: JqNode, env: JqEnv): JsonValue {
	if (Array.isArray(input)) {
		const arr: JsonValue[] = [];
		for (let i = 0; i < input.length; i++) {
			arr.push(walkValue(input[i], filter, env));
		}
		return collectFirst(filter, arr, env);
	}
	if (input !== null && typeof input === 'object') {
		const obj: JsonObject = {};
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			obj[keys[i]] = walkValue((input as JsonObject)[keys[i]], filter, env);
		}
		return collectFirst(filter, obj, env);
	}
	return collectFirst(filter, input, env);
}

// ---------------------------------------------------------------------------
// Update operators (Phase 3)
// ---------------------------------------------------------------------------

function* evalUpdate(
	pathNode: JqNode,
	valueNode: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<JsonValue> {
	// Get all paths, then apply updates
	const paths: [JsonValue[], JsonValue][] = [];
	for (const p of evaluatePath(pathNode, input, env)) {
		paths.push(p);
	}

	let result = input;
	for (let i = 0; i < paths.length; i++) {
		const path = paths[i][0];
		const oldVal = getPath(result, path);
		const newVal = collectFirst(valueNode, oldVal, env);
		result = setPath(result, path, newVal);
	}
	yield result;
}

function* evalUpdateOp(node: UpdateOp, input: JsonValue, env: JqEnv): Generator<JsonValue> {
	const { op, path: pathNode, value: valueNode } = node;

	const paths: [JsonValue[], JsonValue][] = [];
	for (const p of evaluatePath(pathNode, input, env)) {
		paths.push(p);
	}

	let result = input;
	for (let i = 0; i < paths.length; i++) {
		const path = paths[i][0];
		const oldVal = getPath(result, path);

		let newVal: JsonValue;
		if (op === '//=') {
			if (isTruthy(oldVal)) {
				newVal = oldVal;
			} else {
				newVal = collectFirst(valueNode, input, env);
			}
		} else {
			// For +=, -=, etc., the RHS is evaluated with the original input
			const rhsVal = collectFirst(valueNode, input, env);
			const arithOp = op.slice(0, -1) as '+' | '-' | '*' | '/' | '%';
			newVal = applyArithmetic(arithOp, oldVal, rhsVal);
		}
		result = setPath(result, path, newVal);
	}
	yield result;
}

// ---------------------------------------------------------------------------
// Path evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate an expression in "path mode", yielding [path, value] pairs.
 * Used by update operators and the path() builtin.
 */
export function* evaluatePath(
	node: JqNode,
	input: JsonValue,
	env: JqEnv,
): Generator<[JsonValue[], JsonValue]> {
	switch (node.type) {
		case 'Identity':
			yield [[], input];
			return;
		case 'Field': {
			if (input === null) {
				yield [[node.name], null];
			} else if (typeof input === 'object' && !Array.isArray(input)) {
				yield [[node.name], (input as JsonObject)[node.name] ?? null];
			}
			return;
		}
		case 'Index': {
			for (const idx of evaluate(node.index, input, env)) {
				if (typeof idx === 'number' && Array.isArray(input)) {
					const i = idx < 0 ? input.length + idx : idx;
					yield [[i], input[i] ?? null];
				} else if (
					typeof idx === 'string' &&
					input !== null &&
					typeof input === 'object' &&
					!Array.isArray(input)
				) {
					yield [[idx], (input as JsonObject)[idx] ?? null];
				}
			}
			return;
		}
		case 'Iterate': {
			if (Array.isArray(input)) {
				for (let i = 0; i < input.length; i++) {
					yield [[i], input[i]];
				}
			} else if (input !== null && typeof input === 'object') {
				const keys = Object.keys(input);
				for (let i = 0; i < keys.length; i++) {
					yield [[keys[i]], (input as JsonObject)[keys[i]]];
				}
			}
			return;
		}
		case 'Pipe': {
			for (const [leftPath, leftVal] of evaluatePath(node.left, input, env)) {
				for (const [rightPath, rightVal] of evaluatePath(node.right, leftVal, env)) {
					const combined: JsonValue[] = [];
					for (let i = 0; i < leftPath.length; i++) combined.push(leftPath[i]);
					for (let i = 0; i < rightPath.length; i++) combined.push(rightPath[i]);
					yield [combined, rightVal];
				}
			}
			return;
		}
		case 'Optional': {
			try {
				yield* evaluatePath(node.expr, input, env);
			} catch (e) {
				if (e instanceof JqRuntimeError || e instanceof JqTypeError) return;
				throw e;
			}
			return;
		}
		case 'Comma': {
			yield* evaluatePath(node.left, input, env);
			yield* evaluatePath(node.right, input, env);
			return;
		}
		case 'RecursiveDescent': {
			yield* recursiveDescentPaths(input, []);
			return;
		}
		case 'FunctionCall': {
			// select(f) in path mode
			if (node.name === 'select' && node.args.length > 0) {
				for (const v of evaluate(node.args[0], input, env)) {
					if (isTruthy(v)) {
						yield [[], input];
					}
				}
				return;
			}
			// recurse in path mode
			if (node.name === 'recurse') {
				yield* recursiveDescentPaths(input, []);
				return;
			}
			break;
		}
		default:
			break;
	}

	// Fallback: evaluate normally and yield empty path
	for (const v of evaluate(node, input, env)) {
		yield [[], v];
	}
}

function* recursiveDescentPaths(
	input: JsonValue,
	prefix: JsonValue[],
): Generator<[JsonValue[], JsonValue]> {
	yield [prefix.slice(), input];
	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			const path = prefix.slice();
			path.push(i);
			yield* recursiveDescentPaths(input[i], path);
		}
	} else if (input !== null && typeof input === 'object') {
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			const path = prefix.slice();
			path.push(keys[i]);
			yield* recursiveDescentPaths((input as JsonObject)[keys[i]], path);
		}
	}
}

function* emitPaths(input: JsonValue, filter: JqNode | null, env: JqEnv): Generator<JsonValue> {
	yield* emitPathsInner(input, [], filter, env);
}

function* emitPathsInner(
	input: JsonValue,
	prefix: JsonValue[],
	filter: JqNode | null,
	env: JqEnv,
): Generator<JsonValue> {
	if (filter !== null) {
		let matches = false;
		for (const v of evaluate(filter, input, env)) {
			if (isTruthy(v)) {
				matches = true;
				break;
			}
		}
		if (matches) yield prefix.slice();
	} else {
		yield prefix.slice();
	}
	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			const path = prefix.slice();
			path.push(i);
			yield* emitPathsInner(input[i], path, filter, env);
		}
	} else if (input !== null && typeof input === 'object') {
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			const path = prefix.slice();
			path.push(keys[i]);
			yield* emitPathsInner((input as JsonObject)[keys[i]], path, filter, env);
		}
	}
}

function* emitLeafPaths(input: JsonValue, prefix: JsonValue[]): Generator<JsonValue> {
	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			const path = prefix.slice();
			path.push(i);
			yield* emitLeafPaths(input[i], path);
		}
	} else if (input !== null && typeof input === 'object') {
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			const path = prefix.slice();
			path.push(keys[i]);
			yield* emitLeafPaths((input as JsonObject)[keys[i]], path);
		}
	} else {
		yield prefix.slice();
	}
}

/** Get value at a path in a JSON value. */
export function getPath(input: JsonValue, path: JsonValue[]): JsonValue {
	let current = input;
	for (let i = 0; i < path.length; i++) {
		const seg = path[i];
		if (current === null) return null;
		if (typeof seg === 'number' && Array.isArray(current)) {
			current = current[seg] ?? null;
		} else if (typeof seg === 'string' && typeof current === 'object' && !Array.isArray(current)) {
			current = (current as JsonObject)[seg] ?? null;
		} else {
			return null;
		}
	}
	return current;
}

/** Set value at a path in a JSON value, returning a new value. */
export function setPath(input: JsonValue, path: JsonValue[], value: JsonValue): JsonValue {
	if (path.length === 0) return value;

	const seg = path[0];
	const rest = path.slice(1);

	if (typeof seg === 'number') {
		const arr = Array.isArray(input) ? input.slice() : [];
		while (arr.length <= seg) arr.push(null);
		arr[seg] = setPath(arr[seg], rest, value);
		return arr;
	}
	if (typeof seg === 'string') {
		const obj: JsonObject = {};
		if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
			const keys = Object.keys(input);
			for (let i = 0; i < keys.length; i++) {
				obj[keys[i]] = (input as JsonObject)[keys[i]];
			}
		}
		obj[seg] = setPath(obj[seg] ?? null, rest, value);
		return obj;
	}
	return input;
}

/** Delete a path from a JSON value. */
function deletePath(input: JsonValue, path: JsonValue[]): JsonValue {
	if (path.length === 0) return input;
	if (path.length === 1) {
		const seg = path[0];
		if (typeof seg === 'number' && Array.isArray(input)) {
			const arr = input.slice();
			arr.splice(seg, 1);
			return arr;
		}
		if (
			typeof seg === 'string' &&
			input !== null &&
			typeof input === 'object' &&
			!Array.isArray(input)
		) {
			const obj: JsonObject = {};
			const keys = Object.keys(input);
			for (let i = 0; i < keys.length; i++) {
				if (keys[i] !== seg) obj[keys[i]] = (input as JsonObject)[keys[i]];
			}
			return obj;
		}
		return input;
	}

	const seg = path[0];
	const rest = path.slice(1);

	if (typeof seg === 'number' && Array.isArray(input)) {
		const arr = input.slice();
		if (seg < arr.length) {
			arr[seg] = deletePath(arr[seg], rest);
		}
		return arr;
	}
	if (
		typeof seg === 'string' &&
		input !== null &&
		typeof input === 'object' &&
		!Array.isArray(input)
	) {
		const obj: JsonObject = {};
		const keys = Object.keys(input);
		for (let i = 0; i < keys.length; i++) {
			obj[keys[i]] = (input as JsonObject)[keys[i]];
		}
		if (seg in obj) {
			obj[seg] = deletePath(obj[seg], rest);
		}
		return obj;
	}
	return input;
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
