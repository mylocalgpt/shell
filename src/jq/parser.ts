/**
 * Recursive descent parser for the jq filter language.
 *
 * Precedence (lowest to highest):
 *  1. Pipe (|)
 *  2. Comma (,)
 *  3. As binding (as $var)
 *  4. Alternative (//)
 *  5. Logic (and, or)
 *  6. Not (not) - prefix
 *  7. Comparison (==, !=, <, >, <=, >=)
 *  8. Addition (+, -)
 *  9. Multiplication (*, /, %)
 * 10. Unary (-)
 * 11. Postfix (?, .field, [index], .[])
 * 12. Primary (literals, identity, grouping, if, try, reduce, etc.)
 */

import type { BindingPattern, CondBranch, JqNode, ObjectEntry } from './ast.js';
import { JqParseError } from './errors.js';
import type { JqToken, JqTokenType } from './tokenizer.js';
import { tokenize } from './tokenizer.js';

// ---------------------------------------------------------------------------
// Parser state
// ---------------------------------------------------------------------------

class Parser {
	private readonly tokens: JqToken[];
	private pos = 0;

	constructor(tokens: JqToken[]) {
		this.tokens = tokens;
	}

	// -----------------------------------------------------------------------
	// Token helpers
	// -----------------------------------------------------------------------

	private current(): JqToken {
		return this.tokens[this.pos];
	}

	private peek(): JqTokenType {
		return this.current().type;
	}

	private advance(): JqToken {
		const t = this.current();
		if (t.type !== 'EOF') {
			this.pos++;
		}
		return t;
	}

	private expect(type: JqTokenType): JqToken {
		const t = this.current();
		if (t.type !== type) {
			this.error(`expected ${type}, got ${t.type} (${JSON.stringify(t.value)})`);
		}
		return this.advance();
	}

	private match(type: JqTokenType): boolean {
		if (this.peek() === type) {
			this.advance();
			return true;
		}
		return false;
	}

	private error(msg: string): never {
		const t = this.current();
		throw new JqParseError(msg, t.position);
	}

	// -----------------------------------------------------------------------
	// Grammar productions
	// -----------------------------------------------------------------------

	/** Entry point: parse the entire filter. */
	parse(): JqNode {
		const node = this.parsePipe();
		if (this.peek() !== 'EOF') {
			this.error(
				`unexpected token: ${this.current().type} (${JSON.stringify(this.current().value)})`,
			);
		}
		return node;
	}

	/** pipe = comma ('|' comma)* */
	private parsePipe(): JqNode {
		let left = this.parseComma();
		while (this.peek() === 'Pipe') {
			this.advance();
			const right = this.parseComma();
			left = { type: 'Pipe', left, right };
		}
		return left;
	}

	/** comma = assign (',' assign)* */
	private parseComma(): JqNode {
		let left = this.parseAssign();
		while (this.peek() === 'Comma') {
			this.advance();
			const right = this.parseAssign();
			left = { type: 'Comma', left, right };
		}
		return left;
	}

	/** assign = asBinding (('|=' | '+=' | '-=' | '*=' | '/=' | '%=' | '//=') asBinding)* */
	private parseAssign(): JqNode {
		let left = this.parseAsBinding();
		for (;;) {
			const t = this.peek();
			if (t === 'UpdatePipe') {
				this.advance();
				const right = this.parseAsBinding();
				left = { type: 'Update', path: left, value: right };
			} else if (
				t === 'PlusAssign' ||
				t === 'MinusAssign' ||
				t === 'StarAssign' ||
				t === 'SlashAssign' ||
				t === 'PercentAssign' ||
				t === 'AltAssign'
			) {
				const op = this.advance().value as '+=' | '-=' | '*=' | '/=' | '%=' | '//=';
				const right = this.parseAsBinding();
				left = { type: 'UpdateOp', op, path: left, value: right };
			} else {
				break;
			}
		}
		return left;
	}

	/** asBinding = alternative ('as' pattern '|' pipe)? */
	private parseAsBinding(): JqNode {
		const expr = this.parseAlternative();
		if (this.peek() === 'As') {
			this.advance(); // consume 'as'
			const pattern = this.parseBindingPattern();
			this.expect('Pipe');
			const body = this.parsePipe();
			return { type: 'VariableBinding', expr, pattern, body };
		}
		return expr;
	}

	/** Parse a binding pattern: $var, [$a, $b], {key: $var} */
	private parseBindingPattern(): BindingPattern {
		if (this.peek() === 'Variable') {
			const name = this.advance().value;
			return { kind: 'variable', name };
		}
		if (this.peek() === 'LBracket') {
			this.advance();
			const elements: BindingPattern[] = [];
			while (this.peek() !== 'RBracket') {
				if (elements.length > 0) {
					this.expect('Comma');
				}
				elements.push(this.parseBindingPattern());
			}
			this.expect('RBracket');
			return { kind: 'array', elements };
		}
		if (this.peek() === 'LBrace') {
			this.advance();
			const entries: { key: string; pattern: BindingPattern }[] = [];
			while (this.peek() !== 'RBrace') {
				if (entries.length > 0) {
					this.expect('Comma');
				}
				const key = this.expect('Ident').value;
				this.expect('Colon');
				const pattern = this.parseBindingPattern();
				entries.push({ key, pattern });
			}
			this.expect('RBrace');
			return { kind: 'object', entries };
		}
		this.error('expected variable, array pattern, or object pattern');
	}

	/** alternative = logic ('//' logic)* */
	private parseAlternative(): JqNode {
		let left = this.parseLogic();
		while (this.peek() === 'Alt') {
			this.advance();
			const right = this.parseLogic();
			left = { type: 'Alternative', left, right };
		}
		return left;
	}

	/** logic = notExpr (('and' | 'or') notExpr)* */
	private parseLogic(): JqNode {
		let left = this.parseNotExpr();
		while (this.peek() === 'And' || this.peek() === 'Or') {
			const op = this.advance().value as 'and' | 'or';
			const right = this.parseNotExpr();
			left = { type: 'Logic', op, left, right };
		}
		return left;
	}

	/** notExpr = 'not' notExpr | comparison -- jq `not` is actually postfix but we handle it here */
	private parseNotExpr(): JqNode {
		// In jq, `not` is actually a postfix/builtin but we parse it as part of comparisons
		return this.parseComparison();
	}

	/** comparison = addition (('==' | '!=' | '<' | '>' | '<=' | '>=') addition)? */
	private parseComparison(): JqNode {
		let left = this.parseAddition();
		const t = this.peek();
		if (t === 'Eq' || t === 'Neq' || t === 'Lt' || t === 'Gt' || t === 'Le' || t === 'Ge') {
			const op = this.advance().value as '==' | '!=' | '<' | '>' | '<=' | '>=';
			const right = this.parseAddition();
			left = { type: 'Comparison', op, left, right };
		}
		return left;
	}

	/** addition = multiplication (('+' | '-') multiplication)* */
	private parseAddition(): JqNode {
		let left = this.parseMultiplication();
		while (this.peek() === 'Plus' || this.peek() === 'Minus') {
			const op = this.advance().value as '+' | '-';
			const right = this.parseMultiplication();
			left = { type: 'Arithmetic', op, left, right };
		}
		return left;
	}

	/** multiplication = unary (('*' | '/' | '%') unary)* */
	private parseMultiplication(): JqNode {
		let left = this.parseUnary();
		while (this.peek() === 'Star' || this.peek() === 'Slash' || this.peek() === 'Percent') {
			const op = this.advance().value as '*' | '/' | '%';
			const right = this.parseUnary();
			left = { type: 'Arithmetic', op, left, right };
		}
		return left;
	}

	/** unary = '-' unary | postfix */
	private parseUnary(): JqNode {
		if (this.peek() === 'Minus') {
			this.advance();
			const expr = this.parseUnary();
			return { type: 'Negate', expr };
		}
		return this.parsePostfix();
	}

	/** postfix = primary ('?' | '.' IDENT | '.' STRING | '[' slice ']' | '.[]')* */
	private parsePostfix(): JqNode {
		let node = this.parsePrimary();

		for (;;) {
			if (this.peek() === 'Question') {
				this.advance();
				node = { type: 'Optional', expr: node };
				continue;
			}

			if (this.peek() === 'Dot') {
				// Check if this is field access (.name) or just a standalone dot
				// We need to disambiguate: postfix field access vs pipe + identity
				const nextPos = this.pos + 1;
				if (nextPos < this.tokens.length) {
					const nextType = this.tokens[nextPos].type;
					if (nextType === 'Ident') {
						this.advance(); // consume dot
						const name = this.advance().value;
						node = { type: 'Pipe', left: node, right: { type: 'Field', name } };
						continue;
					}
					if (nextType === 'String') {
						this.advance(); // consume dot
						const name = this.advance().value;
						node = { type: 'Pipe', left: node, right: { type: 'Field', name } };
						continue;
					}
				}
				// Not a postfix field access, break out
				break;
			}

			if (this.peek() === 'LBracket') {
				this.advance(); // consume [
				if (this.peek() === 'RBracket') {
					// .[]
					this.advance();
					node = { type: 'Pipe', left: node, right: { type: 'Iterate' } };
					continue;
				}

				// Check for slice
				const sliceResult = this.tryParseSlice();
				if (sliceResult !== null) {
					node = { type: 'Pipe', left: node, right: sliceResult };
					continue;
				}

				// Regular index
				const idx = this.parsePipe();
				this.expect('RBracket');
				node = { type: 'Pipe', left: node, right: { type: 'Index', index: idx } };
				continue;
			}

			break;
		}

		return node;
	}

	/** Try to parse a slice expression [start:end]. Returns null if not a slice. */
	private tryParseSlice(): JqNode | null {
		const save = this.pos;

		// [:end]
		if (this.peek() === 'Colon') {
			this.advance();
			const to = this.parsePipe();
			this.expect('RBracket');
			return { type: 'Slice', from: null, to };
		}

		// [start:end] or [start:]
		const from = this.parsePipe();
		if (this.peek() === 'Colon') {
			this.advance();
			if (this.peek() === 'RBracket') {
				this.advance();
				return { type: 'Slice', from, to: null };
			}
			const to = this.parsePipe();
			this.expect('RBracket');
			return { type: 'Slice', from, to };
		}

		// Not a slice, restore
		this.pos = save;
		return null;
	}

	/** primary = literal | identity | recursiveDescent | grouping | array | object | if | try | reduce | foreach | label | def | funcCall | variable | format | string */
	private parsePrimary(): JqNode {
		const t = this.peek();

		// Identity: .
		if (t === 'Dot') {
			this.advance();
			// Check for .field
			if (this.peek() === 'Ident') {
				const name = this.advance().value;
				return { type: 'Field', name };
			}
			if (this.peek() === 'String') {
				const name = this.advance().value;
				return { type: 'Field', name };
			}
			// Check for .[
			if (this.peek() === 'LBracket') {
				this.advance(); // consume [
				if (this.peek() === 'RBracket') {
					this.advance();
					return { type: 'Iterate' };
				}
				// Slice?
				const sliceResult = this.tryParseSlice();
				if (sliceResult !== null) {
					return sliceResult;
				}
				// Index
				const idx = this.parsePipe();
				this.expect('RBracket');
				return { type: 'Index', index: idx };
			}
			return { type: 'Identity' };
		}

		// Recursive descent: ..
		if (t === 'DotDot') {
			this.advance();
			return { type: 'RecursiveDescent' };
		}

		// Number
		if (t === 'Number') {
			const val = this.advance().value;
			return { type: 'Literal', value: Number(val) };
		}

		// String (non-interpolated)
		if (t === 'String') {
			const val = this.advance().value;
			return { type: 'Literal', value: val };
		}

		// Interpolated string
		if (t === 'StringStart') {
			return this.parseInterpolatedString();
		}

		// Variable
		if (t === 'Variable') {
			const name = this.advance().value;
			return { type: 'Variable', name };
		}

		// Format string
		if (t === 'Format') {
			const name = this.advance().value;
			// Check for format with string argument
			let str: JqNode | null = null;
			if (this.peek() === 'String') {
				str = { type: 'Literal', value: this.advance().value };
			} else if (this.peek() === 'StringStart') {
				str = this.parseInterpolatedString();
			}
			return { type: 'Format', name, str };
		}

		// Grouping
		if (t === 'LParen') {
			this.advance();
			const expr = this.parsePipe();
			this.expect('RParen');
			return expr;
		}

		// Array construction
		if (t === 'LBracket') {
			this.advance();
			if (this.peek() === 'RBracket') {
				this.advance();
				return { type: 'ArrayConstruction', expr: null };
			}
			const expr = this.parsePipe();
			this.expect('RBracket');
			return { type: 'ArrayConstruction', expr };
		}

		// Object construction
		if (t === 'LBrace') {
			return this.parseObjectConstruction();
		}

		// If/then/elif/else/end
		if (t === 'If') {
			return this.parseIf();
		}

		// Try/catch
		if (t === 'Try') {
			return this.parseTryCatch();
		}

		// Reduce
		if (t === 'Reduce') {
			return this.parseReduce();
		}

		// Foreach
		if (t === 'Foreach') {
			return this.parseForeach();
		}

		// Label
		if (t === 'Label') {
			return this.parseLabel();
		}

		// Break
		if (t === 'Break') {
			this.advance();
			const name = this.expect('Variable').value;
			return { type: 'Break', name };
		}

		// Def
		if (t === 'Def') {
			return this.parseDef();
		}

		// Import/include - not supported
		if (t === 'Import' || t === 'Include') {
			this.error('import/include not supported - define functions inline with def');
		}

		// `not` keyword used as a function
		if (t === 'Not') {
			this.advance();
			return { type: 'FunctionCall', name: 'not', args: [] };
		}

		// Identifiers: true, false, null, or function call
		if (t === 'Ident') {
			const name = this.advance().value;

			// Literal keywords
			if (name === 'true') return { type: 'Literal', value: true };
			if (name === 'false') return { type: 'Literal', value: false };
			if (name === 'null') return { type: 'Literal', value: null };

			// `not` as a builtin/postfix
			if (name === 'not') {
				return { type: 'FunctionCall', name: 'not', args: [] };
			}

			// Function call with arguments
			if (this.peek() === 'LParen') {
				this.advance(); // consume (
				const args: JqNode[] = [];
				if (this.peek() !== 'RParen') {
					args.push(this.parsePipe());
					while (this.peek() === 'Semicolon') {
						this.advance();
						args.push(this.parsePipe());
					}
				}
				this.expect('RParen');
				return { type: 'FunctionCall', name, args };
			}

			// Simple function call (no args)
			return { type: 'FunctionCall', name, args: [] };
		}

		this.error(`unexpected token: ${t} (${JSON.stringify(this.current().value)})`);
	}

	/** Parse an interpolated string: StringStart (StringFragment StringInterp expr RParen)* StringFragment StringEnd */
	private parseInterpolatedString(): JqNode {
		this.expect('StringStart');
		const parts: JqNode[] = [];

		for (;;) {
			// Read string fragment
			if (this.peek() === 'StringFragment') {
				const val = this.advance().value;
				parts.push({ type: 'Literal', value: val });
			}

			if (this.peek() === 'StringEnd') {
				this.advance();
				break;
			}

			if (this.peek() === 'StringInterp') {
				this.advance(); // consume \( marker
				const expr = this.parsePipe();
				this.expect('RParen');
				parts.push(expr);
				continue;
			}

			this.error('unexpected token in string interpolation');
		}

		// Optimize: if only one literal part, return it as a plain literal
		if (parts.length === 1 && parts[0].type === 'Literal' && typeof parts[0].value === 'string') {
			return parts[0];
		}

		return { type: 'StringInterpolation', parts };
	}

	/** Parse object construction: { entries } */
	private parseObjectConstruction(): JqNode {
		this.expect('LBrace');
		const entries: ObjectEntry[] = [];

		while (this.peek() !== 'RBrace') {
			if (entries.length > 0) {
				this.expect('Comma');
			}
			entries.push(this.parseObjectEntry());
		}

		this.expect('RBrace');
		return { type: 'ObjectConstruction', entries };
	}

	/** Parse a single object entry: key:value or shorthand */
	private parseObjectEntry(): ObjectEntry {
		// Computed key: (expr)
		if (this.peek() === 'LParen') {
			this.advance();
			const key = this.parsePipe();
			this.expect('RParen');
			this.expect('Colon');
			const value = this.parseAssign();
			return { key, value, computed: true };
		}

		// @format key
		if (this.peek() === 'Format') {
			const name = this.advance().value;
			const key: JqNode = { type: 'Literal', value: `@${name}` };
			// Check for value
			if (this.peek() === 'Colon') {
				this.advance();
				const value = this.parseAssign();
				return { key, value, computed: false };
			}
			return { key, value: null, computed: false };
		}

		// Variable key: $var (shorthand for ($var): $var)
		if (this.peek() === 'Variable') {
			const name = this.advance().value;
			const key: JqNode = { type: 'Literal', value: `$${name}` };
			if (this.peek() === 'Colon') {
				this.advance();
				const value = this.parseAssign();
				return { key, value, computed: false };
			}
			// Shorthand: {$var} -> {"$var": $var}  -- actually in jq this is {($var): $var} when $var is a string
			return { key: { type: 'Variable', name }, value: { type: 'Variable', name }, computed: true };
		}

		// String key
		if (this.peek() === 'String') {
			const val = this.advance().value;
			const key: JqNode = { type: 'Literal', value: val };
			if (this.peek() === 'Colon') {
				this.advance();
				const value = this.parseAssign();
				return { key, value, computed: false };
			}
			// Shorthand: {"name"} is {name: .name}
			return { key, value: { type: 'Field', name: val }, computed: false };
		}

		// Identifier key
		if (this.peek() === 'Ident') {
			const name = this.advance().value;
			const key: JqNode = { type: 'Literal', value: name };
			if (this.peek() === 'Colon') {
				this.advance();
				const value = this.parseAssign();
				return { key, value, computed: false };
			}
			// Shorthand: {name} is {name: .name}
			return { key, value: { type: 'Field', name }, computed: false };
		}

		// Interpolated string key
		if (this.peek() === 'StringStart') {
			const key = this.parseInterpolatedString();
			if (this.peek() === 'Colon') {
				this.advance();
				const value = this.parseAssign();
				return { key, value, computed: true };
			}
			return { key, value: null, computed: true };
		}

		this.error('expected object key');
	}

	/** Parse if/then/elif/else/end */
	private parseIf(): JqNode {
		this.expect('If');
		const condition = this.parsePipe();
		this.expect('Then');
		const thenBranch = this.parsePipe();

		const elifs: CondBranch[] = [];
		while (this.peek() === 'Elif') {
			this.advance();
			const elifCond = this.parsePipe();
			this.expect('Then');
			const elifBody = this.parsePipe();
			elifs.push({ condition: elifCond, body: elifBody });
		}

		let elseBranch: JqNode | null = null;
		if (this.peek() === 'Else') {
			this.advance();
			elseBranch = this.parsePipe();
		}

		this.expect('End');
		const result: JqNode = {
			type: 'If',
			condition,
			// biome-ignore lint/suspicious/noThenProperty: `then` is a field in the If AST node
			then: thenBranch,
			elifs,
			else: elseBranch,
		};
		return result;
	}

	/** Parse try/catch */
	private parseTryCatch(): JqNode {
		this.expect('Try');
		const expr = this.parsePostfix();
		let catchExpr: JqNode | null = null;
		if (this.peek() === 'Catch') {
			this.advance();
			catchExpr = this.parsePostfix();
		}
		return { type: 'TryCatch', expr, catch: catchExpr };
	}

	/** Parse reduce: reduce expr as $var (init; update) */
	private parseReduce(): JqNode {
		this.expect('Reduce');
		const expr = this.parsePostfix();
		this.expect('As');
		const variable = this.expect('Variable').value;
		this.expect('LParen');
		const init = this.parsePipe();
		this.expect('Semicolon');
		const update = this.parsePipe();
		this.expect('RParen');
		return { type: 'Reduce', expr, variable, init, update };
	}

	/** Parse foreach: foreach expr as $var (init; update; extract?) */
	private parseForeach(): JqNode {
		this.expect('Foreach');
		const expr = this.parsePostfix();
		this.expect('As');
		const variable = this.expect('Variable').value;
		this.expect('LParen');
		const init = this.parsePipe();
		this.expect('Semicolon');
		const update = this.parsePipe();
		let extract: JqNode | null = null;
		if (this.peek() === 'Semicolon') {
			this.advance();
			extract = this.parsePipe();
		}
		this.expect('RParen');
		return { type: 'Foreach', expr, variable, init, update, extract };
	}

	/** Parse label: label $name | body */
	private parseLabel(): JqNode {
		this.expect('Label');
		const name = this.expect('Variable').value;
		this.expect('Pipe');
		const body = this.parsePipe();
		return { type: 'Label', name, body };
	}

	/** Parse def: def name(params): body; next */
	private parseDef(): JqNode {
		this.expect('Def');
		const name = this.expect('Ident').value;
		const params: string[] = [];

		if (this.peek() === 'LParen') {
			this.advance();
			if (this.peek() !== 'RParen') {
				params.push(this.expect('Ident').value);
				while (this.peek() === 'Semicolon') {
					this.advance();
					params.push(this.expect('Ident').value);
				}
			}
			this.expect('RParen');
		}

		this.expect('Colon');
		const body = this.parsePipe();
		this.expect('Semicolon');
		const next = this.parsePipe();
		return { type: 'FunctionDef', name, params, body, next };
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a jq filter string into an AST.
 *
 * @param source - The jq filter to parse
 * @returns The root AST node
 * @throws JqParseError on syntax errors
 */
export function parseJq(source: string): JqNode {
	const tokens = tokenize(source);
	const parser = new Parser(tokens);
	return parser.parse();
}
