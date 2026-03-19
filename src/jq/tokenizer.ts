/**
 * Tokenizer for the jq filter language.
 *
 * Produces a flat token stream. String interpolation (\(expr)) is
 * represented as StringStart / StringInterp / StringEnd token sequences.
 */

import { JqParseError } from './errors.js';
import type { JqPosition } from './errors.js';

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type JqTokenType =
  // Literals & identifiers
  | 'Number'
  | 'String'
  | 'Ident'
  | 'Variable' // $name
  | 'Format' // @name

  // String interpolation
  | 'StringStart' // opening " before first \(
  | 'StringInterp' // marks beginning of \( expression
  | 'StringEnd' // closing " after last interpolation or plain string part
  | 'StringFragment' // literal text between interpolations

  // Operators
  | 'Dot'
  | 'DotDot'
  | 'Pipe'
  | 'Comma'
  | 'Colon'
  | 'Semicolon'
  | 'Question'
  | 'Plus'
  | 'Minus'
  | 'Star'
  | 'Slash'
  | 'Percent'
  | 'Eq'
  | 'Neq'
  | 'Lt'
  | 'Gt'
  | 'Le'
  | 'Ge'
  | 'Assign'
  | 'UpdatePipe' // |=
  | 'PlusAssign' // +=
  | 'MinusAssign' // -=
  | 'StarAssign' // *=
  | 'SlashAssign' // /=
  | 'PercentAssign' // %=
  | 'AltAssign' // //=
  | 'Alt' // //

  // Brackets
  | 'LParen'
  | 'RParen'
  | 'LBracket'
  | 'RBracket'
  | 'LBrace'
  | 'RBrace'

  // Keywords
  | 'If'
  | 'Then'
  | 'Elif'
  | 'Else'
  | 'End'
  | 'Try'
  | 'Catch'
  | 'Reduce'
  | 'Foreach'
  | 'As'
  | 'Def'
  | 'And'
  | 'Or'
  | 'Not'
  | 'Label'
  | 'Break'
  | 'Import'
  | 'Include'

  // Special
  | 'EOF';

export interface JqToken {
  type: JqTokenType;
  value: string;
  position: JqPosition;
}

// ---------------------------------------------------------------------------
// Keyword map
// ---------------------------------------------------------------------------

const KEYWORDS = new Map<string, JqTokenType>([
  ['if', 'If'],
  ['then', 'Then'],
  ['elif', 'Elif'],
  ['else', 'Else'],
  ['end', 'End'],
  ['try', 'Try'],
  ['catch', 'Catch'],
  ['reduce', 'Reduce'],
  ['foreach', 'Foreach'],
  ['as', 'As'],
  ['def', 'Def'],
  ['and', 'And'],
  ['or', 'Or'],
  ['not', 'Not'],
  ['label', 'Label'],
  ['break', 'Break'],
  ['import', 'Import'],
  ['include', 'Include'],
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isAlpha(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isAlnum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * Tokenize a jq filter string into a token array.
 *
 * @param source - The jq filter source
 * @returns Array of tokens, always ending with EOF
 */
export function tokenize(source: string): JqToken[] {
  const tokens: JqToken[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  /** Track string interpolation depth: each entry is a paren depth counter. */
  const interpStack: number[] = [];

  function position(): JqPosition {
    return { offset: pos, line, column: col };
  }

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function peek(): string {
    return pos < source.length ? source[pos] : '\0';
  }

  function peekAt(offset: number): string {
    const idx = pos + offset;
    return idx < source.length ? source[idx] : '\0';
  }

  function emit(type: JqTokenType, value: string, p: JqPosition): void {
    tokens.push({ type, value, position: p });
  }

  function error(msg: string): never {
    throw new JqParseError(msg, position());
  }

  /** Read a string body (after the opening "), handling escapes and \( interpolation. */
  function readStringBody(isInterpolated: boolean): void {
    let buf = '';
    const startPos = position();

    if (isInterpolated) {
      emit('StringFragment', '', startPos);
      // overwrite - we'll replace the placeholder below
      tokens.pop();
    }

    while (pos < source.length) {
      const ch = source[pos];

      if (ch === '"') {
        // End of string
        if (isInterpolated) {
          emit('StringFragment', buf, startPos);
          const endPos = position();
          advance(); // consume "
          emit('StringEnd', '"', endPos);
        } else {
          advance(); // consume "
          emit('String', buf, startPos);
        }
        return;
      }

      if (ch === '\\') {
        if (pos + 1 >= source.length) {
          error('unterminated string escape');
        }
        const next = source[pos + 1];
        if (next === '(') {
          // String interpolation
          if (!isInterpolated) {
            // Convert this string to an interpolated string
            // Re-emit as StringStart + StringFragment
            emit('StringStart', '"', startPos);
            emit('StringFragment', buf, startPos);
          } else {
            emit('StringFragment', buf, startPos);
          }
          const interpPos = position();
          advance(); // skip backslash
          advance(); // skip (
          emit('StringInterp', '\\(', interpPos);
          interpStack.push(0);
          return; // return to main loop to tokenize the expression
        }
        advance(); // skip backslash
        advance(); // skip escape char
        switch (next) {
          case 'n':
            buf += '\n';
            break;
          case 't':
            buf += '\t';
            break;
          case 'r':
            buf += '\r';
            break;
          case '\\':
            buf += '\\';
            break;
          case '"':
            buf += '"';
            break;
          case '/':
            buf += '/';
            break;
          default:
            buf += `\\${next}`;
        }
        continue;
      }

      buf += advance();
    }

    error('unterminated string');
  }

  while (pos < source.length) {
    const ch = source[pos];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      advance();
      continue;
    }

    // Skip comments
    if (ch === '#') {
      while (pos < source.length && source[pos] !== '\n') {
        advance();
      }
      continue;
    }

    // Check for closing ) during string interpolation
    if (ch === ')' && interpStack.length > 0) {
      if (interpStack[interpStack.length - 1] === 0) {
        // This closes the interpolation
        interpStack.pop();
        const p = position();
        advance(); // consume )
        emit('RParen', ')', p);
        // Continue reading the rest of the string
        readStringBody(true);
        continue;
      }
      // Nested paren inside interpolation
      interpStack[interpStack.length - 1]--;
      const p = position();
      advance();
      emit('RParen', ')', p);
      continue;
    }

    // Track open parens inside interpolation
    if (ch === '(' && interpStack.length > 0) {
      interpStack[interpStack.length - 1]++;
      const p = position();
      advance();
      emit('LParen', '(', p);
      continue;
    }

    const p = position();

    // Numbers
    if (isDigit(ch)) {
      let num = '';
      while (pos < source.length && isDigit(source[pos])) {
        num += advance();
      }
      if (pos < source.length && source[pos] === '.') {
        // Check this isn't field access (digit followed by dot then alpha)
        if (pos + 1 < source.length && isDigit(source[pos + 1])) {
          num += advance(); // consume .
          while (pos < source.length && isDigit(source[pos])) {
            num += advance();
          }
        }
      }
      // Scientific notation
      if (pos < source.length && (source[pos] === 'e' || source[pos] === 'E')) {
        num += advance();
        if (pos < source.length && (source[pos] === '+' || source[pos] === '-')) {
          num += advance();
        }
        while (pos < source.length && isDigit(source[pos])) {
          num += advance();
        }
      }
      emit('Number', num, p);
      continue;
    }

    // Strings
    if (ch === '"') {
      advance(); // consume opening "
      readStringBody(false);
      continue;
    }

    // Variables ($name)
    if (ch === '$') {
      advance(); // consume $
      let name = '';
      while (pos < source.length && isAlnum(source[pos])) {
        name += advance();
      }
      if (name.length === 0) {
        error('expected variable name after $');
      }
      emit('Variable', name, p);
      continue;
    }

    // Format strings (@name)
    if (ch === '@') {
      advance(); // consume @
      let name = '';
      while (pos < source.length && isAlnum(source[pos])) {
        name += advance();
      }
      if (name.length === 0) {
        error('expected format name after @');
      }
      emit('Format', name, p);
      continue;
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      let ident = '';
      while (pos < source.length && isAlnum(source[pos])) {
        ident += advance();
      }
      // Check for true/false/null as literals
      if (ident === 'true' || ident === 'false' || ident === 'null') {
        emit('Ident', ident, p);
      } else {
        const kw = KEYWORDS.get(ident);
        emit(kw !== undefined ? kw : 'Ident', ident, p);
      }
      continue;
    }

    // Two-character operators
    if (pos + 1 < source.length) {
      const two = ch + source[pos + 1];
      if (two === '//') {
        // Check for //=
        if (pos + 2 < source.length && source[pos + 2] === '=') {
          advance();
          advance();
          advance();
          emit('AltAssign', '//=', p);
          continue;
        }
        advance();
        advance();
        emit('Alt', '//', p);
        continue;
      }
      if (two === '|=') {
        advance();
        advance();
        emit('UpdatePipe', '|=', p);
        continue;
      }
      if (two === '+=') {
        advance();
        advance();
        emit('PlusAssign', '+=', p);
        continue;
      }
      if (two === '-=') {
        advance();
        advance();
        emit('MinusAssign', '-=', p);
        continue;
      }
      if (two === '*=') {
        advance();
        advance();
        emit('StarAssign', '*=', p);
        continue;
      }
      if (two === '/=') {
        advance();
        advance();
        emit('SlashAssign', '/=', p);
        continue;
      }
      if (two === '%=') {
        advance();
        advance();
        emit('PercentAssign', '%=', p);
        continue;
      }
      if (two === '==') {
        advance();
        advance();
        emit('Eq', '==', p);
        continue;
      }
      if (two === '!=') {
        advance();
        advance();
        emit('Neq', '!=', p);
        continue;
      }
      if (two === '<=') {
        advance();
        advance();
        emit('Le', '<=', p);
        continue;
      }
      if (two === '>=') {
        advance();
        advance();
        emit('Ge', '>=', p);
        continue;
      }
      if (two === '..') {
        advance();
        advance();
        emit('DotDot', '..', p);
        continue;
      }
    }

    // Single-character tokens
    switch (ch) {
      case '.':
        advance();
        emit('Dot', '.', p);
        continue;
      case '|':
        advance();
        emit('Pipe', '|', p);
        continue;
      case ',':
        advance();
        emit('Comma', ',', p);
        continue;
      case ':':
        advance();
        emit('Colon', ':', p);
        continue;
      case ';':
        advance();
        emit('Semicolon', ';', p);
        continue;
      case '?':
        // Check for ?// (not supported in jq 1.8)
        if (peekAt(1) === '/' && peekAt(2) === '/') {
          error('?// (optional alternative) is not supported');
        }
        advance();
        emit('Question', '?', p);
        continue;
      case '+':
        advance();
        emit('Plus', '+', p);
        continue;
      case '-':
        advance();
        emit('Minus', '-', p);
        continue;
      case '*':
        advance();
        emit('Star', '*', p);
        continue;
      case '/':
        advance();
        emit('Slash', '/', p);
        continue;
      case '%':
        advance();
        emit('Percent', '%', p);
        continue;
      case '=':
        // single = is assignment context (used in object construction)
        advance();
        emit('Assign', '=', p);
        continue;
      case '<':
        advance();
        emit('Lt', '<', p);
        continue;
      case '>':
        advance();
        emit('Gt', '>', p);
        continue;
      case '(':
        advance();
        emit('LParen', '(', p);
        continue;
      case ')':
        advance();
        emit('RParen', ')', p);
        continue;
      case '[':
        advance();
        emit('LBracket', '[', p);
        continue;
      case ']':
        advance();
        emit('RBracket', ']', p);
        continue;
      case '{':
        advance();
        emit('LBrace', '{', p);
        continue;
      case '}':
        advance();
        emit('RBrace', '}', p);
        continue;
      default:
        error(`unexpected character: ${ch}`);
    }
  }

  emit('EOF', '', position());
  return tokens;
}
