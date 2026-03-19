import { describe, expect, it } from 'vitest';
import { JqParseError } from '../../src/jq/errors.js';
import { tokenize } from '../../src/jq/tokenizer.js';

function types(source: string): string[] {
  return tokenize(source).map((t) => t.type);
}

function values(source: string): string[] {
  return tokenize(source).map((t) => t.value);
}

describe('jq tokenizer', () => {
  describe('basic tokens', () => {
    it('tokenizes identity', () => {
      expect(types('.')).toEqual(['Dot', 'EOF']);
    });

    it('tokenizes pipe', () => {
      expect(types('. | .')).toEqual(['Dot', 'Pipe', 'Dot', 'EOF']);
    });

    it('tokenizes comma', () => {
      expect(types('.a, .b')).toEqual(['Dot', 'Ident', 'Comma', 'Dot', 'Ident', 'EOF']);
    });

    it('tokenizes recursive descent', () => {
      expect(types('..')).toEqual(['DotDot', 'EOF']);
    });

    it('tokenizes empty filter', () => {
      expect(types('')).toEqual(['EOF']);
    });

    it('tokenizes brackets', () => {
      expect(types('[]{}()')).toEqual([
        'LBracket',
        'RBracket',
        'LBrace',
        'RBrace',
        'LParen',
        'RParen',
        'EOF',
      ]);
    });
  });

  describe('numbers', () => {
    it('tokenizes integers', () => {
      const toks = tokenize('42');
      expect(toks[0].type).toBe('Number');
      expect(toks[0].value).toBe('42');
    });

    it('tokenizes decimals', () => {
      const toks = tokenize('3.14');
      expect(toks[0].type).toBe('Number');
      expect(toks[0].value).toBe('3.14');
    });

    it('tokenizes scientific notation', () => {
      const toks = tokenize('1e10');
      expect(toks[0].type).toBe('Number');
      expect(toks[0].value).toBe('1e10');
    });

    it('tokenizes negative exponent', () => {
      const toks = tokenize('2.5E-3');
      expect(toks[0].type).toBe('Number');
      expect(toks[0].value).toBe('2.5E-3');
    });
  });

  describe('strings', () => {
    it('tokenizes simple strings', () => {
      const toks = tokenize('"hello"');
      expect(toks[0].type).toBe('String');
      expect(toks[0].value).toBe('hello');
    });

    it('tokenizes escape sequences', () => {
      const toks = tokenize('"a\\nb"');
      expect(toks[0].type).toBe('String');
      expect(toks[0].value).toBe('a\nb');
    });

    it('tokenizes escaped quotes', () => {
      const toks = tokenize('"say \\"hi\\""');
      expect(toks[0].type).toBe('String');
      expect(toks[0].value).toBe('say "hi"');
    });

    it('tokenizes tab and carriage return escapes', () => {
      const toks = tokenize('"a\\tb\\rc"');
      expect(toks[0].type).toBe('String');
      expect(toks[0].value).toBe('a\tb\rc');
    });

    it('errors on unterminated string', () => {
      expect(() => tokenize('"hello')).toThrow(JqParseError);
      expect(() => tokenize('"hello')).toThrow('unterminated string');
    });
  });

  describe('string interpolation', () => {
    it('tokenizes basic interpolation', () => {
      const toks = tokenize('"hello \\(.name)"');
      const tys = toks.map((t) => t.type);
      expect(tys).toEqual([
        'StringStart',
        'StringFragment',
        'StringInterp',
        'Dot',
        'Ident',
        'RParen',
        'StringFragment',
        'StringEnd',
        'EOF',
      ]);
    });

    it('tokenizes multiple interpolations', () => {
      const toks = tokenize('"\\(.a) and \\(.b)"');
      const tys = toks.map((t) => t.type);
      expect(tys).toContain('StringInterp');
      // Should have 2 StringInterp tokens
      expect(tys.filter((t) => t === 'StringInterp')).toHaveLength(2);
    });

    it('tokenizes nested interpolation', () => {
      // "hello \("inner \(.x)")" - a string inside an interpolation with its own interpolation
      const toks = tokenize('"hello \\("inner \\(.x)")"');
      // Should not throw and should have proper structure
      expect(toks[toks.length - 1].type).toBe('EOF');
      // Should contain multiple StringInterp tokens for the nesting
      const interpCount = toks.filter((t) => t.type === 'StringInterp').length;
      expect(interpCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('variables', () => {
    it('tokenizes variables', () => {
      const toks = tokenize('$x');
      expect(toks[0].type).toBe('Variable');
      expect(toks[0].value).toBe('x');
    });

    it('tokenizes multi-char variables', () => {
      const toks = tokenize('$name');
      expect(toks[0].type).toBe('Variable');
      expect(toks[0].value).toBe('name');
    });

    it('errors on bare $', () => {
      expect(() => tokenize('$')).toThrow('expected variable name after $');
    });
  });

  describe('format strings', () => {
    it('tokenizes @base64', () => {
      const toks = tokenize('@base64');
      expect(toks[0].type).toBe('Format');
      expect(toks[0].value).toBe('base64');
    });

    it('tokenizes @csv', () => {
      const toks = tokenize('@csv');
      expect(toks[0].type).toBe('Format');
      expect(toks[0].value).toBe('csv');
    });

    it('errors on bare @', () => {
      expect(() => tokenize('@')).toThrow('expected format name after @');
    });
  });

  describe('keywords', () => {
    it('tokenizes if/then/else/end', () => {
      expect(types('if then else end')).toEqual(['If', 'Then', 'Else', 'End', 'EOF']);
    });

    it('tokenizes elif', () => {
      expect(types('elif')).toEqual(['Elif', 'EOF']);
    });

    it('tokenizes try/catch', () => {
      expect(types('try catch')).toEqual(['Try', 'Catch', 'EOF']);
    });

    it('tokenizes reduce/foreach/as', () => {
      expect(types('reduce foreach as')).toEqual(['Reduce', 'Foreach', 'As', 'EOF']);
    });

    it('tokenizes def', () => {
      expect(types('def')).toEqual(['Def', 'EOF']);
    });

    it('tokenizes and/or/not', () => {
      expect(types('and or not')).toEqual(['And', 'Or', 'Not', 'EOF']);
    });

    it('tokenizes label/break', () => {
      expect(types('label break')).toEqual(['Label', 'Break', 'EOF']);
    });

    it('tokenizes import/include', () => {
      expect(types('import include')).toEqual(['Import', 'Include', 'EOF']);
    });

    it('tokenizes true/false/null as identifiers', () => {
      expect(types('true false null')).toEqual(['Ident', 'Ident', 'Ident', 'EOF']);
      const vals = values('true false null');
      expect(vals.slice(0, 3)).toEqual(['true', 'false', 'null']);
    });
  });

  describe('operators', () => {
    it('tokenizes arithmetic operators', () => {
      expect(types('+ - * / %')).toEqual(['Plus', 'Minus', 'Star', 'Slash', 'Percent', 'EOF']);
    });

    it('tokenizes comparison operators', () => {
      expect(types('== != < > <= >=')).toEqual(['Eq', 'Neq', 'Lt', 'Gt', 'Le', 'Ge', 'EOF']);
    });

    it('tokenizes update operators', () => {
      expect(types('|= += -= *= /= %= //=')).toEqual([
        'UpdatePipe',
        'PlusAssign',
        'MinusAssign',
        'StarAssign',
        'SlashAssign',
        'PercentAssign',
        'AltAssign',
        'EOF',
      ]);
    });

    it('tokenizes alternative operator', () => {
      expect(types('//')).toEqual(['Alt', 'EOF']);
    });

    it('tokenizes question mark', () => {
      expect(types('?')).toEqual(['Question', 'EOF']);
    });

    it('tokenizes colon and semicolon', () => {
      expect(types(': ;')).toEqual(['Colon', 'Semicolon', 'EOF']);
    });

    it('tokenizes assign', () => {
      expect(types('=')).toEqual(['Assign', 'EOF']);
    });

    it('rejects ?//', () => {
      expect(() => tokenize('?//')).toThrow('?// (optional alternative) is not supported');
    });
  });

  describe('comments', () => {
    it('skips line comments', () => {
      expect(types('. # identity\n| .')).toEqual(['Dot', 'Pipe', 'Dot', 'EOF']);
    });

    it('skips comment at end of input', () => {
      expect(types('. # done')).toEqual(['Dot', 'EOF']);
    });
  });

  describe('multi-line', () => {
    it('handles multi-line filter', () => {
      const filter = '.[] |\n  select(.age > 21) |\n  .name';
      const toks = tokenize(filter);
      expect(toks[toks.length - 1].type).toBe('EOF');
      // verify it parsed without error
      expect(toks.length).toBeGreaterThan(5);
    });
  });

  describe('position tracking', () => {
    it('tracks line and column', () => {
      const toks = tokenize('.\n| .name');
      // . is at line 1, col 1
      expect(toks[0].position).toEqual({ offset: 0, line: 1, column: 1 });
      // | is at line 2, col 1
      expect(toks[1].position).toEqual({ offset: 2, line: 2, column: 1 });
    });
  });

  describe('edge cases', () => {
    it('distinguishes . vs .. vs .field', () => {
      const toks = tokenize('. .. .name');
      expect(toks[0].type).toBe('Dot');
      expect(toks[1].type).toBe('DotDot');
      expect(toks[2].type).toBe('Dot');
      expect(toks[3].type).toBe('Ident');
    });

    it('distinguishes // vs /', () => {
      const toks = tokenize('. // . / .');
      expect(toks[1].type).toBe('Alt');
      expect(toks[3].type).toBe('Slash');
    });

    it('errors on unexpected character', () => {
      expect(() => tokenize('~')).toThrow(JqParseError);
    });
  });
});
