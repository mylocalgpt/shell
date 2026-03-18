import type {
	ArithmeticCommand,
	ArithmeticExpansion,
	ArrayExpression,
	Assignment,
	BraceExpansion,
	BraceGroup,
	CaseItem,
	CaseStatement,
	CommandNode,
	CompoundCommand,
	ConditionalExpr,
	ConditionalExpression,
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
	VariableWord,
	WhileStatement,
	Word,
	WordPart,
} from './ast.js';
import { Lexer, type Token, type TokenType } from './lexer.js';

/**
 * Parse error with source position and context.
 */
export class ParseError extends Error {
	readonly pos: SourcePosition;
	readonly expected: string;
	readonly found: string;

	constructor(message: string, pos: SourcePosition, expected: string, found: string) {
		super(`${message} at line ${pos.line}, col ${pos.col}`);
		this.name = 'ParseError';
		this.pos = pos;
		this.expected = expected;
		this.found = found;
	}
}

/** Token types that indicate a list separator/terminator. */
function isListOperator(type: TokenType): boolean {
	return (
		type === 'DoubleAmp' ||
		type === 'DoublePipe' ||
		type === 'Semi' ||
		type === 'Amp' ||
		type === 'Newline'
	);
}

/** Token types that can start a compound command. */
function isCompoundKeyword(type: TokenType): boolean {
	return (
		type === 'If' ||
		type === 'For' ||
		type === 'While' ||
		type === 'Until' ||
		type === 'Case' ||
		type === 'DblLeftBracket' ||
		type === 'LeftParen' ||
		type === 'LeftBrace'
	);
}

/** Token types that indicate end of a list in various contexts. */
function isListTerminator(type: TokenType): boolean {
	return (
		type === 'EOF' ||
		type === 'RightParen' ||
		type === 'RightBrace' ||
		type === 'Then' ||
		type === 'Else' ||
		type === 'Elif' ||
		type === 'Fi' ||
		type === 'Do' ||
		type === 'Done' ||
		type === 'Esac' ||
		type === 'DblRightBracket' ||
		type === 'DoubleSemi' ||
		type === 'SemiAmp' ||
		type === 'DoubleSemiAmp'
	);
}

/** Check if a token type is a redirection operator. */
function isRedirectionOp(type: TokenType): boolean {
	return (
		type === 'Less' ||
		type === 'Great' ||
		type === 'DGreat' ||
		type === 'DLess' ||
		type === 'DLessDash' ||
		type === 'TLess' ||
		type === 'LessAnd' ||
		type === 'GreatAnd' ||
		type === 'AndGreat' ||
		type === 'Clobber'
	);
}

/** Check if a token is a word-like token (can be used as a command word). */
function isWordToken(type: TokenType): boolean {
	return type === 'Word' || type === 'AssignmentWord';
}

/**
 * Recursive descent parser for bash input.
 * Consumes tokens from a Lexer and produces an AST Program node.
 */
class Parser {
	private readonly lexer: Lexer;
	private current: Token;
	private readonly input: string;
	/** Buffer for lookahead tokens. */
	private readonly buffer: Token[] = [];

	constructor(input: string) {
		this.input = input;
		this.lexer = new Lexer(input);
		this.current = this.nextFromLexer();
	}

	/** Get the next non-comment token from the lexer. */
	private nextFromLexer(): Token {
		let tok = this.lexer.next();
		while (tok.type === 'Comment') {
			tok = this.lexer.next();
		}
		return tok;
	}

	/** Advance to the next non-comment token and return the previous one. */
	private advance(): Token {
		const prev = this.current;
		if (this.buffer.length > 0) {
			this.current = this.buffer.shift() as Token;
		} else {
			this.current = this.nextFromLexer();
		}
		return prev;
	}

	/** Peek at the token N positions ahead (0 = next token after current). */
	private peek(offset: number): Token {
		while (this.buffer.length <= offset) {
			this.buffer.push(this.nextFromLexer());
		}
		return this.buffer[offset];
	}

	/** Check if the current token matches the expected type. */
	private check(type: TokenType): boolean {
		return this.current.type === type;
	}

	/** Consume a token of the expected type, or throw a ParseError. */
	private expect(type: TokenType): Token {
		if (this.current.type !== type) {
			throw new ParseError(
				`Expected ${type} but found ${this.current.type} (${JSON.stringify(this.current.value)})`,
				this.current.pos,
				type,
				this.current.type,
			);
		}
		return this.advance();
	}

	/** Skip any newline tokens. */
	private skipNewlines(): void {
		while (this.current.type === 'Newline') {
			this.advance();
		}
	}

	/** Parse the entire input into a Program node. */
	parseProgram(): Program {
		const pos = this.current.pos;
		this.skipNewlines();
		const body = this.parseList();
		this.skipNewlines();
		if (this.current.type !== 'EOF') {
			throw new ParseError(
				`Unexpected token ${this.current.type} (${JSON.stringify(this.current.value)})`,
				this.current.pos,
				'EOF',
				this.current.type,
			);
		}
		return { type: 'Program', body, pos };
	}

	/**
	 * Parse a list of pipelines connected by &&, ||, ;, &, or newlines.
	 * Stops at list terminators (fi, done, esac, ), }, etc.).
	 */
	parseList(): List {
		const pos = this.current.pos;
		const entries: ListEntry[] = [];

		this.skipNewlines();

		// Empty list
		if (isListTerminator(this.current.type)) {
			return { type: 'List', entries, pos };
		}

		const pipeline = this.parsePipeline();

		// Determine the operator
		let operator: ListEntry['operator'] = '\n';

		if (this.check('DoubleAmp')) {
			operator = '&&';
			this.advance();
		} else if (this.check('DoublePipe')) {
			operator = '||';
			this.advance();
		} else if (this.check('Semi')) {
			operator = ';';
			this.advance();
		} else if (this.check('Amp')) {
			operator = '&';
			this.advance();
		} else if (this.check('Newline')) {
			operator = '\n';
			// Don't advance - the loop below handles newlines
		}

		entries.push({ pipeline, operator });

		// Continue parsing more pipelines
		while (true) {
			this.skipNewlines();

			if (isListTerminator(this.current.type)) {
				break;
			}

			// Need to check if we can parse another pipeline
			if (
				!isWordToken(this.current.type) &&
				!isCompoundKeyword(this.current.type) &&
				this.current.type !== 'Bang' &&
				this.current.type !== 'Function' &&
				!isRedirectionOp(this.current.type) &&
				this.current.type !== 'AssignmentWord'
			) {
				break;
			}

			const nextPipeline = this.parsePipeline();

			let nextOp: ListEntry['operator'] = '\n';
			if (this.check('DoubleAmp')) {
				nextOp = '&&';
				this.advance();
			} else if (this.check('DoublePipe')) {
				nextOp = '||';
				this.advance();
			} else if (this.check('Semi')) {
				nextOp = ';';
				this.advance();
			} else if (this.check('Amp')) {
				nextOp = '&';
				this.advance();
			}

			entries.push({ pipeline: nextPipeline, operator: nextOp });
		}

		return { type: 'List', entries, pos };
	}

	/** Parse a pipeline: [!] command [| command]* */
	parsePipeline(): Pipeline {
		const pos = this.current.pos;
		let negated = false;

		if (this.check('Bang')) {
			negated = true;
			this.advance();
		}

		const commands: CommandNode[] = [];
		commands.push(this.parseCommand());

		while (this.check('Pipe')) {
			this.advance();
			this.skipNewlines();
			commands.push(this.parseCommand());
		}

		return { type: 'Pipeline', commands, negated, pos };
	}

	/** Parse a command: compound, function def, or simple command. */
	parseCommand(): CommandNode {
		// Check for unsupported syntax
		if (this.check('Coproc')) {
			throw new ParseError(
				'coproc is not supported; use pipes or background processes instead',
				this.current.pos,
				'command',
				'coproc',
			);
		}
		if (this.check('Select')) {
			throw new ParseError(
				'select is not supported; use a for loop with a menu instead',
				this.current.pos,
				'command',
				'select',
			);
		}

		// Compound commands
		if (isCompoundKeyword(this.current.type)) {
			return this.parseCompoundCommand();
		}

		// function keyword
		if (this.check('Function')) {
			return this.parseFunctionDef();
		}

		// Simple command (may include function detection)
		return this.parseSimpleCommand();
	}

	/** Dispatch to the appropriate compound command parser. */
	parseCompoundCommand(): CommandNode {
		switch (this.current.type) {
			case 'If':
				return this.parseIfClause();
			case 'For':
				return this.parseForClause();
			case 'While':
				return this.parseWhileClause();
			case 'Until':
				return this.parseUntilClause();
			case 'Case':
				return this.parseCaseClause();
			case 'DblLeftBracket':
				return this.parseConditionalExpression();
			case 'LeftParen':
				if (this.peek(0).type === 'LeftParen') {
					return this.parseArithmeticCommand();
				}
				return this.parseSubshell();
			case 'LeftBrace':
				return this.parseBraceGroup();
			default:
				throw new ParseError(
					`Unexpected token ${this.current.type}`,
					this.current.pos,
					'compound command',
					this.current.type,
				);
		}
	}

	/** Parse a simple command: [assignments...] [words...] [redirections...] in any order. */
	parseSimpleCommand(): CommandNode {
		const pos = this.current.pos;
		const assignments: Assignment[] = [];
		const words: Word[] = [];
		const redirections: Redirection[] = [];

		// Detect function definition: WORD () { ... }
		if (
			isWordToken(this.current.type) &&
			this.current.type !== 'AssignmentWord' &&
			this.peek(0).type === 'LeftParen' &&
			this.peek(1).type === 'RightParen'
		) {
			return this.parseFunctionDefByName();
		}

		let seenWord = false;

		while (true) {
			// Redirections
			if (isRedirectionOp(this.current.type)) {
				redirections.push(this.parseRedirection(null));
				continue;
			}

			// FD number before redirection (e.g., 2>)
			if (
				isWordToken(this.current.type) &&
				isAllDigits(this.current.value) &&
				this.current.value.length <= 2 &&
				isRedirectionOp(this.peek(0).type)
			) {
				const fdStr = this.current.value;
				this.advance(); // consume the fd number
				redirections.push(this.parseRedirection(Number.parseInt(fdStr, 10)));
				continue;
			}

			// Assignment words (only before any regular words)
			if (this.current.type === 'AssignmentWord' && !seenWord) {
				assignments.push(this.parseAssignment());
				continue;
			}

			// Regular words
			if (isWordToken(this.current.type)) {
				words.push(this.parseWord());
				seenWord = true;
				continue;
			}

			// Reserved words used as command arguments (e.g., echo if)
			// When we've already seen a word, some reserved words can be arguments
			if (seenWord && isReservedWordUsableAsArg(this.current.type)) {
				words.push(this.makeWordFromToken());
				seenWord = true;
				continue;
			}

			break;
		}

		return {
			type: 'SimpleCommand',
			assignments,
			words,
			redirections,
			pos,
		};
	}

	/** Parse a variable assignment from an AssignmentWord token. */
	parseAssignment(): Assignment {
		const pos = this.current.pos;
		const token = this.expect('AssignmentWord');
		const value = token.value;

		// Parse: NAME=VALUE, NAME+=VALUE, NAME=, NAME=(array)
		let append = false;
		let eqIndex = value.indexOf('=');

		// Check for +=
		if (eqIndex > 0 && value[eqIndex - 1] === '+') {
			append = true;
			eqIndex = eqIndex - 1;
		}

		const name = value.slice(0, eqIndex);
		const rawValue = value.slice(append ? eqIndex + 2 : eqIndex + 1);

		// Check for array assignment: VAR=( ... )
		if (rawValue === '' && this.check('LeftParen')) {
			const arrayExpr = this.parseArrayLiteral();
			return {
				type: 'Assignment',
				name,
				value: arrayExpr,
				append,
				pos,
			};
		}

		let assignValue: Word | null = null;
		if (rawValue.length > 0) {
			assignValue = this.parseWordFromString(rawValue, pos);
		}

		return {
			type: 'Assignment',
			name,
			value: assignValue,
			append,
			pos,
		};
	}

	/** Parse an array literal: (word word word ...) */
	parseArrayLiteral(): ArrayExpression {
		const pos = this.current.pos;
		this.expect('LeftParen');
		const elements: Word[] = [];

		this.skipNewlines();
		while (!this.check('RightParen') && !this.check('EOF')) {
			elements.push(this.parseWord());
			this.skipNewlines();
		}

		this.expect('RightParen');
		return { type: 'ArrayExpression', elements, pos };
	}

	/** Parse if/elif/else/fi. */
	parseIfClause(): IfStatement {
		const pos = this.current.pos;
		this.expect('If');
		this.skipNewlines();

		const condition = this.parseList();
		this.skipNewlines();
		this.expect('Then');
		this.skipNewlines();

		const thenPart = this.parseList();

		const elifs: IfStatement['elifs'] = [];
		let elsePart: List | null = null;

		while (this.check('Elif')) {
			this.advance();
			this.skipNewlines();
			const elifCond = this.parseList();
			this.skipNewlines();
			this.expect('Then');
			this.skipNewlines();
			const elifThen = this.parseList();
			// biome-ignore lint/suspicious/noThenProperty: AST uses 'then' as a structural field
			elifs.push({ condition: elifCond, then: elifThen });
		}

		if (this.check('Else')) {
			this.advance();
			this.skipNewlines();
			elsePart = this.parseList();
		}

		this.skipNewlines();
		this.expect('Fi');

		const redirections = this.parseTrailingRedirections();

		const result: IfStatement = {
			type: 'IfStatement',
			condition,
			// biome-ignore lint/suspicious/noThenProperty: AST uses 'then' as a structural field
			then: thenPart,
			elifs,
			else: elsePart,
			redirections,
			pos,
		};
		return result;
	}

	/** Parse for loop (both for-in and C-style). */
	parseForClause(): ForStatement | ForCStatement {
		const pos = this.current.pos;
		this.expect('For');

		// Check for C-style: for (( ... ))
		if (this.check('LeftParen')) {
			return this.parseForCStyle(pos);
		}

		// for-in: for VAR [in WORD...] ; do LIST done
		const varToken = this.current;
		if (!isWordToken(varToken.type) && !isReservedWordToken(varToken.type)) {
			throw new ParseError(
				'Expected variable name after for',
				this.current.pos,
				'variable name',
				this.current.type,
			);
		}
		const variable = this.advance().value;

		this.skipNewlines();

		const words: Word[] = [];
		if (this.check('In')) {
			this.advance();
			while (
				!this.check('Semi') &&
				!this.check('Newline') &&
				!this.check('Do') &&
				!this.check('EOF')
			) {
				words.push(this.parseWord());
			}
		}

		// Consume separator
		if (this.check('Semi') || this.check('Newline')) {
			this.advance();
		}
		this.skipNewlines();

		this.expect('Do');
		this.skipNewlines();
		const body = this.parseList();
		this.skipNewlines();
		this.expect('Done');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'ForStatement',
			variable,
			words,
			body,
			redirections,
			pos,
		};
	}

	/** Parse C-style for: for (( init; test; update )) do LIST done */
	private parseForCStyle(pos: SourcePosition): ForCStatement {
		this.expect('LeftParen');
		this.expect('LeftParen');

		// Read init, test, update as raw expressions
		const init = this.readArithUntil(';');
		this.expect('Semi');
		const test = this.readArithUntil(';');
		this.expect('Semi');
		const update = this.readArithUntil(')');

		// Consume ))
		this.expect('RightParen');
		this.expect('RightParen');

		// Consume separator
		if (this.check('Semi') || this.check('Newline')) {
			this.advance();
		}
		this.skipNewlines();

		this.expect('Do');
		this.skipNewlines();
		const body = this.parseList();
		this.skipNewlines();
		this.expect('Done');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'ForCStatement',
			init: { type: 'ArithmeticExpansion', expression: init, pos },
			test: { type: 'ArithmeticExpansion', expression: test, pos },
			update: { type: 'ArithmeticExpansion', expression: update, pos },
			body,
			redirections,
			pos,
		};
	}

	/** Read raw text until a delimiter token is found (for C-style for). */
	private readArithUntil(delim: string): string {
		let result = '';
		while (this.current.value !== delim && this.current.type !== 'EOF') {
			if (result.length > 0) result += ' ';
			result += this.current.value;
			this.advance();
		}
		return result;
	}

	/** Parse while/do/done. */
	parseWhileClause(): WhileStatement {
		const pos = this.current.pos;
		this.expect('While');
		this.skipNewlines();

		const condition = this.parseList();
		this.skipNewlines();
		this.expect('Do');
		this.skipNewlines();
		const body = this.parseList();
		this.skipNewlines();
		this.expect('Done');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'WhileStatement',
			condition,
			body,
			redirections,
			pos,
		};
	}

	/** Parse until/do/done. */
	parseUntilClause(): UntilStatement {
		const pos = this.current.pos;
		this.expect('Until');
		this.skipNewlines();

		const condition = this.parseList();
		this.skipNewlines();
		this.expect('Do');
		this.skipNewlines();
		const body = this.parseList();
		this.skipNewlines();
		this.expect('Done');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'UntilStatement',
			condition,
			body,
			redirections,
			pos,
		};
	}

	/** Parse case/in/esac. */
	parseCaseClause(): CaseStatement {
		const pos = this.current.pos;
		this.expect('Case');

		const word = this.parseWord();

		this.skipNewlines();
		this.expect('In');
		this.skipNewlines();

		const items: CaseItem[] = [];

		while (!this.check('Esac') && !this.check('EOF')) {
			items.push(this.parseCaseItem());
			this.skipNewlines();
		}

		this.expect('Esac');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'CaseStatement',
			word,
			items,
			redirections,
			pos,
		};
	}

	/** Parse a single case item: pattern [| pattern]* ) list [;; | ;& | ;;&] */
	private parseCaseItem(): CaseItem {
		const pos = this.current.pos;
		const patterns: Word[] = [];

		// Optional leading (
		if (this.check('LeftParen')) {
			this.advance();
		}

		patterns.push(this.parseWord());

		while (this.check('Pipe')) {
			this.advance();
			patterns.push(this.parseWord());
		}

		this.expect('RightParen');
		this.skipNewlines();

		let body: List | null = null;
		let terminator: CaseItem['terminator'] = ';;';

		if (
			!this.check('DoubleSemi') &&
			!this.check('SemiAmp') &&
			!this.check('DoubleSemiAmp') &&
			!this.check('Esac')
		) {
			body = this.parseList();
		}

		if (this.check('DoubleSemi')) {
			terminator = ';;';
			this.advance();
		} else if (this.check('SemiAmp')) {
			terminator = ';&';
			this.advance();
		} else if (this.check('DoubleSemiAmp')) {
			terminator = ';;&';
			this.advance();
		}

		return { type: 'CaseItem', patterns, body, terminator, pos };
	}

	/** Parse [[ expression ]]. */
	parseConditionalExpression(): ConditionalExpression {
		const pos = this.current.pos;
		this.expect('DblLeftBracket');

		const expression = this.parseConditionalOr();

		this.expect('DblRightBracket');

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'ConditionalExpression',
			expression,
			redirections,
			pos,
		};
	}

	/** Parse conditional or: expr || expr */
	private parseConditionalOr(): ConditionalExpr {
		let left = this.parseConditionalAnd();

		while (this.check('DoublePipe')) {
			const pos = this.current.pos;
			this.advance();
			const right = this.parseConditionalAnd();
			left = { type: 'OrExpr', left, right, pos };
		}

		return left;
	}

	/** Parse conditional and: expr && expr */
	private parseConditionalAnd(): ConditionalExpr {
		let left = this.parseConditionalUnary();

		while (this.check('DoubleAmp')) {
			const pos = this.current.pos;
			this.advance();
			const right = this.parseConditionalUnary();
			left = { type: 'AndExpr', left, right, pos };
		}

		return left;
	}

	/** Parse unary conditional: ! expr, ( expr ), unary test, or binary test. */
	private parseConditionalUnary(): ConditionalExpr {
		const pos = this.current.pos;

		// ! negation
		if (this.check('Bang')) {
			this.advance();
			const expression = this.parseConditionalUnary();
			return { type: 'NotExpr', expression, pos };
		}

		// ( grouped expression )
		if (this.check('LeftParen')) {
			this.advance();
			const expression = this.parseConditionalOr();
			this.expect('RightParen');
			return { type: 'ParenExpr', expression, pos };
		}

		// Unary test: -f, -d, -z, -n, etc.
		if (
			isWordToken(this.current.type) &&
			this.current.value.length >= 2 &&
			this.current.value[0] === '-'
		) {
			const operator = this.advance().value;
			// Check if this is actually a unary operator
			// It could be a word like "-hello" that's the LHS of a binary test
			if (
				!this.check('DblRightBracket') &&
				!this.check('DoubleAmp') &&
				!this.check('DoublePipe') &&
				!this.check('RightParen')
			) {
				// The next token might be the operand of a unary test,
				// or this might be the LHS of a binary test.
				// Peek ahead: if the token after the next is a binary operator, it's binary.
				const nextWord = this.parseConditionalWord();

				// Check if the NEXT token is a binary operator
				if (this.isConditionalBinaryOp()) {
					// This was: -flag word OP rhs -> actually (-flag word) is not valid.
					// Re-interpret: operator is a unary test applied to nextWord
					// But actually we need to check if operator is a valid unary test flag
					if (isUnaryTestOp(operator)) {
						return { type: 'UnaryTest', operator, operand: nextWord, pos };
					}
					// Not a unary op, treat as left side of binary
					const left: Word = {
						type: 'LiteralWord',
						value: operator,
						pos,
					};
					const binOp = this.advance().value;
					const right = this.parseConditionalWord();
					return { type: 'BinaryTest', operator: binOp, left, right, pos };
				}

				return { type: 'UnaryTest', operator, operand: nextWord, pos };
			}

			// Standalone word at end - treat as unary -n test (test if non-empty)
			return {
				type: 'UnaryTest',
				operator: '-n',
				operand: { type: 'LiteralWord', value: operator, pos },
				pos,
			};
		}

		// Binary test or standalone word
		const left = this.parseConditionalWord();

		if (this.isConditionalBinaryOp()) {
			const operator = this.advance().value;
			const right = this.parseConditionalWord();
			return { type: 'BinaryTest', operator, left, right, pos };
		}

		// Standalone word - treat as implicit -n test
		return { type: 'UnaryTest', operator: '-n', operand: left, pos };
	}

	/** Check if current token is a conditional binary operator. */
	private isConditionalBinaryOp(): boolean {
		if (!isWordToken(this.current.type)) return false;
		const v = this.current.value;
		return (
			v === '==' ||
			v === '!=' ||
			v === '=~' ||
			v === '=' ||
			v === '<' ||
			v === '>' ||
			v === '-eq' ||
			v === '-ne' ||
			v === '-lt' ||
			v === '-le' ||
			v === '-gt' ||
			v === '-ge' ||
			v === '-nt' ||
			v === '-ot' ||
			v === '-ef'
		);
	}

	/** Parse a word inside [[ ]]. Inside conditional, < and > are comparison operators, not redirections. */
	private parseConditionalWord(): Word {
		// Handle < and > as word tokens inside [[
		if (this.check('Less') || this.check('Great')) {
			const pos = this.current.pos;
			const value = this.advance().value;
			return { type: 'LiteralWord', value, pos };
		}
		return this.parseWord();
	}

	/** Parse (( expression )) arithmetic command. */
	parseArithmeticCommand(): ArithmeticCommand {
		const pos = this.current.pos;
		this.expect('LeftParen'); // first (
		this.expect('LeftParen'); // second (

		// Collect everything until )) as the expression string
		let expression = '';
		let depth = 0;
		while (!this.check('EOF')) {
			if (this.check('RightParen') && this.peek(0).type === 'RightParen' && depth === 0) {
				break;
			}
			if (this.check('LeftParen')) depth++;
			if (this.check('RightParen')) depth--;
			// Collect token value with spacing
			if (expression.length > 0) expression += ' ';
			expression += this.current.value;
			this.advance();
		}

		this.expect('RightParen'); // first )
		this.expect('RightParen'); // second )

		const redirections = this.parseTrailingRedirections();

		return { type: 'ArithmeticCommand', expression, redirections, pos };
	}

	/** Parse ( list ). */
	parseSubshell(): Subshell {
		const pos = this.current.pos;
		this.expect('LeftParen');
		this.skipNewlines();

		const body = this.parseList();
		this.skipNewlines();

		this.expect('RightParen');

		const redirections = this.parseTrailingRedirections();

		return { type: 'Subshell', body, redirections, pos };
	}

	/** Parse { list; }. */
	parseBraceGroup(): BraceGroup {
		const pos = this.current.pos;
		this.expect('LeftBrace');
		this.skipNewlines();

		const body = this.parseList();
		this.skipNewlines();

		this.expect('RightBrace');

		const redirections = this.parseTrailingRedirections();

		return { type: 'BraceGroup', body, redirections, pos };
	}

	/**
	 * Parse a function definition.
	 * Handles: function WORD { body }, function WORD () { body }
	 */
	parseFunctionDef(): FunctionDefinition {
		const pos = this.current.pos;
		this.expect('Function');

		const name = this.current.value;
		this.advance();

		// Optional ()
		if (this.check('LeftParen')) {
			this.advance();
			this.expect('RightParen');
		}

		this.skipNewlines();
		const body = this.parseCompoundCommand();

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'FunctionDefinition',
			name,
			body: body as CompoundCommand,
			redirections,
			pos,
		};
	}

	/**
	 * Parse a function definition by name: WORD () compound-command
	 */
	private parseFunctionDefByName(): FunctionDefinition {
		const pos = this.current.pos;
		const name = this.advance().value;

		this.expect('LeftParen');
		this.expect('RightParen');

		this.skipNewlines();
		const body = this.parseCompoundCommand();

		const redirections = this.parseTrailingRedirections();

		return {
			type: 'FunctionDefinition',
			name,
			body: body as CompoundCommand,
			redirections,
			pos,
		};
	}

	/** Parse a redirection: [fd] operator word */
	parseRedirection(fd: number | null): Redirection {
		const pos = this.current.pos;
		const token = this.advance(); // redirection operator
		const operator = token.value;

		// For heredocs, the content is collected by the lexer
		if (token.type === 'DLess' || token.type === 'DLessDash') {
			const content = this.lexer.getHeredocContent(token) ?? '';
			const heredoc: HereDoc = {
				delimiter: 'EOF', // The actual delimiter is consumed by lexer
				content,
				quoted: false,
				stripTabs: token.type === 'DLessDash',
			};
			return {
				type: 'Redirection',
				operator,
				fd,
				target: { type: 'LiteralWord', value: '', pos },
				heredoc,
				pos,
			};
		}

		const target = this.parseWord();

		return {
			type: 'Redirection',
			operator,
			fd,
			target,
			heredoc: null,
			pos,
		};
	}

	/**
	 * Parse a word, handling quotes, expansions, and concatenation.
	 * Returns a single Word or ConcatWord if multiple parts are adjacent.
	 */
	parseWord(): Word {
		if (!isWordToken(this.current.type) && !isReservedWordUsableAsArg(this.current.type)) {
			throw new ParseError(
				`Expected word but found ${this.current.type} (${JSON.stringify(this.current.value)})`,
				this.current.pos,
				'word',
				this.current.type,
			);
		}

		const pos = this.current.pos;
		const token = this.advance();
		return this.parseWordFromString(token.value, pos);
	}

	/** Turn a raw token value string into a Word AST node. */
	parseWordFromString(raw: string, pos: SourcePosition): Word {
		const parts = this.parseWordParts(raw, pos);
		if (parts.length === 0) {
			return { type: 'LiteralWord', value: '', pos };
		}
		if (parts.length === 1) {
			return parts[0];
		}
		return { type: 'ConcatWord', parts, pos };
	}

	/** Parse a raw string into word parts (for the expansion engine). */
	private parseWordParts(raw: string, pos: SourcePosition): WordPart[] {
		const parts: WordPart[] = [];
		let i = 0;
		let literal = '';

		const flushLiteral = (): void => {
			if (literal.length > 0) {
				parts.push({ type: 'LiteralWord', value: literal, pos });
				literal = '';
			}
		};

		while (i < raw.length) {
			const ch = raw[i];

			// Tilde at start
			if (ch === '~' && i === 0 && parts.length === 0 && literal.length === 0) {
				flushLiteral();
				let suffix = '';
				i++;
				while (i < raw.length && raw[i] !== '/' && raw[i] !== ':') {
					suffix += raw[i];
					i++;
				}
				parts.push({ type: 'TildeWord', suffix, pos });
				continue;
			}

			// Single-quoted string
			if (ch === "'") {
				flushLiteral();
				i++; // skip opening '
				let content = '';
				while (i < raw.length && raw[i] !== "'") {
					content += raw[i];
					i++;
				}
				if (i < raw.length) i++; // skip closing '
				parts.push({
					type: 'QuotedWord',
					parts: [{ type: 'LiteralWord', value: content, pos }],
					quoteType: 'single',
					pos,
				});
				continue;
			}

			// ANSI-C quote: $'...'
			if (ch === '$' && i + 1 < raw.length && raw[i + 1] === "'") {
				flushLiteral();
				i += 2; // skip $'
				let content = '';
				while (i < raw.length && raw[i] !== "'") {
					if (raw[i] === '\\' && i + 1 < raw.length) {
						content += raw[i];
						content += raw[i + 1];
						i += 2;
					} else {
						content += raw[i];
						i++;
					}
				}
				if (i < raw.length) i++; // skip closing '
				parts.push({
					type: 'QuotedWord',
					parts: [{ type: 'LiteralWord', value: content, pos }],
					quoteType: 'ansi-c',
					pos,
				});
				continue;
			}

			// Double-quoted string
			if (ch === '"') {
				flushLiteral();
				i++; // skip opening "
				const innerParts: WordPart[] = [];
				let dqLiteral = '';

				const flushDqLiteral = (): void => {
					if (dqLiteral.length > 0) {
						innerParts.push({ type: 'LiteralWord', value: dqLiteral, pos });
						dqLiteral = '';
					}
				};

				while (i < raw.length && raw[i] !== '"') {
					if (raw[i] === '\\' && i + 1 < raw.length) {
						const next = raw[i + 1];
						if (next === '$' || next === '`' || next === '"' || next === '\\' || next === '\n') {
							dqLiteral += next;
							i += 2;
						} else {
							dqLiteral += raw[i];
							dqLiteral += raw[i + 1];
							i += 2;
						}
						continue;
					}
					if (raw[i] === '$') {
						flushDqLiteral();
						const result = this.parseDollarExpansion(raw, i, pos);
						innerParts.push(result.part);
						i = result.end;
						continue;
					}
					if (raw[i] === '`') {
						flushDqLiteral();
						const result = this.parseBacktickSubstitution(raw, i, pos);
						innerParts.push(result.part);
						i = result.end;
						continue;
					}
					dqLiteral += raw[i];
					i++;
				}
				flushDqLiteral();
				if (i < raw.length) i++; // skip closing "

				parts.push({
					type: 'QuotedWord',
					parts: innerParts,
					quoteType: 'double',
					pos,
				});
				continue;
			}

			// Dollar expansion outside quotes
			if (ch === '$') {
				flushLiteral();
				const result = this.parseDollarExpansion(raw, i, pos);
				parts.push(result.part);
				i = result.end;
				continue;
			}

			// Backtick command substitution
			if (ch === '`') {
				flushLiteral();
				const result = this.parseBacktickSubstitution(raw, i, pos);
				parts.push(result.part);
				i = result.end;
				continue;
			}

			// Glob characters
			if (ch === '*' || ch === '?') {
				flushLiteral();
				const pattern = ch;
				i++;
				parts.push({ type: 'GlobWord', pattern, pos });
				continue;
			}

			if (ch === '[') {
				flushLiteral();
				let pattern = ch;
				i++;
				while (i < raw.length && raw[i] !== ']') {
					pattern += raw[i];
					i++;
				}
				if (i < raw.length) {
					pattern += raw[i];
					i++;
				}
				parts.push({ type: 'GlobWord', pattern, pos });
				continue;
			}

			// Brace expansion
			if (ch === '{') {
				// Check if it looks like brace expansion (contains , or ..)
				const braceEnd = this.findBraceEnd(raw, i);
				if (braceEnd > i) {
					const braceContent = raw.slice(i + 1, braceEnd);
					if (braceContent.includes(',') || braceContent.includes('..')) {
						flushLiteral();
						parts.push(this.parseBraceExpansion(braceContent, pos));
						i = braceEnd + 1;
						continue;
					}
				}
				// Not brace expansion, treat as literal
				literal += ch;
				i++;
				continue;
			}

			// Escaped character
			if (ch === '\\' && i + 1 < raw.length) {
				literal += raw[i + 1];
				i += 2;
				continue;
			}

			// Regular character
			literal += ch;
			i++;
		}

		flushLiteral();
		return parts;
	}

	/** Parse a $-prefixed expansion from a raw string at position startIdx. */
	private parseDollarExpansion(
		raw: string,
		startIdx: number,
		pos: SourcePosition,
	): { part: WordPart; end: number } {
		let cursor = startIdx + 1; // skip $
		if (cursor >= raw.length) {
			return { part: { type: 'LiteralWord', value: '$', pos }, end: cursor };
		}

		const ch = raw[cursor];

		// $((arithmetic))
		if (ch === '(' && cursor + 1 < raw.length && raw[cursor + 1] === '(') {
			cursor += 2; // skip ((
			let depth = 1;
			let expr = '';
			while (cursor < raw.length && depth > 0) {
				if (raw[cursor] === '(' && cursor + 1 < raw.length && raw[cursor + 1] === '(') {
					depth++;
					expr += raw[cursor];
					expr += raw[cursor + 1];
					cursor += 2;
				} else if (raw[cursor] === ')' && cursor + 1 < raw.length && raw[cursor + 1] === ')') {
					depth--;
					if (depth > 0) {
						expr += raw[cursor];
						expr += raw[cursor + 1];
					}
					cursor += 2;
				} else {
					expr += raw[cursor];
					cursor++;
				}
			}
			return { part: { type: 'ArithmeticExpansion', expression: expr, pos }, end: cursor };
		}

		// $(command substitution)
		if (ch === '(') {
			cursor++; // skip (
			let depth = 1;
			let body = '';
			while (cursor < raw.length && depth > 0) {
				if (raw[cursor] === '(') depth++;
				else if (raw[cursor] === ')') depth--;
				if (depth > 0) {
					body += raw[cursor];
				}
				cursor++;
			}
			// Parse the body as a sub-program
			const subParser = new Parser(body);
			const program = subParser.parseProgram();
			return {
				part: { type: 'CommandSubstitution', body: program, backtick: false, pos },
				end: cursor,
			};
		}

		// ${parameter expansion}
		if (ch === '{') {
			cursor++; // skip {
			let depth = 1;
			let content = '';
			while (cursor < raw.length && depth > 0) {
				if (raw[cursor] === '{') depth++;
				else if (raw[cursor] === '}') depth--;
				if (depth > 0) {
					content += raw[cursor];
				}
				cursor++;
			}
			const varWord = this.parseParameterExpansion(content, pos);
			return { part: varWord, end: cursor };
		}

		// Special variables: $?, $@, $*, $#, $$, $!, $-, $_
		if ('?@*#$!-_'.includes(ch)) {
			return {
				part: {
					type: 'VariableWord',
					name: ch,
					operator: null,
					operand: null,
					indirect: false,
					length: false,
					pos,
				},
				end: cursor + 1,
			};
		}

		// Positional parameters: $0-$9
		if (ch >= '0' && ch <= '9') {
			return {
				part: {
					type: 'VariableWord',
					name: ch,
					operator: null,
					operand: null,
					indirect: false,
					length: false,
					pos,
				},
				end: cursor + 1,
			};
		}

		// $VAR
		if (isVarStartChar(ch)) {
			let name = '';
			while (cursor < raw.length && isVarChar(raw[cursor])) {
				name += raw[cursor];
				cursor++;
			}
			return {
				part: {
					type: 'VariableWord',
					name,
					operator: null,
					operand: null,
					indirect: false,
					length: false,
					pos,
				},
				end: cursor,
			};
		}

		// Lone $
		return { part: { type: 'LiteralWord', value: '$', pos }, end: cursor };
	}

	/** Parse ${...} parameter expansion content. */
	private parseParameterExpansion(content: string, pos: SourcePosition): VariableWord {
		let indirect = false;
		let length = false;
		let idx = 0;

		// ${#VAR} - length
		if (content[0] === '#' && content.length > 1 && content[1] !== '{') {
			length = true;
			idx = 1;
		}

		// ${!VAR} - indirect
		if (content[0] === '!' && content.length > 1) {
			indirect = true;
			idx = 1;
		}

		// Read the variable name
		let name = '';
		while (idx < content.length && isVarChar(content[idx])) {
			name += content[idx];
			idx++;
		}

		// Special variables in braces
		if (name.length === 0 && idx < content.length) {
			if ('?@*#$!-_'.includes(content[idx])) {
				name = content[idx];
				idx++;
			} else if (content[idx] >= '0' && content[idx] <= '9') {
				name = content[idx];
				idx++;
			}
		}

		// Array subscript: ${arr[index]}
		if (idx < content.length && content[idx] === '[') {
			idx++; // skip [
			let subscript = '';
			while (idx < content.length && content[idx] !== ']') {
				subscript += content[idx];
				idx++;
			}
			if (idx < content.length) idx++; // skip ]

			// Check for operator after subscript
			let operator: string | null = null;
			let operand: Word | null = null;
			if (idx < content.length) {
				const opResult = this.parseParamOperator(content, idx, pos);
				operator = opResult.operator;
				operand = opResult.operand;
			}

			return {
				type: 'VariableWord',
				name: `${name}[${subscript}]`,
				operator,
				operand,
				indirect,
				length,
				pos,
			};
		}

		// Check for parameter expansion operator
		let operator: string | null = null;
		let operand: Word | null = null;

		if (idx < content.length) {
			const opResult = this.parseParamOperator(content, idx, pos);
			operator = opResult.operator;
			operand = opResult.operand;
		}

		return {
			type: 'VariableWord',
			name,
			operator,
			operand,
			indirect,
			length,
			pos,
		};
	}

	/** Parse parameter expansion operator like :-, :+, :=, :?, //, %, %%, #, ## etc. */
	private parseParamOperator(
		content: string,
		startIdx: number,
		pos: SourcePosition,
	): { operator: string | null; operand: Word | null } {
		if (startIdx >= content.length) return { operator: null, operand: null };

		let operator = '';
		let cursor = startIdx;
		const ch = content[cursor];

		// :-, :+, :=, :?
		if (ch === ':' && cursor + 1 < content.length) {
			const next = content[cursor + 1];
			if (next === '-' || next === '+' || next === '=' || next === '?') {
				operator = `:${next}`;
				cursor += 2;
			} else {
				operator = ':';
				cursor++;
			}
		} else if (ch === '-' || ch === '+' || ch === '=' || ch === '?') {
			operator = ch;
			cursor++;
		} else if (ch === '/' && cursor + 1 < content.length && content[cursor + 1] === '/') {
			operator = '//';
			cursor += 2;
		} else if (ch === '/') {
			operator = '/';
			cursor++;
		} else if (ch === '%' && cursor + 1 < content.length && content[cursor + 1] === '%') {
			operator = '%%';
			cursor += 2;
		} else if (ch === '%') {
			operator = '%';
			cursor++;
		} else if (ch === '#' && cursor + 1 < content.length && content[cursor + 1] === '#') {
			operator = '##';
			cursor += 2;
		} else if (ch === '#') {
			operator = '#';
			cursor++;
		} else if (ch === '^' && cursor + 1 < content.length && content[cursor + 1] === '^') {
			operator = '^^';
			cursor += 2;
		} else if (ch === '^') {
			operator = '^';
			cursor++;
		} else if (ch === ',' && cursor + 1 < content.length && content[cursor + 1] === ',') {
			operator = ',,';
			cursor += 2;
		} else if (ch === ',') {
			operator = ',';
			cursor++;
		} else {
			return { operator: null, operand: null };
		}

		const remaining = content.slice(cursor);
		const operand = remaining.length > 0 ? this.parseWordFromString(remaining, pos) : null;

		return { operator, operand };
	}

	/** Parse a backtick command substitution from raw string. */
	private parseBacktickSubstitution(
		raw: string,
		startIdx: number,
		pos: SourcePosition,
	): { part: WordPart; end: number } {
		let cursor = startIdx + 1; // skip opening `
		let body = '';
		while (cursor < raw.length && raw[cursor] !== '`') {
			if (raw[cursor] === '\\' && cursor + 1 < raw.length) {
				body += raw[cursor + 1];
				cursor += 2;
			} else {
				body += raw[cursor];
				cursor++;
			}
		}
		if (cursor < raw.length) cursor++; // skip closing `

		const subParser = new Parser(body);
		const program = subParser.parseProgram();
		return {
			part: { type: 'CommandSubstitution', body: program, backtick: true, pos },
			end: cursor,
		};
	}

	/** Parse brace expansion content (between { and }). */
	private parseBraceExpansion(content: string, pos: SourcePosition): BraceExpansion {
		const parts: BraceExpansion['parts'] = [];

		// Check for range: {start..end[..incr]}
		const dotdot = content.indexOf('..');
		if (dotdot >= 0) {
			const start = content.slice(0, dotdot);
			const rest = content.slice(dotdot + 2);
			let end = rest;
			let incr: number | null = null;
			const secondDotDot = rest.indexOf('..');
			if (secondDotDot >= 0) {
				end = rest.slice(0, secondDotDot);
				const incrStr = rest.slice(secondDotDot + 2);
				incr = Number.parseInt(incrStr, 10);
				if (Number.isNaN(incr)) incr = null;
			}
			parts.push({ type: 'range', start, end, incr });
		} else {
			// Comma-separated list
			const items = this.splitBraceItems(content);
			const wordItems: Word[] = [];
			for (let j = 0; j < items.length; j++) {
				wordItems.push(this.parseWordFromString(items[j], pos));
			}
			parts.push({ type: 'list', items: wordItems });
		}

		return { type: 'BraceExpansion', parts, pos };
	}

	/** Split brace expansion content by commas, respecting nested braces. */
	private splitBraceItems(content: string): string[] {
		const items: string[] = [];
		let current = '';
		let depth = 0;

		for (let i = 0; i < content.length; i++) {
			const ch = content[i];
			if (ch === '{') {
				depth++;
				current += ch;
			} else if (ch === '}') {
				depth--;
				current += ch;
			} else if (ch === ',' && depth === 0) {
				items.push(current);
				current = '';
			} else {
				current += ch;
			}
		}
		items.push(current);
		return items;
	}

	/** Find the matching closing brace in a raw string. */
	private findBraceEnd(raw: string, start: number): number {
		let depth = 0;
		for (let i = start; i < raw.length; i++) {
			if (raw[i] === '{') depth++;
			else if (raw[i] === '}') {
				depth--;
				if (depth === 0) return i;
			}
		}
		return -1;
	}

	/** Parse any trailing redirections after a compound command. */
	private parseTrailingRedirections(): Redirection[] {
		const redirections: Redirection[] = [];
		while (isRedirectionOp(this.current.type)) {
			redirections.push(this.parseRedirection(null));
		}
		return redirections;
	}

	/** Create a Word from the current token (for reserved words used as args). */
	private makeWordFromToken(): Word {
		const pos = this.current.pos;
		const value = this.advance().value;
		return { type: 'LiteralWord', value, pos };
	}
}

/** Check if a character can start a variable name. */
function isVarStartChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** Check if a character can be in a variable name. */
function isVarChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122) ||
		(code >= 48 && code <= 57) ||
		code === 95
	);
}

/** Check if all characters in the string are digits. */
function isAllDigits(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code < 48 || code > 57) return false;
	}
	return s.length > 0;
}

/** Check if a token type is a reserved word that can be used as a command argument. */
function isReservedWordUsableAsArg(type: TokenType): boolean {
	return (
		type === 'If' ||
		type === 'Then' ||
		type === 'Else' ||
		type === 'Elif' ||
		type === 'Fi' ||
		type === 'For' ||
		type === 'While' ||
		type === 'Until' ||
		type === 'Do' ||
		type === 'Done' ||
		type === 'Case' ||
		type === 'Esac' ||
		type === 'In' ||
		type === 'Function' ||
		type === 'Select' ||
		type === 'Coproc'
	);
}

/** Check if a token type is a reserved word. */
function isReservedWordToken(type: TokenType): boolean {
	return (
		isReservedWordUsableAsArg(type) ||
		type === 'Bang' ||
		type === 'DblLeftBracket' ||
		type === 'DblRightBracket'
	);
}

/** Check if a string is a valid unary test operator. */
function isUnaryTestOp(op: string): boolean {
	return (
		op === '-f' ||
		op === '-d' ||
		op === '-e' ||
		op === '-r' ||
		op === '-w' ||
		op === '-x' ||
		op === '-s' ||
		op === '-z' ||
		op === '-n' ||
		op === '-L' ||
		op === '-h' ||
		op === '-p' ||
		op === '-S' ||
		op === '-b' ||
		op === '-c' ||
		op === '-t' ||
		op === '-O' ||
		op === '-G' ||
		op === '-N' ||
		op === '-a' ||
		op === '-o' ||
		op === '-k' ||
		op === '-u' ||
		op === '-g' ||
		op === '-v' ||
		op === '-R'
	);
}

/**
 * Parse a shell command string into an AST Program node.
 *
 * @param input - The shell command string to parse
 * @returns The AST Program node
 */
export function parse(input: string): Program {
	const parser = new Parser(input);
	return parser.parseProgram();
}
