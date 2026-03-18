/**
 * AST node types for the jq filter language.
 *
 * Every node carries a `type` discriminant string so the evaluator can
 * use an exhaustive switch/case. No class hierarchy - plain interfaces.
 */

// ---------------------------------------------------------------------------
// Primitives & access
// ---------------------------------------------------------------------------

/** `.` - pass input through unchanged */
export interface Identity {
	type: 'Identity';
}

/** `..` - recursively descend into all values */
export interface RecursiveDescent {
	type: 'RecursiveDescent';
}

/** `.name` or `."name"` - access an object field */
export interface Field {
	type: 'Field';
	name: string;
}

/** `.[expr]` - index into an array or object */
export interface Index {
	type: 'Index';
	index: JqNode;
}

/** `.[start:end]` - array/string slice */
export interface Slice {
	type: 'Slice';
	from: JqNode | null;
	to: JqNode | null;
}

/** `.[]` - iterate all values */
export interface Iterate {
	type: 'Iterate';
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** `left | right` - pipe output of left into right */
export interface Pipe {
	type: 'Pipe';
	left: JqNode;
	right: JqNode;
}

/** `left , right` - produce outputs of both expressions */
export interface Comma {
	type: 'Comma';
	left: JqNode;
	right: JqNode;
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

/** A literal value: number, string, boolean, or null */
export interface Literal {
	type: 'Literal';
	value: number | string | boolean | null;
}

/** String with `\(expr)` interpolation segments */
export interface StringInterpolation {
	type: 'StringInterpolation';
	/** Alternating string-literal parts and expression parts.
	 *  Always starts and ends with a string (possibly empty). */
	parts: JqNode[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** `[expr]` - build an array from all outputs of expr */
export interface ArrayConstruction {
	type: 'ArrayConstruction';
	expr: JqNode | null;
}

/** A single key-value pair in an object construction. */
export interface ObjectEntry {
	key: JqNode;
	value: JqNode | null;
	/** True when the key is a computed expression (parenthesized). */
	computed: boolean;
}

/** `{key: value, ...}` - build an object */
export interface ObjectConstruction {
	type: 'ObjectConstruction';
	entries: ObjectEntry[];
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

/** Binary arithmetic: `+`, `-`, `*`, `/`, `%` */
export interface Arithmetic {
	type: 'Arithmetic';
	op: '+' | '-' | '*' | '/' | '%';
	left: JqNode;
	right: JqNode;
}

/** Binary comparison: `==`, `!=`, `<`, `>`, `<=`, `>=` */
export interface Comparison {
	type: 'Comparison';
	op: '==' | '!=' | '<' | '>' | '<=' | '>=';
	left: JqNode;
	right: JqNode;
}

/** Binary logic: `and`, `or` */
export interface Logic {
	type: 'Logic';
	op: 'and' | 'or';
	left: JqNode;
	right: JqNode;
}

/** Unary `not` */
export interface Not {
	type: 'Not';
	expr: JqNode;
}

/** Unary negation `-expr` */
export interface Negate {
	type: 'Negate';
	expr: JqNode;
}

/** `//` alternative operator */
export interface Alternative {
	type: 'Alternative';
	left: JqNode;
	right: JqNode;
}

// ---------------------------------------------------------------------------
// Update operators
// ---------------------------------------------------------------------------

/** `path |= expr` - update in place */
export interface Update {
	type: 'Update';
	path: JqNode;
	value: JqNode;
}

/** `path += expr`, `-=`, `*=`, `/=`, `%=`, `//=` */
export interface UpdateOp {
	type: 'UpdateOp';
	op: '+=' | '-=' | '*=' | '/=' | '%=' | '//=';
	path: JqNode;
	value: JqNode;
}

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

/** A single elif/else branch. */
export interface CondBranch {
	condition: JqNode;
	body: JqNode;
}

/** `if cond then body (elif cond then body)* (else body)? end` */
export interface If {
	type: 'If';
	condition: JqNode;
	then: JqNode;
	elifs: CondBranch[];
	else: JqNode | null;
}

/** `try expr` or `try expr catch handler` */
export interface TryCatch {
	type: 'TryCatch';
	expr: JqNode;
	catch: JqNode | null;
}

/** `reduce expr as $var (init; update)` */
export interface Reduce {
	type: 'Reduce';
	expr: JqNode;
	variable: string;
	init: JqNode;
	update: JqNode;
}

/** `foreach expr as $var (init; update; extract?)` */
export interface Foreach {
	type: 'Foreach';
	expr: JqNode;
	variable: string;
	init: JqNode;
	update: JqNode;
	extract: JqNode | null;
}

/** `label $name | body` */
export interface Label {
	type: 'Label';
	name: string;
	body: JqNode;
}

/** `break $name` */
export interface Break {
	type: 'Break';
	name: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/** `def name(params): body;` */
export interface FunctionDef {
	type: 'FunctionDef';
	name: string;
	params: string[];
	body: JqNode;
	/** The expression following the function definition (after `;`). */
	next: JqNode;
}

/** `name` or `name(args; ...)` - call a builtin or user function */
export interface FunctionCall {
	type: 'FunctionCall';
	name: string;
	args: JqNode[];
}

// ---------------------------------------------------------------------------
// Variable binding
// ---------------------------------------------------------------------------

/** `expr as $var | body` */
export interface VariableBinding {
	type: 'VariableBinding';
	expr: JqNode;
	/** Variable name (without $) or a destructuring pattern. */
	pattern: BindingPattern;
	body: JqNode;
}

/** Binding target: a simple variable or a destructuring pattern. */
export type BindingPattern =
	| { kind: 'variable'; name: string }
	| { kind: 'array'; elements: BindingPattern[] }
	| { kind: 'object'; entries: { key: string; pattern: BindingPattern }[] };

// ---------------------------------------------------------------------------
// Postfix & format
// ---------------------------------------------------------------------------

/** `expr?` - suppress errors */
export interface Optional {
	type: 'Optional';
	expr: JqNode;
}

/** `@base64`, `@csv`, etc. - format string */
export interface Format {
	type: 'Format';
	name: string;
	/** Optional string argument for format interpolation, e.g. `@base64 "text"` */
	str: JqNode | null;
}

/** Variable reference `$name` */
export interface Variable {
	type: 'Variable';
	name: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/** Discriminated union of all jq AST node types. */
export type JqNode =
	| Identity
	| RecursiveDescent
	| Field
	| Index
	| Slice
	| Iterate
	| Pipe
	| Comma
	| Literal
	| StringInterpolation
	| ArrayConstruction
	| ObjectConstruction
	| Arithmetic
	| Comparison
	| Logic
	| Not
	| Negate
	| Alternative
	| Update
	| UpdateOp
	| If
	| TryCatch
	| Reduce
	| Foreach
	| Label
	| Break
	| FunctionDef
	| FunctionCall
	| VariableBinding
	| Optional
	| Format
	| Variable;
