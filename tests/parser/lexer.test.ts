import { describe, expect, it } from 'vitest';
import { Lexer, LexerError, tokenize } from '../../src/parser/lexer.js';
import type { Token, TokenType } from '../../src/parser/lexer.js';

/** Helper: tokenize and return types (excluding EOF). */
function types(input: string): TokenType[] {
  return tokenize(input)
    .filter((t) => t.type !== 'EOF')
    .map((t) => t.type);
}

/** Helper: tokenize and return values (excluding EOF). */
function values(input: string): string[] {
  return tokenize(input)
    .filter((t) => t.type !== 'EOF')
    .map((t) => t.value);
}

/** Helper: tokenize and return [type, value] pairs (excluding EOF). */
function pairs(input: string): Array<[TokenType, string]> {
  return tokenize(input)
    .filter((t) => t.type !== 'EOF')
    .map((t) => [t.type, t.value]);
}

describe('Lexer', () => {
  describe('basic tokens', () => {
    it('tokenizes a simple word', () => {
      expect(types('echo')).toEqual(['Word']);
      expect(values('echo')).toEqual(['echo']);
    });

    it('tokenizes multiple words', () => {
      expect(types('echo hello world')).toEqual(['Word', 'Word', 'Word']);
      expect(values('echo hello world')).toEqual(['echo', 'hello', 'world']);
    });

    it('tokenizes pipe', () => {
      expect(types('cat file | grep foo')).toEqual(['Word', 'Word', 'Pipe', 'Word', 'Word']);
    });

    it('tokenizes double pipe (or)', () => {
      expect(types('cmd1 || cmd2')).toEqual(['Word', 'DoublePipe', 'Word']);
    });

    it('tokenizes ampersand', () => {
      expect(types('cmd &')).toEqual(['Word', 'Amp']);
    });

    it('tokenizes double ampersand (and)', () => {
      expect(types('cmd1 && cmd2')).toEqual(['Word', 'DoubleAmp', 'Word']);
    });

    it('tokenizes semicolons', () => {
      expect(types('cmd1; cmd2')).toEqual(['Word', 'Semi', 'Word']);
    });

    it('tokenizes double semicolons', () => {
      expect(types(';;')).toEqual(['DoubleSemi']);
    });

    it('tokenizes parentheses', () => {
      expect(types('(cmd)')).toEqual(['LeftParen', 'Word', 'RightParen']);
    });

    it('tokenizes braces', () => {
      expect(types('{ cmd; }')).toEqual(['LeftBrace', 'Word', 'Semi', 'RightBrace']);
    });

    it('tokenizes newlines as tokens', () => {
      expect(types('cmd1\ncmd2')).toEqual(['Word', 'Newline', 'Word']);
    });
  });

  describe('redirections', () => {
    it('tokenizes output redirection >', () => {
      expect(types('echo > file')).toEqual(['Word', 'Great', 'Word']);
    });

    it('tokenizes append redirection >>', () => {
      expect(types('echo >> file')).toEqual(['Word', 'DGreat', 'Word']);
    });

    it('tokenizes input redirection <', () => {
      expect(types('cmd < file')).toEqual(['Word', 'Less', 'Word']);
    });

    it('tokenizes dup redirections <& and >&', () => {
      expect(types('cmd <&3')).toEqual(['Word', 'LessAnd', 'Word']);
      expect(types('cmd >&2')).toEqual(['Word', 'GreatAnd', 'Word']);
    });

    it('tokenizes clobber >|', () => {
      expect(types('cmd >| file')).toEqual(['Word', 'Clobber', 'Word']);
    });

    it('tokenizes &>', () => {
      expect(types('cmd &> file')).toEqual(['Word', 'AndGreat', 'Word']);
    });
  });

  describe('reserved words', () => {
    it('recognizes if/then/else/elif/fi', () => {
      expect(types('if true; then echo a; elif false; then echo b; else echo c; fi')).toEqual([
        'If',
        'Word',
        'Semi',
        'Then',
        'Word',
        'Word',
        'Semi',
        'Elif',
        'Word',
        'Semi',
        'Then',
        'Word',
        'Word',
        'Semi',
        'Else',
        'Word',
        'Word',
        'Semi',
        'Fi',
      ]);
    });

    it('recognizes for/in/do/done', () => {
      expect(types('for x in a b; do echo $x; done')).toEqual([
        'For',
        'Word',
        'In',
        'Word',
        'Word',
        'Semi',
        'Do',
        'Word',
        'Word',
        'Semi',
        'Done',
      ]);
    });

    it('recognizes while/do/done', () => {
      expect(types('while true; do echo x; done')).toEqual([
        'While',
        'Word',
        'Semi',
        'Do',
        'Word',
        'Word',
        'Semi',
        'Done',
      ]);
    });

    it('recognizes until/do/done', () => {
      expect(types('until false; do echo x; done')).toEqual([
        'Until',
        'Word',
        'Semi',
        'Do',
        'Word',
        'Word',
        'Semi',
        'Done',
      ]);
    });

    it('recognizes case/in/esac', () => {
      const tokens = types('case $x in a) echo a;; esac');
      expect(tokens).toContain('Case');
      expect(tokens).toContain('In');
      expect(tokens).toContain('Esac');
    });

    it('recognizes [[ and ]]', () => {
      expect(types('[[ -f file ]]')).toEqual(['DblLeftBracket', 'Word', 'Word', 'DblRightBracket']);
    });

    it('recognizes function keyword', () => {
      const tokens = types('function foo { echo bar; }');
      expect(tokens[0]).toBe('Function');
    });

    it('recognizes ! (bang) for pipeline negation', () => {
      const tokens = types('! cmd');
      expect(tokens[0]).toBe('Bang');
    });
  });

  describe('quoting', () => {
    it('tokenizes single-quoted string as one word', () => {
      const result = tokenize("echo 'hello world'");
      const words = result.filter((t) => t.type === 'Word');
      expect(words).toHaveLength(2);
      expect(words[1].value).toBe("'hello world'");
    });

    it('tokenizes double-quoted string as one word', () => {
      const result = tokenize('echo "hello world"');
      const words = result.filter((t) => t.type === 'Word');
      expect(words).toHaveLength(2);
      expect(words[1].value).toBe('"hello world"');
    });

    it('handles double-quoted string with variable', () => {
      const result = tokenize('echo "hello $name"');
      const words = result.filter((t) => t.type === 'Word');
      expect(words[1].value).toBe('"hello $name"');
    });

    it('handles double-quoted string with command substitution', () => {
      const result = tokenize('echo "result: $(cmd)"');
      const words = result.filter((t) => t.type === 'Word');
      expect(words[1].value).toContain('$(cmd)');
    });

    it('preserves escape sequences in double quotes', () => {
      const result = tokenize('echo "hello\\nworld"');
      const words = result.filter((t) => t.type === 'Word');
      expect(words[1].value).toBe('"hello\\nworld"');
    });

    it('handles ANSI-C quotes', () => {
      const result = tokenize("echo $'hello\\nworld'");
      const words = result.filter((t) => t.type === 'Word');
      expect(words[1].value).toBe("$'hello\\nworld'");
    });

    it('handles concatenated quoting styles', () => {
      const result = tokenize('echo \'a\'"b"c');
      const words = result.filter((t) => t.type === 'Word');
      expect(words).toHaveLength(2);
      expect(words[1].value).toBe('\'a\'"b"c');
    });

    it('> inside quotes is not a redirection', () => {
      const result = tokenize('echo "a > b"');
      expect(types('echo "a > b"')).toEqual(['Word', 'Word']);
    });

    it('# inside quotes is not a comment', () => {
      expect(types('echo "# not a comment"')).toEqual(['Word', 'Word']);
    });

    it('| inside quotes is not a pipe', () => {
      expect(types('echo "a | b"')).toEqual(['Word', 'Word']);
    });

    it('errors on unterminated single quote', () => {
      expect(() => tokenize("echo 'unterminated")).toThrow(LexerError);
    });

    it('errors on unterminated double quote', () => {
      expect(() => tokenize('echo "unterminated')).toThrow(LexerError);
    });

    it('errors on unterminated ANSI-C quote', () => {
      expect(() => tokenize("echo $'unterminated")).toThrow(LexerError);
    });

    it('errors on unterminated backtick', () => {
      expect(() => tokenize('echo `unterminated')).toThrow(LexerError);
    });
  });

  describe('heredocs', () => {
    it('detects basic heredoc <<EOF', () => {
      // The lexer consumes the delimiter as part of the << token scan,
      // so there's no separate Word token for the delimiter.
      const lexer = new Lexer('cat <<EOF\nhello\nworld\nEOF\n');
      const t1 = lexer.next(); // cat
      expect(t1.type).toBe('Word');
      const t2 = lexer.next(); // << (delimiter consumed internally)
      expect(t2.type).toBe('DLess');
      const t3 = lexer.next(); // newline triggers heredoc collection
      expect(t3.type).toBe('Newline');

      const content = lexer.getHeredocContent(t2);
      expect(content).toBe('hello\nworld\n');
    });

    it('detects tab-stripping heredoc <<-EOF', () => {
      const lexer = new Lexer('cat <<-EOF\n\thello\n\tworld\nEOF\n');
      const t1 = lexer.next(); // cat
      const t2 = lexer.next(); // <<-
      expect(t2.type).toBe('DLessDash');
      const t3 = lexer.next(); // newline

      const content = lexer.getHeredocContent(t2);
      expect(content).toBe('hello\nworld\n');
    });

    it('detects quoted heredoc delimiter', () => {
      const lexer = new Lexer("cat <<'EOF'\nhello $var\nEOF\n");
      lexer.next(); // cat
      const t2 = lexer.next(); // <<
      lexer.next(); // newline

      const content = lexer.getHeredocContent(t2);
      expect(content).toBe('hello $var\n');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      expect(types('')).toEqual([]);
    });

    it('handles only whitespace', () => {
      expect(types('   \t  ')).toEqual([]);
    });

    it('handles only newlines', () => {
      expect(types('\n\n')).toEqual(['Newline', 'Newline']);
    });

    it('handles only comments', () => {
      // tokenize strips comments
      expect(types('# this is a comment')).toEqual([]);
    });

    it('handles comment after command', () => {
      expect(types('echo hello # comment')).toEqual(['Word', 'Word']);
    });

    it('handles backslash-newline line continuation', () => {
      const result = tokenize('echo hel\\\nlo');
      const words = result.filter((t) => t.type === 'Word');
      expect(words).toHaveLength(2);
      expect(words[1].value).toBe('hello');
    });

    it('handles escape outside quotes', () => {
      const result = tokenize('echo hello\\ world');
      const words = result.filter((t) => t.type === 'Word');
      expect(words).toHaveLength(2);
      expect(words[1].value).toBe('hello world');
    });

    it('handles consecutive operators', () => {
      expect(types('echo; echo')).toEqual(['Word', 'Semi', 'Word']);
    });

    it('handles fd number before redirection', () => {
      const result = tokenize('cmd 2>&1');
      expect(result.filter((t) => t.type !== 'EOF').map((t) => t.type)).toEqual([
        'Word',
        'Word',
        'GreatAnd',
        'Word',
      ]);
    });
  });

  describe('unsupported syntax', () => {
    it('tokenizes here-string <<<', () => {
      const tokens = tokenize('cmd <<< "input"');
      const types = tokens.map((t: { type: string }) => t.type);
      expect(types).toContain('TLess');
    });

    it('errors on process substitution <()', () => {
      expect(() => tokenize('diff <(cmd1) <(cmd2)')).toThrow(LexerError);
      expect(() => tokenize('diff <(cmd1) <(cmd2)')).toThrow(/process substitution/);
    });

    it('errors on process substitution >()', () => {
      expect(() => tokenize('cmd >(tee file)')).toThrow(LexerError);
      expect(() => tokenize('cmd >(tee file)')).toThrow(/process substitution/);
    });
  });

  describe('assignment detection', () => {
    it('detects simple assignment VAR=value', () => {
      expect(types('VAR=hello')).toEqual(['AssignmentWord']);
      expect(values('VAR=hello')).toEqual(['VAR=hello']);
    });

    it('detects empty assignment VAR=', () => {
      expect(types('VAR=')).toEqual(['AssignmentWord']);
    });

    it('detects assignment with quoted value', () => {
      expect(types('VAR="hello world"')).toEqual(['AssignmentWord']);
    });

    it('detects assignment before command', () => {
      expect(types('VAR=hello echo $VAR')).toEqual(['AssignmentWord', 'Word', 'Word']);
    });

    it('detects multiple assignments', () => {
      expect(types('A=1 B=2 cmd')).toEqual(['AssignmentWord', 'AssignmentWord', 'Word']);
    });

    it('detects += append assignment', () => {
      expect(types('VAR+=more')).toEqual(['AssignmentWord']);
      expect(values('VAR+=more')).toEqual(['VAR+=more']);
    });

    it('does not detect assignment mid-command', () => {
      // After first word (non-assignment), = is not special
      expect(types('echo A=1')).toEqual(['Word', 'Word']);
    });
  });

  describe('dollar expansions', () => {
    it('handles $VAR', () => {
      const result = values('echo $HOME');
      expect(result[1]).toBe('$HOME');
    });

    it('handles ${VAR}', () => {
      const result = values('echo ${HOME}');
      expect(result[1]).toBe('${HOME}');
    });

    it('handles $(command)', () => {
      const result = values('echo $(whoami)');
      expect(result[1]).toBe('$(whoami)');
    });

    it('handles $((arithmetic))', () => {
      const result = values('echo $((1+2))');
      expect(result[1]).toBe('$((1+2))');
    });

    it('handles special variables $? $# $@ etc.', () => {
      expect(values('echo $?')[1]).toBe('$?');
      expect(values('echo $#')[1]).toBe('$#');
      expect(values('echo $@')[1]).toBe('$@');
      expect(values('echo $*')[1]).toBe('$*');
      expect(values('echo $$')[1]).toBe('$$');
      expect(values('echo $!')[1]).toBe('$!');
      expect(values('echo $-')[1]).toBe('$-');
    });

    it('handles positional parameters $0-$9', () => {
      expect(values('echo $0')[1]).toBe('$0');
      expect(values('echo $1')[1]).toBe('$1');
      expect(values('echo $9')[1]).toBe('$9');
    });

    it('handles nested command substitution', () => {
      const result = values('echo $(echo $(whoami))');
      expect(result[1]).toBe('$(echo $(whoami))');
    });

    it('handles ${var:-default}', () => {
      const result = values('echo ${var:-default}');
      expect(result[1]).toBe('${var:-default}');
    });
  });

  describe('position tracking', () => {
    it('tracks line and column for first token', () => {
      const tokens = tokenize('echo');
      expect(tokens[0].pos).toEqual({ line: 1, col: 1 });
    });

    it('tracks position after whitespace', () => {
      const tokens = tokenize('  echo');
      expect(tokens[0].pos).toEqual({ line: 1, col: 3 });
    });

    it('tracks position across lines', () => {
      const tokens = tokenize('echo\nfoo');
      const foo = tokens.find((t) => t.value === 'foo');
      expect(foo?.pos.line).toBe(2);
      expect(foo?.pos.col).toBe(1);
    });
  });

  describe('Lexer class API', () => {
    it('returns EOF when input is exhausted', () => {
      const lexer = new Lexer('');
      expect(lexer.next().type).toBe('EOF');
      // Repeated calls also return EOF
      expect(lexer.next().type).toBe('EOF');
    });

    it('returns tokens one at a time', () => {
      const lexer = new Lexer('echo hello');
      expect(lexer.next().value).toBe('echo');
      expect(lexer.next().value).toBe('hello');
      expect(lexer.next().type).toBe('EOF');
    });
  });
});
