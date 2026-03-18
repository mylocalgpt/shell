import type { FileSystem } from '../fs/types.js';
import type {
	ArithmeticExpansion,
	BraceExpansion,
	ConcatWord,
	GlobWord,
	LiteralWord,
	QuotedWord,
	TildeWord,
	VariableWord,
	Word,
	WordPart,
} from '../parser/ast.js';
import { globMatch } from '../utils/glob.js';

/**
 * Shell state needed by the expansion engine.
 */
export interface ShellState {
	/** Environment and shell variables. */
	env: Map<string, string>;
	/** Positional parameters ($1, $2, ...). */
	positionalParams: string[];
	/** Named arrays (associative or indexed). */
	arrays: Map<string, string[]>;
	/** Last exit code ($?). */
	lastExitCode: number;
	/** Shell PID ($$). */
	pid: number;
	/** Background PID ($!). */
	bgPid: number;
	/** Current working directory. */
	cwd: string;
	/** Shell options (nounset, etc.). */
	options: { nounset: boolean };
	/** The virtual filesystem (for glob expansion). */
	fs: FileSystem;
}

/**
 * Options for word expansion.
 */
export interface ExpansionOpts {
	/** Whether expansion occurs inside double quotes. */
	doubleQuoted: boolean;
	/** Whether this is an assignment context (affects tilde, word splitting). */
	assignmentContext: boolean;
	/** Whether this is a case pattern (glob but no word splitting). */
	casePattern: boolean;
	/** Execute a command substitution and return its stdout. */
	executor: (cmd: string) => Promise<string>;
}

/**
 * Expand a Word AST node into string(s).
 * Multiple results are possible from glob, brace, or word splitting.
 *
 * @param word - The parsed Word node
 * @param state - Current shell state
 * @param opts - Expansion options
 * @returns Array of expanded strings
 */
export async function expandWord(
	word: Word,
	state: ShellState,
	opts: ExpansionOpts,
): Promise<string[]> {
	// Step 1: Brace expansion (only for unquoted words)
	const braceExpanded = expandBraces(word);

	const results: string[] = [];

	for (let i = 0; i < braceExpanded.length; i++) {
		// Step 2-5: Expand each brace result through the remaining pipeline
		const expanded = await expandSingleWord(braceExpanded[i], state, opts);

		// Step 6: Word splitting (only for unquoted results of param/cmd/arith expansion)
		if (!opts.doubleQuoted && !opts.casePattern) {
			const split = splitOnIFS(expanded, state);
			for (let j = 0; j < split.length; j++) {
				results.push(split[j]);
			}
		} else {
			results.push(expanded);
		}
	}

	// Step 7: Glob expansion (only for unquoted words)
	if (!opts.doubleQuoted && !opts.casePattern) {
		const globbed: string[] = [];
		for (let i = 0; i < results.length; i++) {
			const expanded = expandGlob(results[i], state);
			for (let j = 0; j < expanded.length; j++) {
				globbed.push(expanded[j]);
			}
		}
		return globbed;
	}

	return results;
}

/**
 * Expand a single word through tilde, parameter, command sub, arithmetic.
 */
async function expandSingleWord(
	word: Word,
	state: ShellState,
	opts: ExpansionOpts,
): Promise<string> {
	switch (word.type) {
		case 'LiteralWord':
			return word.value;

		case 'QuotedWord':
			return expandQuotedWord(word, state, opts);

		case 'VariableWord':
			return expandVariable(word, state, opts);

		case 'CommandSubstitution': {
			const body = await expandCommandSubstitution(word, opts);
			return body;
		}

		case 'ArithmeticExpansion':
			return expandArithmetic(word, state);

		case 'TildeWord':
			return expandTilde(word, state);

		case 'GlobWord':
			// Glob patterns are kept as-is during single word expansion;
			// actual glob resolution happens later in expandGlob
			return word.pattern;

		case 'BraceExpansion':
			// Brace expansion should have been handled in expandBraces
			return '';

		case 'ArraySubscript':
			return '';

		case 'ConcatWord':
			return expandConcatWord(word, state, opts);

		default:
			return '';
	}
}

/** Expand a double-quoted word, preserving embedded expansions. */
async function expandQuotedWord(
	word: QuotedWord,
	state: ShellState,
	opts: ExpansionOpts,
): Promise<string> {
	if (word.quoteType === 'single') {
		// Single-quoted: no expansion at all
		let result = '';
		for (let i = 0; i < word.parts.length; i++) {
			if (word.parts[i].type === 'LiteralWord') {
				result += (word.parts[i] as LiteralWord).value;
			}
		}
		return result;
	}

	if (word.quoteType === 'ansi-c') {
		// ANSI-C: process escape sequences
		let result = '';
		for (let i = 0; i < word.parts.length; i++) {
			if (word.parts[i].type === 'LiteralWord') {
				result += processAnsiCEscapes((word.parts[i] as LiteralWord).value);
			}
		}
		return result;
	}

	// Double-quoted: expand embedded expansions
	const innerOpts: ExpansionOpts = { ...opts, doubleQuoted: true };
	let result = '';
	for (let i = 0; i < word.parts.length; i++) {
		const part = word.parts[i];
		const expanded = await expandSingleWord(part, state, innerOpts);
		result += expanded;
	}
	return result;
}

/** Expand a concatenation of word parts. */
async function expandConcatWord(
	word: ConcatWord,
	state: ShellState,
	opts: ExpansionOpts,
): Promise<string> {
	let result = '';
	for (let i = 0; i < word.parts.length; i++) {
		const expanded = await expandSingleWord(word.parts[i], state, opts);
		result += expanded;
	}
	return result;
}

/**
 * Process ANSI-C escape sequences in a string.
 */
function processAnsiCEscapes(input: string): string {
	let result = '';
	let i = 0;
	while (i < input.length) {
		if (input[i] === '\\' && i + 1 < input.length) {
			const next = input[i + 1];
			switch (next) {
				case 'n':
					result += '\n';
					i += 2;
					break;
				case 't':
					result += '\t';
					i += 2;
					break;
				case 'r':
					result += '\r';
					i += 2;
					break;
				case '\\':
					result += '\\';
					i += 2;
					break;
				case "'":
					result += "'";
					i += 2;
					break;
				case '"':
					result += '"';
					i += 2;
					break;
				case 'a':
					result += '\x07';
					i += 2;
					break;
				case 'b':
					result += '\b';
					i += 2;
					break;
				case 'e':
				case 'E':
					result += '\x1B';
					i += 2;
					break;
				case 'f':
					result += '\f';
					i += 2;
					break;
				case 'v':
					result += '\v';
					i += 2;
					break;
				case '0': {
					// Octal \0nnn
					let octal = '';
					i += 2;
					while (i < input.length && octal.length < 3 && input[i] >= '0' && input[i] <= '7') {
						octal += input[i];
						i++;
					}
					result += String.fromCharCode(Number.parseInt(octal || '0', 8));
					break;
				}
				case 'x': {
					// Hex \xHH
					let hex = '';
					i += 2;
					while (i < input.length && hex.length < 2 && isHexChar(input[i])) {
						hex += input[i];
						i++;
					}
					if (hex.length > 0) {
						result += String.fromCharCode(Number.parseInt(hex, 16));
					}
					break;
				}
				default:
					result += input[i];
					result += input[i + 1];
					i += 2;
					break;
			}
		} else {
			result += input[i];
			i++;
		}
	}
	return result;
}

function isHexChar(ch: string): boolean {
	return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

/**
 * Expand a variable/parameter word.
 */
function expandVariable(word: VariableWord, state: ShellState, _opts: ExpansionOpts): string {
	const name = word.name;

	// Special variables
	const special = getSpecialVariable(name, state);
	if (special !== undefined) {
		return applyParamOperator(special, word, state);
	}

	// Array subscript: arr[index]
	if (name.includes('[')) {
		return expandArrayAccess(name, word, state);
	}

	// Regular variable
	const value = state.env.get(name);

	// Nounset check
	if (value === undefined && state.options.nounset && word.operator === null) {
		throw new Error(`${name}: unbound variable`);
	}

	return applyParamOperator(value ?? '', word, state);
}

/** Get a special variable value, or undefined if not special. */
function getSpecialVariable(name: string, state: ShellState): string | undefined {
	switch (name) {
		case '?':
			return String(state.lastExitCode);
		case '$':
			return String(state.pid);
		case '!':
			return String(state.bgPid);
		case '#':
			return String(state.positionalParams.length);
		case '@':
		case '*':
			return state.positionalParams.join(' ');
		case '0':
			return state.env.get('0') ?? 'shell';
		case '_':
			return state.env.get('_') ?? '';
		case '-':
			return state.env.get('-') ?? '';
		default:
			break;
	}

	// Positional parameter: $1, $2, ...
	if (name.length === 1 && name >= '1' && name <= '9') {
		const idx = Number.parseInt(name, 10) - 1;
		return idx < state.positionalParams.length ? state.positionalParams[idx] : '';
	}

	return undefined;
}

/** Expand array access like arr[0], arr[@], arr[*]. */
function expandArrayAccess(name: string, word: VariableWord, state: ShellState): string {
	const bracketIdx = name.indexOf('[');
	const arrayName = name.slice(0, bracketIdx);
	const subscript = name.slice(bracketIdx + 1, name.length - 1);
	const arr = state.arrays.get(arrayName) ?? [];

	// ${#arr[@]} - array length
	if (word.length) {
		return String(arr.length);
	}

	// ${!arr[@]} - array indices
	if (word.indirect) {
		const indices: string[] = [];
		for (let i = 0; i < arr.length; i++) {
			indices.push(String(i));
		}
		return indices.join(' ');
	}

	if (subscript === '@' || subscript === '*') {
		return arr.join(' ');
	}

	const idx = Number.parseInt(subscript, 10);
	if (Number.isNaN(idx)) return '';
	return idx >= 0 && idx < arr.length ? arr[idx] : '';
}

/**
 * Apply parameter expansion operator (:-,  :+, :=, :?, #, ##, %, %%, //, etc.)
 */
function applyParamOperator(value: string, word: VariableWord, state: ShellState): string {
	if (word.length && !word.name.includes('[')) {
		return String(value.length);
	}

	if (word.operator === null) {
		return value;
	}

	const op = word.operator;
	const operandValue = word.operand ? getWordLiteralValue(word.operand) : '';

	switch (op) {
		case ':-':
			return value.length === 0 ? operandValue : value;
		case '-':
			return state.env.has(word.name) ? value : operandValue;
		case ':=': {
			if (value.length === 0) {
				state.env.set(word.name, operandValue);
				return operandValue;
			}
			return value;
		}
		case '=': {
			if (!state.env.has(word.name)) {
				state.env.set(word.name, operandValue);
				return operandValue;
			}
			return value;
		}
		case ':+':
			return value.length > 0 ? operandValue : '';
		case '+':
			return state.env.has(word.name) ? operandValue : '';
		case ':?':
			if (value.length === 0) {
				throw new Error(
					operandValue.length > 0
						? `${word.name}: ${operandValue}`
						: `${word.name}: parameter null or not set`,
				);
			}
			return value;
		case '?':
			if (!state.env.has(word.name)) {
				throw new Error(
					operandValue.length > 0
						? `${word.name}: ${operandValue}`
						: `${word.name}: parameter not set`,
				);
			}
			return value;
		case '#':
			return stripPrefix(value, operandValue, false);
		case '##':
			return stripPrefix(value, operandValue, true);
		case '%':
			return stripSuffix(value, operandValue, false);
		case '%%':
			return stripSuffix(value, operandValue, true);
		case '/':
			return substituteFirst(value, operandValue);
		case '//':
			return substituteAll(value, operandValue);
		case ':': {
			// Substring: ${VAR:offset} or ${VAR:offset:length}
			return substringOp(value, operandValue);
		}
		default:
			return value;
	}
}

/** Get the literal string value of a Word. */
function getWordLiteralValue(word: Word): string {
	switch (word.type) {
		case 'LiteralWord':
			return word.value;
		case 'QuotedWord':
			return word.parts.map((p) => (p.type === 'LiteralWord' ? p.value : '')).join('');
		case 'ConcatWord':
			return word.parts.map((p) => (p.type === 'LiteralWord' ? p.value : '')).join('');
		default:
			return '';
	}
}

/** Strip shortest/longest prefix matching a glob pattern. */
function stripPrefix(value: string, pattern: string, longest: boolean): string {
	if (longest) {
		for (let i = value.length; i >= 0; i--) {
			if (globMatch(pattern, value.slice(0, i))) {
				return value.slice(i);
			}
		}
	} else {
		for (let i = 0; i <= value.length; i++) {
			if (globMatch(pattern, value.slice(0, i))) {
				return value.slice(i);
			}
		}
	}
	return value;
}

/** Strip shortest/longest suffix matching a glob pattern. */
function stripSuffix(value: string, pattern: string, longest: boolean): string {
	if (longest) {
		for (let i = 0; i <= value.length; i++) {
			if (globMatch(pattern, value.slice(i))) {
				return value.slice(0, i);
			}
		}
	} else {
		for (let i = value.length; i >= 0; i--) {
			if (globMatch(pattern, value.slice(i))) {
				return value.slice(0, i);
			}
		}
	}
	return value;
}

/** First occurrence substitution. Pattern/replacement separated by /. */
function substituteFirst(value: string, operand: string): string {
	const slashIdx = operand.indexOf('/');
	const pattern = slashIdx >= 0 ? operand.slice(0, slashIdx) : operand;
	const replacement = slashIdx >= 0 ? operand.slice(slashIdx + 1) : '';

	for (let i = 0; i < value.length; i++) {
		for (let j = i + 1; j <= value.length; j++) {
			if (globMatch(pattern, value.slice(i, j))) {
				return value.slice(0, i) + replacement + value.slice(j);
			}
		}
	}
	return value;
}

/** All occurrences substitution. */
function substituteAll(value: string, operand: string): string {
	const slashIdx = operand.indexOf('/');
	const pattern = slashIdx >= 0 ? operand.slice(0, slashIdx) : operand;
	const replacement = slashIdx >= 0 ? operand.slice(slashIdx + 1) : '';

	let result = '';
	let i = 0;
	while (i < value.length) {
		let matched = false;
		for (let j = i + 1; j <= value.length; j++) {
			if (globMatch(pattern, value.slice(i, j))) {
				result += replacement;
				i = j;
				matched = true;
				break;
			}
		}
		if (!matched) {
			result += value[i];
			i++;
		}
	}
	return result;
}

/** Substring operation: offset or offset:length. */
function substringOp(value: string, operand: string): string {
	const parts = operand.split(':');
	const offset = Number.parseInt(parts[0] || '0', 10);
	const length = parts.length > 1 ? Number.parseInt(parts[1], 10) : undefined;

	const start = offset < 0 ? Math.max(0, value.length + offset) : offset;
	if (length !== undefined) {
		return value.slice(start, start + length);
	}
	return value.slice(start);
}

/**
 * Expand command substitution by calling the executor callback.
 */
async function expandCommandSubstitution(
	word: { type: 'CommandSubstitution' },
	opts: ExpansionOpts,
): Promise<string> {
	// The executor is expected to be provided by the interpreter.
	// For now, we reconstruct the command text from the AST body (simplified).
	// The interpreter will handle the actual execution.
	const result = await opts.executor('');
	// Trim trailing newline (bash behavior)
	return result.replace(/\n+$/, '');
}

/**
 * Expand tilde to home directory.
 */
function expandTilde(word: TildeWord, state: ShellState): string {
	if (word.suffix === '') {
		return state.env.get('HOME') ?? '~';
	}
	if (word.suffix === '+') {
		return state.env.get('PWD') ?? state.cwd;
	}
	if (word.suffix === '-') {
		return state.env.get('OLDPWD') ?? '~-';
	}
	// ~user is not supported in virtual FS
	return `~${word.suffix}`;
}

/**
 * Expand brace expressions at the word level.
 * Brace expansion happens before all other expansions.
 */
function expandBraces(word: Word): Word[] {
	if (word.type !== 'BraceExpansion') {
		if (word.type === 'ConcatWord') {
			return expandBracesInConcat(word);
		}
		return [word];
	}

	const results: Word[] = [];
	for (let i = 0; i < word.parts.length; i++) {
		const part = word.parts[i];
		if (part.type === 'list') {
			for (let j = 0; j < part.items.length; j++) {
				results.push(part.items[j]);
			}
		} else if (part.type === 'range') {
			const rangeValues = expandRange(part.start, part.end, part.incr);
			for (let j = 0; j < rangeValues.length; j++) {
				results.push({
					type: 'LiteralWord',
					value: rangeValues[j],
					pos: word.pos,
				});
			}
		}
	}

	return results.length > 0 ? results : [word];
}

/** Expand braces inside a ConcatWord. */
function expandBracesInConcat(word: ConcatWord): Word[] {
	// Find the first BraceExpansion part
	let braceIdx = -1;
	for (let i = 0; i < word.parts.length; i++) {
		if (word.parts[i].type === 'BraceExpansion') {
			braceIdx = i;
			break;
		}
	}

	if (braceIdx < 0) return [word];

	const prefix = word.parts.slice(0, braceIdx);
	const braces = expandBraces(word.parts[braceIdx] as Word);
	const suffix = word.parts.slice(braceIdx + 1);

	const results: Word[] = [];
	for (let i = 0; i < braces.length; i++) {
		const parts: WordPart[] = [];
		for (let j = 0; j < prefix.length; j++) parts.push(prefix[j]);
		if (braces[i].type === 'ConcatWord') {
			const concatParts = (braces[i] as ConcatWord).parts;
			for (let j = 0; j < concatParts.length; j++) {
				parts.push(concatParts[j]);
			}
		} else {
			parts.push(braces[i] as WordPart);
		}
		for (let j = 0; j < suffix.length; j++) parts.push(suffix[j]);

		if (parts.length === 1) {
			results.push(parts[0]);
		} else {
			results.push({ type: 'ConcatWord', parts, pos: word.pos });
		}
	}

	// Recursively expand in case there are more braces
	const final: Word[] = [];
	for (let i = 0; i < results.length; i++) {
		const expanded = expandBraces(results[i]);
		for (let j = 0; j < expanded.length; j++) {
			final.push(expanded[j]);
		}
	}

	return final;
}

/** Expand a brace range like {1..5}, {a..z}, {01..10..2}. */
function expandRange(start: string, end: string, incr: number | null): string[] {
	const startNum = Number.parseInt(start, 10);
	const endNum = Number.parseInt(end, 10);

	if (!Number.isNaN(startNum) && !Number.isNaN(endNum)) {
		return expandNumericRange(start, startNum, endNum, incr);
	}

	// Character range
	if (start.length === 1 && end.length === 1) {
		return expandCharRange(start, end, incr);
	}

	return [`{${start}..${end}${incr !== null ? `..${incr}` : ''}}`];
}

/** Expand numeric range with optional zero-padding and step. */
function expandNumericRange(
	startStr: string,
	startNum: number,
	endNum: number,
	incr: number | null,
): string[] {
	const step = incr !== null ? Math.abs(incr) : 1;
	if (step === 0) return [startStr];

	const results: string[] = [];
	const zeroPad =
		(startStr[0] === '0' && startStr.length > 1) ||
		(String(endNum)[0] === '0' && String(endNum).length > 1);
	const width = zeroPad ? Math.max(startStr.length, String(endNum).length) : 0;

	if (startNum <= endNum) {
		for (let n = startNum; n <= endNum; n += step) {
			results.push(zeroPad ? padNumber(n, width) : String(n));
		}
	} else {
		for (let n = startNum; n >= endNum; n -= step) {
			results.push(zeroPad ? padNumber(n, width) : String(n));
		}
	}

	return results;
}

/** Zero-pad a number to a given width. */
function padNumber(n: number, width: number): string {
	let s = String(Math.abs(n));
	while (s.length < width) {
		s = `0${s}`;
	}
	return n < 0 ? `-${s}` : s;
}

/** Expand character range like {a..z}. */
function expandCharRange(start: string, end: string, incr: number | null): string[] {
	const startCode = start.charCodeAt(0);
	const endCode = end.charCodeAt(0);
	const step = incr !== null ? Math.abs(incr) : 1;
	if (step === 0) return [start];

	const results: string[] = [];
	if (startCode <= endCode) {
		for (let c = startCode; c <= endCode; c += step) {
			results.push(String.fromCharCode(c));
		}
	} else {
		for (let c = startCode; c >= endCode; c -= step) {
			results.push(String.fromCharCode(c));
		}
	}
	return results;
}

/**
 * Expand arithmetic expression.
 */
function expandArithmetic(word: ArithmeticExpansion, state: ShellState): string {
	const result = evaluateArithmetic(word.expression, state);
	return String(result);
}

/**
 * Evaluate an arithmetic expression string.
 * Supports: +, -, *, /, %, **, unary -, !, ~,
 * comparisons (==, !=, <, >, <=, >=),
 * logical (&&, ||), bitwise (&, |, ^, <<, >>),
 * ternary (? :), comma, assignment (=, +=, -=, etc.),
 * pre/post increment/decrement (++, --),
 * variable references (bare names).
 */
export function evaluateArithmetic(expr: string, state: ShellState): number {
	const tokens = tokenizeArith(expr);
	const parser = new ArithParser(tokens, state);
	if (tokens.length === 0) return 0;
	const result = parser.parseComma();
	return result | 0; // 32-bit integer
}

/** Arithmetic token types. */
type ArithTokenType =
	| 'Number'
	| 'Name'
	| 'Plus'
	| 'Minus'
	| 'Star'
	| 'Slash'
	| 'Percent'
	| 'DoubleStar'
	| 'Amp'
	| 'Pipe'
	| 'Caret'
	| 'Tilde'
	| 'Bang'
	| 'DoubleAmp'
	| 'DoublePipe'
	| 'DoubleEq'
	| 'BangEq'
	| 'Less'
	| 'Greater'
	| 'LessEq'
	| 'GreaterEq'
	| 'LShift'
	| 'RShift'
	| 'Question'
	| 'Colon'
	| 'Comma'
	| 'Eq'
	| 'PlusEq'
	| 'MinusEq'
	| 'StarEq'
	| 'SlashEq'
	| 'PercentEq'
	| 'DoublePlus'
	| 'DoubleMinus'
	| 'LParen'
	| 'RParen'
	| 'EOF';

interface ArithToken {
	type: ArithTokenType;
	value: string;
}

/** Tokenize an arithmetic expression. */
function tokenizeArith(expr: string): ArithToken[] {
	const tokens: ArithToken[] = [];
	let i = 0;

	while (i < expr.length) {
		const ch = expr[i];

		// Whitespace
		if (ch === ' ' || ch === '\t' || ch === '\n') {
			i++;
			continue;
		}

		// Numbers
		if (ch >= '0' && ch <= '9') {
			let num = '';
			while (
				i < expr.length &&
				((expr[i] >= '0' && expr[i] <= '9') ||
					expr[i] === 'x' ||
					expr[i] === 'X' ||
					(num.includes('x') && isHexChar(expr[i])))
			) {
				num += expr[i];
				i++;
			}
			tokens.push({ type: 'Number', value: num });
			continue;
		}

		// Names (variables)
		if (isNameStart(ch)) {
			let name = '';
			while (i < expr.length && isNameChar(expr[i])) {
				name += expr[i];
				i++;
			}
			tokens.push({ type: 'Name', value: name });
			continue;
		}

		// Two-character operators
		if (i + 1 < expr.length) {
			const two = ch + expr[i + 1];
			const twoType = TWO_CHAR_OPS.get(two);
			if (twoType) {
				tokens.push({ type: twoType, value: two });
				i += 2;
				continue;
			}
		}

		// Single-character operators
		const oneType = ONE_CHAR_OPS.get(ch);
		if (oneType) {
			tokens.push({ type: oneType, value: ch });
			i++;
			continue;
		}

		// Skip $
		if (ch === '$') {
			i++;
			continue;
		}

		i++;
	}

	tokens.push({ type: 'EOF', value: '' });
	return tokens;
}

const TWO_CHAR_OPS: Map<string, ArithTokenType> = new Map([
	['**', 'DoubleStar'],
	['&&', 'DoubleAmp'],
	['||', 'DoublePipe'],
	['==', 'DoubleEq'],
	['!=', 'BangEq'],
	['<=', 'LessEq'],
	['>=', 'GreaterEq'],
	['<<', 'LShift'],
	['>>', 'RShift'],
	['+=', 'PlusEq'],
	['-=', 'MinusEq'],
	['*=', 'StarEq'],
	['/=', 'SlashEq'],
	['%=', 'PercentEq'],
	['++', 'DoublePlus'],
	['--', 'DoubleMinus'],
]);

const ONE_CHAR_OPS: Map<string, ArithTokenType> = new Map([
	['+', 'Plus'],
	['-', 'Minus'],
	['*', 'Star'],
	['/', 'Slash'],
	['%', 'Percent'],
	['&', 'Amp'],
	['|', 'Pipe'],
	['^', 'Caret'],
	['~', 'Tilde'],
	['!', 'Bang'],
	['<', 'Less'],
	['>', 'Greater'],
	['?', 'Question'],
	[':', 'Colon'],
	[',', 'Comma'],
	['=', 'Eq'],
	['(', 'LParen'],
	[')', 'RParen'],
]);

function isNameStart(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isNameChar(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;
}

/** Recursive descent parser for arithmetic expressions. */
class ArithParser {
	private readonly tokens: ArithToken[];
	private pos: number;
	private readonly state: ShellState;

	constructor(tokens: ArithToken[], state: ShellState) {
		this.tokens = tokens;
		this.pos = 0;
		this.state = state;
	}

	private current(): ArithToken {
		return this.tokens[this.pos];
	}

	private advance(): ArithToken {
		const tok = this.tokens[this.pos];
		if (this.pos < this.tokens.length - 1) this.pos++;
		return tok;
	}

	private expect(type: ArithTokenType): ArithToken {
		if (this.current().type !== type) {
			throw new Error(`arithmetic: expected ${type}, got ${this.current().type}`);
		}
		return this.advance();
	}

	parseComma(): number {
		let result = this.parseAssignment();
		while (this.current().type === 'Comma') {
			this.advance();
			result = this.parseAssignment();
		}
		return result;
	}

	private parseAssignment(): number {
		// Check for assignment: NAME = expr
		if (this.current().type === 'Name') {
			const name = this.current().value;
			const nextPos = this.pos + 1;
			if (nextPos < this.tokens.length) {
				const nextType = this.tokens[nextPos].type;
				if (nextType === 'Eq') {
					this.advance(); // name
					this.advance(); // =
					const val = this.parseAssignment();
					this.state.env.set(name, String(val));
					return val;
				}
				if (
					nextType === 'PlusEq' ||
					nextType === 'MinusEq' ||
					nextType === 'StarEq' ||
					nextType === 'SlashEq' ||
					nextType === 'PercentEq'
				) {
					this.advance(); // name
					const op = this.advance(); // compound assignment
					const rhs = this.parseAssignment();
					const current = Number.parseInt(this.state.env.get(name) ?? '0', 10);
					let val = 0;
					switch (op.type) {
						case 'PlusEq':
							val = current + rhs;
							break;
						case 'MinusEq':
							val = current - rhs;
							break;
						case 'StarEq':
							val = current * rhs;
							break;
						case 'SlashEq': {
							if (rhs === 0) throw new Error('arithmetic: division by zero');
							val = Math.trunc(current / rhs);
							break;
						}
						case 'PercentEq': {
							if (rhs === 0) throw new Error('arithmetic: division by zero');
							val = current % rhs;
							break;
						}
					}
					this.state.env.set(name, String(val | 0));
					return val | 0;
				}
			}
		}
		return this.parseTernary();
	}

	private parseTernary(): number {
		const result = this.parseLogicalOr();
		if (this.current().type === 'Question') {
			this.advance();
			const trueVal = this.parseAssignment();
			this.expect('Colon');
			const falseVal = this.parseAssignment();
			return result !== 0 ? trueVal : falseVal;
		}
		return result;
	}

	private parseLogicalOr(): number {
		let result = this.parseLogicalAnd();
		while (this.current().type === 'DoublePipe') {
			this.advance();
			const right = this.parseLogicalAnd();
			result = result !== 0 || right !== 0 ? 1 : 0;
		}
		return result;
	}

	private parseLogicalAnd(): number {
		let result = this.parseBitwiseOr();
		while (this.current().type === 'DoubleAmp') {
			this.advance();
			const right = this.parseBitwiseOr();
			result = result !== 0 && right !== 0 ? 1 : 0;
		}
		return result;
	}

	private parseBitwiseOr(): number {
		let result = this.parseBitwiseXor();
		while (this.current().type === 'Pipe') {
			this.advance();
			result = result | this.parseBitwiseXor();
		}
		return result;
	}

	private parseBitwiseXor(): number {
		let result = this.parseBitwiseAnd();
		while (this.current().type === 'Caret') {
			this.advance();
			result = result ^ this.parseBitwiseAnd();
		}
		return result;
	}

	private parseBitwiseAnd(): number {
		let result = this.parseEquality();
		while (this.current().type === 'Amp') {
			this.advance();
			result = result & this.parseEquality();
		}
		return result;
	}

	private parseEquality(): number {
		let result = this.parseRelational();
		while (this.current().type === 'DoubleEq' || this.current().type === 'BangEq') {
			const op = this.advance();
			const right = this.parseRelational();
			if (op.type === 'DoubleEq') result = result === right ? 1 : 0;
			else result = result !== right ? 1 : 0;
		}
		return result;
	}

	private parseRelational(): number {
		let result = this.parseShift();
		while (
			this.current().type === 'Less' ||
			this.current().type === 'Greater' ||
			this.current().type === 'LessEq' ||
			this.current().type === 'GreaterEq'
		) {
			const op = this.advance();
			const right = this.parseShift();
			switch (op.type) {
				case 'Less':
					result = result < right ? 1 : 0;
					break;
				case 'Greater':
					result = result > right ? 1 : 0;
					break;
				case 'LessEq':
					result = result <= right ? 1 : 0;
					break;
				case 'GreaterEq':
					result = result >= right ? 1 : 0;
					break;
			}
		}
		return result;
	}

	private parseShift(): number {
		let result = this.parseAddSub();
		while (this.current().type === 'LShift' || this.current().type === 'RShift') {
			const op = this.advance();
			const right = this.parseAddSub();
			if (op.type === 'LShift') result = result << right;
			else result = result >> right;
		}
		return result;
	}

	private parseAddSub(): number {
		let result = this.parseMulDivMod();
		while (this.current().type === 'Plus' || this.current().type === 'Minus') {
			const op = this.advance();
			const right = this.parseMulDivMod();
			if (op.type === 'Plus') result = result + right;
			else result = result - right;
		}
		return result;
	}

	private parseMulDivMod(): number {
		let result = this.parseExponentiation();
		while (
			this.current().type === 'Star' ||
			this.current().type === 'Slash' ||
			this.current().type === 'Percent'
		) {
			const op = this.advance();
			const right = this.parseExponentiation();
			if (op.type === 'Star') result = result * right;
			else if (op.type === 'Slash') {
				if (right === 0) throw new Error('arithmetic: division by zero');
				result = Math.trunc(result / right);
			} else {
				if (right === 0) throw new Error('arithmetic: division by zero');
				result = result % right;
			}
		}
		return result;
	}

	private parseExponentiation(): number {
		const base = this.parseUnary();
		if (this.current().type === 'DoubleStar') {
			this.advance();
			const exp = this.parseExponentiation(); // right-associative
			if (exp < 0) return 0; // bash returns 0 for negative exponents
			let result = 1;
			for (let i = 0; i < exp; i++) {
				result = result * base;
			}
			return result | 0;
		}
		return base;
	}

	private parseUnary(): number {
		if (this.current().type === 'Minus') {
			this.advance();
			return -this.parseUnary();
		}
		if (this.current().type === 'Plus') {
			this.advance();
			return this.parseUnary();
		}
		if (this.current().type === 'Bang') {
			this.advance();
			return this.parseUnary() === 0 ? 1 : 0;
		}
		if (this.current().type === 'Tilde') {
			this.advance();
			return ~this.parseUnary();
		}
		// Pre-increment/decrement
		if (this.current().type === 'DoublePlus' && this.tokens[this.pos + 1]?.type === 'Name') {
			this.advance();
			const name = this.advance().value;
			const val = (Number.parseInt(this.state.env.get(name) ?? '0', 10) + 1) | 0;
			this.state.env.set(name, String(val));
			return val;
		}
		if (this.current().type === 'DoubleMinus' && this.tokens[this.pos + 1]?.type === 'Name') {
			this.advance();
			const name = this.advance().value;
			const val = (Number.parseInt(this.state.env.get(name) ?? '0', 10) - 1) | 0;
			this.state.env.set(name, String(val));
			return val;
		}
		return this.parsePostfix();
	}

	private parsePostfix(): number {
		const result = this.parsePrimary();
		// Post-increment/decrement handled implicitly via primary
		return result;
	}

	private parsePrimary(): number {
		const tok = this.current();

		if (tok.type === 'Number') {
			this.advance();
			return parseNumber(tok.value);
		}

		if (tok.type === 'Name') {
			this.advance();
			// Post-increment/decrement
			if (this.current().type === 'DoublePlus') {
				this.advance();
				const val = Number.parseInt(this.state.env.get(tok.value) ?? '0', 10);
				this.state.env.set(tok.value, String((val + 1) | 0));
				return val;
			}
			if (this.current().type === 'DoubleMinus') {
				this.advance();
				const val = Number.parseInt(this.state.env.get(tok.value) ?? '0', 10);
				this.state.env.set(tok.value, String((val - 1) | 0));
				return val;
			}
			return Number.parseInt(this.state.env.get(tok.value) ?? '0', 10);
		}

		if (tok.type === 'LParen') {
			this.advance();
			const result = this.parseComma();
			this.expect('RParen');
			return result;
		}

		// Default: treat as 0
		return 0;
	}
}

/** Parse a number literal (decimal, hex, octal). */
function parseNumber(value: string): number {
	if (value.startsWith('0x') || value.startsWith('0X')) {
		return Number.parseInt(value, 16) | 0;
	}
	if (value.startsWith('0') && value.length > 1) {
		return Number.parseInt(value, 8) | 0;
	}
	return Number.parseInt(value, 10) | 0;
}

/**
 * Split a string on IFS characters.
 * Default IFS: space, tab, newline.
 */
export function splitOnIFS(value: string, state: ShellState): string[] {
	const ifs = state.env.has('IFS') ? (state.env.get('IFS') as string) : ' \t\n';

	// Empty IFS means no splitting
	if (ifs.length === 0) {
		return value.length > 0 ? [value] : [];
	}

	// Separate IFS into whitespace and non-whitespace characters
	const wsChars = new Set<string>();
	const nonWsChars = new Set<string>();

	for (let i = 0; i < ifs.length; i++) {
		const ch = ifs[i];
		if (ch === ' ' || ch === '\t' || ch === '\n') {
			wsChars.add(ch);
		} else {
			nonWsChars.add(ch);
		}
	}

	const fields: string[] = [];
	let current = '';
	let i = 0;

	// Skip leading IFS whitespace
	while (i < value.length && wsChars.has(value[i])) {
		i++;
	}

	while (i < value.length) {
		const ch = value[i];

		if (nonWsChars.has(ch)) {
			// Non-whitespace IFS char: delimit field
			fields.push(current);
			current = '';
			i++;
			// Skip trailing IFS whitespace after non-ws delimiter
			while (i < value.length && wsChars.has(value[i])) {
				i++;
			}
			continue;
		}

		if (wsChars.has(ch)) {
			// IFS whitespace: field separator
			if (current.length > 0) {
				fields.push(current);
				current = '';
			}
			// Skip consecutive IFS whitespace
			while (i < value.length && wsChars.has(value[i])) {
				i++;
			}
			continue;
		}

		current += ch;
		i++;
	}

	if (current.length > 0) {
		fields.push(current);
	}

	return fields;
}

/**
 * Expand glob patterns against the virtual filesystem.
 * If no match, returns the original pattern as a literal.
 */
function expandGlob(word: string, state: ShellState): string[] {
	// Check if the word contains unquoted glob characters
	if (!containsGlob(word)) {
		return [word];
	}

	try {
		const matches = matchGlobAgainstFs(word, state.fs, state.cwd);
		if (matches.length === 0) {
			return [word]; // No match: return literal pattern
		}
		matches.sort();
		return matches;
	} catch {
		return [word];
	}
}

/** Check if a string contains glob metacharacters. */
function containsGlob(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '*' || s[i] === '?' || s[i] === '[') {
			return true;
		}
	}
	return false;
}

/** Match a glob pattern against the virtual filesystem. */
function matchGlobAgainstFs(pattern: string, fs: FileSystem, cwd: string): string[] {
	// Resolve the directory to search
	const lastSlash = pattern.lastIndexOf('/');
	let dir: string;
	let filePattern: string;

	if (lastSlash >= 0) {
		dir = pattern.slice(0, lastSlash) || '/';
		filePattern = pattern.slice(lastSlash + 1);
		if (!dir.startsWith('/')) {
			dir = cwd === '/' ? `/${dir}` : `${cwd}/${dir}`;
		}
	} else {
		dir = cwd;
		filePattern = pattern;
	}

	if (!fs.exists(dir)) return [];

	try {
		const entries = fs.readdir(dir);
		const matches: string[] = [];

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			// Skip dotfiles unless pattern starts with .
			if (entry[0] === '.' && filePattern[0] !== '.') continue;

			if (globMatch(filePattern, entry)) {
				if (lastSlash >= 0) {
					matches.push(`${pattern.slice(0, lastSlash + 1)}${entry}`);
				} else {
					matches.push(entry);
				}
			}
		}

		return matches;
	} catch {
		return [];
	}
}
