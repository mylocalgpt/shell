import type { SourcePosition } from './ast.js';

/** All token types produced by the lexer. */
export type TokenType =
	// Words
	| 'Word'
	| 'AssignmentWord'
	// Structure
	| 'Newline'
	| 'Semi'
	| 'DoubleSemi'
	| 'SemiAmp'
	| 'DoubleSemiAmp'
	| 'Amp'
	| 'DoubleAmp'
	| 'Pipe'
	| 'DoublePipe'
	| 'LeftParen'
	| 'RightParen'
	| 'LeftBrace'
	| 'RightBrace'
	| 'Bang'
	// Redirections
	| 'Less'
	| 'Great'
	| 'DGreat'
	| 'DLess'
	| 'DLessDash'
	| 'TLess'
	| 'LessAnd'
	| 'GreatAnd'
	| 'AndGreat'
	| 'Clobber'
	// Reserved words
	| 'If'
	| 'Then'
	| 'Else'
	| 'Elif'
	| 'Fi'
	| 'For'
	| 'While'
	| 'Until'
	| 'Do'
	| 'Done'
	| 'Case'
	| 'Esac'
	| 'In'
	| 'Function'
	| 'Select'
	| 'Coproc'
	| 'DblLeftBracket'
	| 'DblRightBracket'
	// Other
	| 'Comment'
	| 'EOF';

/** A single token produced by the lexer. */
export interface Token {
	type: TokenType;
	value: string;
	pos: SourcePosition;
}

/** Map of reserved words to their token types. */
const RESERVED_WORDS: Map<string, TokenType> = new Map([
	['if', 'If'],
	['then', 'Then'],
	['else', 'Else'],
	['elif', 'Elif'],
	['fi', 'Fi'],
	['for', 'For'],
	['while', 'While'],
	['until', 'Until'],
	['do', 'Do'],
	['done', 'Done'],
	['case', 'Case'],
	['esac', 'Esac'],
	['in', 'In'],
	['function', 'Function'],
	['select', 'Select'],
	['coproc', 'Coproc'],
	['!', 'Bang'],
	['[[', 'DblLeftBracket'],
	[']]', 'DblRightBracket'],
]);

/** Check if a char is whitespace but not a newline. */
function isBlank(ch: string): boolean {
	return ch === ' ' || ch === '\t';
}

/** Check if a character is a metacharacter that breaks a word. */
function isMeta(ch: string): boolean {
	return (
		ch === ' ' ||
		ch === '\t' ||
		ch === '\n' ||
		ch === '|' ||
		ch === '&' ||
		ch === ';' ||
		ch === '(' ||
		ch === ')' ||
		ch === '<' ||
		ch === '>' ||
		ch === '#'
	);
}

/** Check if char is a digit. */
function isDigit(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code >= 48 && code <= 57;
}

/** Error class for lexer errors with position info. */
export class LexerError extends Error {
	readonly pos: SourcePosition;

	constructor(message: string, pos: SourcePosition) {
		super(`${message} at line ${pos.line}, col ${pos.col}`);
		this.name = 'LexerError';
		this.pos = pos;
	}
}

/** Pending heredoc to be collected after the current line. */
interface PendingHeredoc {
	delimiter: string;
	quoted: boolean;
	stripTabs: boolean;
	token: Token;
}

/**
 * Context-sensitive lexer for bash input.
 * Produces tokens on demand via the next() method.
 */
export class Lexer {
	private readonly input: string;
	private pos: number;
	private line: number;
	private col: number;

	/** Heredocs waiting to be collected after the current logical line. */
	private pendingHeredocs: PendingHeredoc[];
	/** Collected heredoc content, indexed by the token reference. */
	private heredocContent: Map<Token, string>;

	/** Whether we are at a position that can accept reserved words. */
	private reservedWordAllowed: boolean;

	/** Whether we are at the start of a simple command (for assignment detection). */
	private commandStart: boolean;

	constructor(input: string) {
		this.input = input;
		this.pos = 0;
		this.line = 1;
		this.col = 1;
		this.pendingHeredocs = [];
		this.heredocContent = new Map();
		this.reservedWordAllowed = true;
		this.commandStart = true;
	}

	/** Get the heredoc content associated with a token. */
	getHeredocContent(token: Token): string | undefined {
		return this.heredocContent.get(token);
	}

	/** Current source position. */
	private currentPos(): SourcePosition {
		return { line: this.line, col: this.col };
	}

	/** Peek the current character without advancing. */
	private peek(): string {
		if (this.pos >= this.input.length) return '';
		return this.input[this.pos];
	}

	/** Peek ahead by offset characters. */
	private peekAt(offset: number): string {
		const idx = this.pos + offset;
		if (idx >= this.input.length) return '';
		return this.input[idx];
	}

	/** Advance by one character and return it. */
	private advance(): string {
		if (this.pos >= this.input.length) return '';
		const ch = this.input[this.pos];
		this.pos++;
		if (ch === '\n') {
			this.line++;
			this.col = 1;
		} else {
			this.col++;
		}
		return ch;
	}

	/** Skip whitespace (spaces and tabs, not newlines). */
	private skipBlanks(): void {
		while (this.pos < this.input.length && isBlank(this.input[this.pos])) {
			this.advance();
		}
	}

	/**
	 * Return the next token from the input.
	 */
	next(): Token {
		this.skipBlanks();

		if (this.pos >= this.input.length) {
			return { type: 'EOF', value: '', pos: this.currentPos() };
		}

		const ch = this.peek();

		// Newline
		if (ch === '\n') {
			const pos = this.currentPos();
			this.advance();
			this.collectPendingHeredocs();
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'Newline', value: '\n', pos };
		}

		// Comment
		if (ch === '#') {
			return this.scanComment();
		}

		// Operators and structure
		if (ch === '|' || ch === '&' || ch === ';' || ch === '(' || ch === ')') {
			return this.scanOperator();
		}

		// Redirections and heredocs
		if (ch === '<' || ch === '>') {
			return this.scanRedirection();
		}

		// Words (including quoted, expansions, etc.)
		// Note: } is handled inside scanWord - it becomes RightBrace when
		// standalone (braceDepth=0), and is included in the word during
		// brace expansion (braceDepth>0).
		return this.scanWord();
	}

	/** Scan a comment from # to end of line. */
	private scanComment(): Token {
		const pos = this.currentPos();
		let value = '';
		while (this.pos < this.input.length && this.peek() !== '\n') {
			value += this.advance();
		}
		return { type: 'Comment', value, pos };
	}

	/** Scan structural operators: | || & && ; ;; ( ) */
	private scanOperator(): Token {
		const pos = this.currentPos();
		const ch = this.advance();

		if (ch === '|') {
			if (this.peek() === '|') {
				this.advance();
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'DoublePipe', value: '||', pos };
			}
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'Pipe', value: '|', pos };
		}

		if (ch === '&') {
			if (this.peek() === '&') {
				this.advance();
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'DoubleAmp', value: '&&', pos };
			}
			if (this.peek() === '>') {
				this.advance();
				this.reservedWordAllowed = false;
				this.commandStart = false;
				return { type: 'AndGreat', value: '&>', pos };
			}
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'Amp', value: '&', pos };
		}

		if (ch === ';') {
			if (this.peek() === ';') {
				this.advance();
				if (this.peek() === '&') {
					this.advance();
					this.reservedWordAllowed = true;
					this.commandStart = true;
					return { type: 'DoubleSemiAmp', value: ';;&', pos };
				}
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'DoubleSemi', value: ';;', pos };
			}
			if (this.peek() === '&') {
				this.advance();
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'SemiAmp', value: ';&', pos };
			}
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'Semi', value: ';', pos };
		}

		if (ch === '(') {
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'LeftParen', value: '(', pos };
		}

		// ch === ')'
		this.reservedWordAllowed = false;
		this.commandStart = false;
		return { type: 'RightParen', value: ')', pos };
	}

	/** Scan redirection operators: < > >> << <<- <& >& >| */
	private scanRedirection(): Token {
		const pos = this.currentPos();
		const ch = this.advance();

		if (ch === '<') {
			if (this.peek() === '<') {
				this.advance();
				if (this.peek() === '<') {
					// <<< here-string
					this.advance();
					this.reservedWordAllowed = false;
					this.commandStart = false;
					return { type: 'TLess', value: '<<<', pos };
				}
				if (this.peek() === '-') {
					this.advance();
					const tok: Token = { type: 'DLessDash', value: '<<-', pos };
					this.scanHeredocDelimiter(tok, true);
					this.reservedWordAllowed = false;
					this.commandStart = false;
					return tok;
				}
				const tok: Token = { type: 'DLess', value: '<<', pos };
				this.scanHeredocDelimiter(tok, false);
				this.reservedWordAllowed = false;
				this.commandStart = false;
				return tok;
			}
			if (this.peek() === '&') {
				this.advance();
				this.reservedWordAllowed = false;
				this.commandStart = false;
				return { type: 'LessAnd', value: '<&', pos };
			}
			if (this.peek() === '(') {
				throw new LexerError(
					'process substitution <() is not supported; use a temporary file or pipe instead',
					pos,
				);
			}
			this.reservedWordAllowed = false;
			this.commandStart = false;
			return { type: 'Less', value: '<', pos };
		}

		// ch === '>'
		if (this.peek() === '>') {
			this.advance();
			this.reservedWordAllowed = false;
			this.commandStart = false;
			return { type: 'DGreat', value: '>>', pos };
		}
		if (this.peek() === '&') {
			this.advance();
			this.reservedWordAllowed = false;
			this.commandStart = false;
			return { type: 'GreatAnd', value: '>&', pos };
		}
		if (this.peek() === '|') {
			this.advance();
			this.reservedWordAllowed = false;
			this.commandStart = false;
			return { type: 'Clobber', value: '>|', pos };
		}
		if (this.peek() === '(') {
			throw new LexerError(
				'process substitution >() is not supported; use a temporary file or pipe instead',
				pos,
			);
		}
		this.reservedWordAllowed = false;
		this.commandStart = false;
		return { type: 'Great', value: '>', pos };
	}

	/**
	 * After seeing << or <<-, scan the heredoc delimiter and queue
	 * heredoc collection for after the current line.
	 */
	private scanHeredocDelimiter(token: Token, stripTabs: boolean): void {
		this.skipBlanks();
		let delimiter = '';
		let quoted = false;

		const startCh = this.peek();

		if (startCh === "'" || startCh === '"') {
			// Quoted delimiter - no expansion in heredoc body
			quoted = true;
			const quote = this.advance();
			while (this.pos < this.input.length && this.peek() !== quote) {
				delimiter += this.advance();
			}
			if (this.pos >= this.input.length) {
				throw new LexerError(`unterminated heredoc delimiter quote ${quote}`, token.pos);
			}
			this.advance(); // closing quote
		} else if (startCh === '\\') {
			// Backslash-escaped delimiter - treat as quoted
			quoted = true;
			this.advance(); // skip backslash
			while (this.pos < this.input.length && !isMeta(this.peek()) && this.peek() !== '\n') {
				delimiter += this.advance();
			}
		} else {
			// Unquoted delimiter
			while (this.pos < this.input.length && !isMeta(this.peek()) && this.peek() !== '\n') {
				delimiter += this.advance();
			}
		}

		if (delimiter.length === 0) {
			throw new LexerError('expected heredoc delimiter after <<', token.pos);
		}

		this.pendingHeredocs.push({ delimiter, quoted, stripTabs, token });
	}

	/**
	 * Collect heredoc content after a newline.
	 * Each pending heredoc reads lines until its delimiter is found.
	 */
	private collectPendingHeredocs(): void {
		for (let i = 0; i < this.pendingHeredocs.length; i++) {
			const hd = this.pendingHeredocs[i];
			let content = '';

			while (this.pos < this.input.length) {
				// Read a line
				let line = '';
				while (this.pos < this.input.length && this.peek() !== '\n') {
					line += this.advance();
				}
				// Consume the newline
				if (this.peek() === '\n') {
					this.advance();
				}

				// Check if line matches the delimiter
				const testLine = hd.stripTabs ? line.replace(/^\t+/, '') : line;
				if (testLine === hd.delimiter) {
					break;
				}

				if (hd.stripTabs) {
					content += line.replace(/^\t+/, '');
				} else {
					content += line;
				}
				content += '\n';
			}

			this.heredocContent.set(hd.token, content);
		}
		this.pendingHeredocs = [];
	}

	/** Scan a word token (possibly including quotes, expansions, etc.). */
	private scanWord(): Token {
		const pos = this.currentPos();
		let value = '';
		let isAssignment = false;
		let seenEquals = false;
		let wordLen = 0;
		let braceDepth = 0;

		while (this.pos < this.input.length) {
			const ch = this.peek();

			// Track brace depth for brace expansion (e.g., {a,b,c})
			if (ch === '{' && wordLen > 0) {
				// { inside a word starts potential brace expansion
				braceDepth++;
			} else if (ch === '{' && wordLen === 0) {
				// { at start of word: check if followed by non-whitespace
				// (brace expansion) or whitespace/meta (brace group)
				const nextCh = this.peekAt(1);
				if (nextCh === '' || isBlank(nextCh) || nextCh === '\n') {
					// Standalone { - consume and return as LeftBrace
					break;
				}
				// Part of a brace expansion word
				braceDepth++;
			}

			// } closes brace expansion, or ends word if no open braces
			if (ch === '}') {
				if (braceDepth > 0) {
					braceDepth--;
					value += this.advance();
					wordLen++;
					continue;
				}
				// Standalone } - break out of word
				break;
			}

			// Metacharacters end the word
			if (isMeta(ch) || ch === ')') {
				break;
			}

			// Check for [[ as a single token
			if (value === '[' && ch === '[') {
				value += this.advance();
				wordLen++;
				break;
			}

			// Check for ]] as a single token
			if (value === ']' && ch === ']') {
				value += this.advance();
				wordLen++;
				break;
			}

			// Handle escape
			if (ch === '\\') {
				this.advance(); // backslash
				if (this.pos < this.input.length && this.peek() !== '\n') {
					value += this.advance();
					wordLen++;
				}
				// Line continuation: backslash-newline is removed
				if (this.pos < this.input.length && this.peek() === '\n') {
					this.advance();
				}
				continue;
			}

			// Single-quoted string
			if (ch === "'") {
				value += this.scanSingleQuoted();
				wordLen++;
				continue;
			}

			// ANSI-C quote: $'...'
			if (ch === '$' && this.peekAt(1) === "'") {
				value += this.scanAnsiCQuoted();
				wordLen++;
				continue;
			}

			// Double-quoted string
			if (ch === '"') {
				value += this.scanDoubleQuoted();
				wordLen++;
				continue;
			}

			// Dollar sign expansions (keep as literal text in the token value)
			if (ch === '$') {
				value += this.scanDollar();
				wordLen++;
				continue;
			}

			// Backtick command substitution
			if (ch === '`') {
				value += this.scanBacktick();
				wordLen++;
				continue;
			}

			// Assignment detection: NAME= at start of command
			if (ch === '=' && !seenEquals && this.commandStart && wordLen > 0) {
				// Check the word so far is a valid variable name
				if (isValidVarName(value) || isValidVarNamePlusEquals(value)) {
					seenEquals = true;
					isAssignment = true;
					value += this.advance();
					wordLen++;
					continue;
				}
			}
			if (ch === '+' && this.peekAt(1) === '=' && !seenEquals && this.commandStart && wordLen > 0) {
				if (isValidVarName(value)) {
					seenEquals = true;
					isAssignment = true;
					value += this.advance(); // +
					value += this.advance(); // =
					wordLen += 2;
					continue;
				}
			}

			// Regular character
			value += this.advance();
			wordLen++;
		}

		if (value.length === 0) {
			// Handle standalone { that was determined to be a brace group opener
			if (this.pos < this.input.length && this.peek() === '{') {
				this.advance();
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'LeftBrace', value: '{', pos };
			}
			// Handle standalone } that wasn't consumed by the word loop
			if (this.pos < this.input.length && this.peek() === '}') {
				this.advance();
				this.reservedWordAllowed = true;
				this.commandStart = true;
				return { type: 'RightBrace', value: '}', pos };
			}
			// Should not happen, but safety
			return { type: 'EOF', value: '', pos };
		}

		// ]] is always recognized as a special token (it closes [[)
		if (value === ']]') {
			this.reservedWordAllowed = false;
			this.commandStart = false;
			return { type: 'DblRightBracket', value: ']]', pos };
		}

		// Standalone { should already be handled by the empty-value check above.
		// This is a fallback for safety.
		if (value === '{') {
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: 'LeftBrace', value: '{', pos };
		}

		// Reserved word recognition. The lexer always checks for reserved words
		// and classifies them by token type. The parser is responsible for
		// treating them as plain words when they appear in non-reserved positions
		// (e.g., as command arguments). This simplifies the lexer and avoids
		// needing complex parser-level context here.
		const reserved = RESERVED_WORDS.get(value);
		if (reserved) {
			// After reserved words, the next position allows more reserved words
			this.reservedWordAllowed = true;
			this.commandStart = true;
			return { type: reserved, value, pos };
		}

		// Determine token type
		if (isAssignment) {
			// After assignment, next word can still be an assignment or command
			this.commandStart = true;
			this.reservedWordAllowed = false;
			return { type: 'AssignmentWord', value, pos };
		}

		// Check if this is an fd number before a redirection
		if (isAllDigits(value) && (this.peek() === '<' || this.peek() === '>')) {
			// Don't treat as a word yet; this will be picked up as part of the redirection
			// Actually, the parser handles fd numbers. Return as a word.
		}

		// First word of a command: after this, reserved words are not allowed
		// (except in specific contexts the parser manages)
		this.reservedWordAllowed = false;
		this.commandStart = false;
		return { type: 'Word', value, pos };
	}

	/** Scan a single-quoted string including delimiters. Returns the content including quotes. */
	private scanSingleQuoted(): string {
		let result = '';
		const startPos = this.currentPos();
		result += this.advance(); // opening '

		while (this.pos < this.input.length) {
			const ch = this.peek();
			if (ch === "'") {
				result += this.advance(); // closing '
				return result;
			}
			result += this.advance();
		}

		throw new LexerError('unterminated single quote', startPos);
	}

	/** Scan a double-quoted string including delimiters. Returns content including quotes. */
	private scanDoubleQuoted(): string {
		let result = '';
		const startPos = this.currentPos();
		result += this.advance(); // opening "

		while (this.pos < this.input.length) {
			const ch = this.peek();
			if (ch === '"') {
				result += this.advance(); // closing "
				return result;
			}
			if (ch === '\\') {
				result += this.advance(); // backslash
				if (this.pos < this.input.length) {
					result += this.advance(); // escaped char
				}
				continue;
			}
			if (ch === '$') {
				result += this.scanDollar();
				continue;
			}
			if (ch === '`') {
				result += this.scanBacktick();
				continue;
			}
			result += this.advance();
		}

		throw new LexerError('unterminated double quote', startPos);
	}

	/** Scan ANSI-C quoted string: $'...' with escape sequences. Returns content including $' and '. */
	private scanAnsiCQuoted(): string {
		let result = '';
		const startPos = this.currentPos();
		result += this.advance(); // $
		result += this.advance(); // '

		while (this.pos < this.input.length) {
			const ch = this.peek();
			if (ch === "'") {
				result += this.advance(); // closing '
				return result;
			}
			if (ch === '\\') {
				result += this.advance(); // backslash
				if (this.pos < this.input.length) {
					result += this.advance(); // escaped char
				}
				continue;
			}
			result += this.advance();
		}

		throw new LexerError('unterminated ANSI-C quote', startPos);
	}

	/** Scan a dollar-prefixed expansion. Returns the raw text. */
	private scanDollar(): string {
		let result = '';
		result += this.advance(); // $

		if (this.pos >= this.input.length) return result;

		const next = this.peek();

		// $((arithmetic))
		if (next === '(' && this.peekAt(1) === '(') {
			result += this.advance(); // (
			result += this.advance(); // (
			let depth = 1;
			while (this.pos < this.input.length && depth > 0) {
				const c = this.peek();
				if (c === '(' && this.peekAt(1) === '(') {
					depth++;
					result += this.advance();
					result += this.advance();
				} else if (c === ')' && this.peekAt(1) === ')') {
					depth--;
					result += this.advance();
					result += this.advance();
				} else {
					result += this.advance();
				}
			}
			return result;
		}

		// $(command substitution)
		if (next === '(') {
			result += this.advance(); // (
			let depth = 1;
			while (this.pos < this.input.length && depth > 0) {
				const c = this.peek();
				if (c === '(') {
					depth++;
				} else if (c === ')') {
					depth--;
				} else if (c === '\\') {
					result += this.advance();
					if (this.pos < this.input.length) {
						result += this.advance();
					}
					continue;
				} else if (c === "'" && depth > 0) {
					result += this.scanSingleQuoted();
					continue;
				} else if (c === '"' && depth > 0) {
					result += this.scanDoubleQuoted();
					continue;
				}
				result += this.advance();
			}
			return result;
		}

		// ${parameter expansion}
		if (next === '{') {
			result += this.advance(); // {
			let depth = 1;
			while (this.pos < this.input.length && depth > 0) {
				const c = this.peek();
				if (c === '{') {
					depth++;
				} else if (c === '}') {
					depth--;
				} else if (c === '\\') {
					result += this.advance();
					if (this.pos < this.input.length) {
						result += this.advance();
					}
					continue;
				}
				result += this.advance();
			}
			return result;
		}

		// $VAR or $1, $?, $@, $*, $#, $$, $!, $-, $0-$9
		if (
			next === '?' ||
			next === '@' ||
			next === '*' ||
			next === '#' ||
			next === '$' ||
			next === '!' ||
			next === '-' ||
			next === '_'
		) {
			result += this.advance();
			return result;
		}
		if (isDigit(next)) {
			result += this.advance();
			return result;
		}
		if (isVarStartChar(next)) {
			while (this.pos < this.input.length && isVarChar(this.peek())) {
				result += this.advance();
			}
			return result;
		}

		return result;
	}

	/** Scan a backtick command substitution. Returns raw text including backticks. */
	private scanBacktick(): string {
		let result = '';
		const startPos = this.currentPos();
		result += this.advance(); // opening `

		while (this.pos < this.input.length) {
			const ch = this.peek();
			if (ch === '`') {
				result += this.advance(); // closing `
				return result;
			}
			if (ch === '\\') {
				result += this.advance();
				if (this.pos < this.input.length) {
					result += this.advance();
				}
				continue;
			}
			result += this.advance();
		}

		throw new LexerError('unterminated backtick', startPos);
	}
}

/** Check if a string is a valid bash variable name (letters, digits, underscore, starts with letter/underscore). */
function isValidVarName(name: string): boolean {
	if (name.length === 0) return false;
	if (!isVarStartChar(name[0])) return false;
	for (let i = 1; i < name.length; i++) {
		if (!isVarChar(name[i])) return false;
	}
	return true;
}

/** Same as isValidVarName but also allows trailing +. */
function isValidVarNamePlusEquals(name: string): boolean {
	if (name.length < 2) return false;
	if (name[name.length - 1] !== '+') return false;
	return isValidVarName(name.slice(0, -1));
}

/** Check if ch can start a variable name. */
function isVarStartChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) || // A-Z
		(code >= 97 && code <= 122) || // a-z
		code === 95 // _
	);
}

/** Check if ch can be part of a variable name (not at start). */
function isVarChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) || // A-Z
		(code >= 97 && code <= 122) || // a-z
		(code >= 48 && code <= 57) || // 0-9
		code === 95 // _
	);
}

/** Check if a string consists entirely of digits. */
function isAllDigits(s: string): boolean {
	if (s.length === 0) return false;
	for (let i = 0; i < s.length; i++) {
		if (!isDigit(s[i])) return false;
	}
	return true;
}

/**
 * Tokenize a shell command string into an array of tokens.
 * Convenience wrapper around the Lexer class.
 *
 * @param input - The shell command string to tokenize
 * @returns Array of tokens (excluding comments, including EOF)
 */
export function tokenize(input: string): Token[] {
	const lexer = new Lexer(input);
	const tokens: Token[] = [];
	while (true) {
		const token = lexer.next();
		if (token.type === 'Comment') continue;
		tokens.push(token);
		if (token.type === 'EOF') break;
	}
	return tokens;
}
