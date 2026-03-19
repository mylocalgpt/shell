import { describe, expect, it } from 'vitest';
import { jq } from '../../src/jq/index.js';

/** Helper: run jq and return trimmed output. */
function run(input: string, filter: string, opts?: Parameters<typeof jq>[2]): string {
  return jq(input, filter, { compactOutput: true, ...opts });
}

describe('jq evaluator', () => {
  describe('identity', () => {
    it('passes through number', () => {
      expect(run('42', '.')).toBe('42');
    });

    it('passes through string', () => {
      expect(run('"hello"', '.')).toBe('"hello"');
    });

    it('passes through object', () => {
      expect(run('{"a":1}', '.')).toBe('{"a":1}');
    });

    it('passes through array', () => {
      expect(run('[1,2,3]', '.')).toBe('[1,2,3]');
    });

    it('passes through null', () => {
      expect(run('null', '.')).toBe('null');
    });

    it('passes through boolean', () => {
      expect(run('true', '.')).toBe('true');
    });
  });

  describe('field access', () => {
    it('accesses named field', () => {
      expect(run('{"name":"alice"}', '.name')).toBe('"alice"');
    });

    it('returns null for missing field', () => {
      expect(run('{"a":1}', '.b')).toBe('null');
    });

    it('returns null for null input', () => {
      expect(run('null', '.name')).toBe('null');
    });

    it('accesses nested field', () => {
      expect(run('{"a":{"b":42}}', '.a.b')).toBe('42');
    });

    it('accesses quoted field', () => {
      expect(run('{"hello world":1}', '."hello world"')).toBe('1');
    });
  });

  describe('array indexing', () => {
    it('indexes array', () => {
      expect(run('[10,20,30]', '.[1]')).toBe('20');
    });

    it('handles negative index', () => {
      expect(run('[10,20,30]', '.[-1]')).toBe('30');
    });

    it('returns null for out-of-bounds', () => {
      expect(run('[1,2]', '.[5]')).toBe('null');
    });

    it('returns null for null input', () => {
      expect(run('null', '.[0]')).toBe('null');
    });
  });

  describe('slicing', () => {
    it('slices array', () => {
      expect(run('[0,1,2,3,4]', '.[2:4]')).toBe('[2,3]');
    });

    it('slices with start only', () => {
      expect(run('[0,1,2,3,4]', '.[3:]')).toBe('[3,4]');
    });

    it('slices with end only', () => {
      expect(run('[0,1,2,3,4]', '.[:2]')).toBe('[0,1]');
    });

    it('slices string', () => {
      expect(run('"abcde"', '.[1:3]')).toBe('"bc"');
    });

    it('handles negative slice indices', () => {
      expect(run('[0,1,2,3,4]', '.[-2:]')).toBe('[3,4]');
    });
  });

  describe('iteration', () => {
    it('iterates array', () => {
      expect(run('[1,2,3]', '.[]')).toBe('1\n2\n3');
    });

    it('iterates object values', () => {
      const result = run('{"a":1,"b":2}', '.[]');
      // Object value order depends on insertion order
      expect(result).toBe('1\n2');
    });

    it('errors on scalar', () => {
      expect(() => run('42', '.[]')).toThrow('cannot iterate');
    });
  });

  describe('pipe', () => {
    it('pipes field access', () => {
      expect(run('{"a":{"b":1}}', '.a | .b')).toBe('1');
    });

    it('pipes iteration into field', () => {
      expect(run('[{"x":1},{"x":2}]', '.[] | .x')).toBe('1\n2');
    });
  });

  describe('comma', () => {
    it('produces multiple outputs', () => {
      expect(run('{"a":1,"b":2}', '.a, .b')).toBe('1\n2');
    });
  });

  describe('literals', () => {
    it('returns number literal', () => {
      expect(run('null', '42', { nullInput: true })).toBe('42');
    });

    it('returns string literal', () => {
      expect(run('null', '"hello"', { nullInput: true })).toBe('"hello"');
    });

    it('returns true', () => {
      expect(run('null', 'true', { nullInput: true })).toBe('true');
    });

    it('returns false', () => {
      expect(run('null', 'false', { nullInput: true })).toBe('false');
    });

    it('returns null', () => {
      expect(run('null', 'null', { nullInput: true })).toBe('null');
    });
  });

  describe('array construction', () => {
    it('constructs empty array', () => {
      expect(run('null', '[]', { nullInput: true })).toBe('[]');
    });

    it('collects iteration into array', () => {
      expect(run('[1,2,3]', '[.[] | . * 2]')).toBe('[2,4,6]');
    });

    it('collects comma into array', () => {
      expect(run('null', '[1, 2, 3]', { nullInput: true })).toBe('[1,2,3]');
    });
  });

  describe('object construction', () => {
    it('constructs object with values', () => {
      expect(run('{"a":1,"b":2}', '{x: .a, y: .b}')).toBe('{"x":1,"y":2}');
    });

    it('constructs object with shorthand', () => {
      expect(run('{"name":"alice","age":30}', '{name}')).toBe('{"name":"alice"}');
    });

    it('constructs object with computed key', () => {
      expect(run('{"key":"x","val":42}', '{(.key): .val}')).toBe('{"x":42}');
    });

    it('constructs empty object', () => {
      expect(run('null', '{}', { nullInput: true })).toBe('{}');
    });
  });

  describe('arithmetic', () => {
    it('adds numbers', () => {
      expect(run('null', '1 + 2', { nullInput: true })).toBe('3');
    });

    it('concatenates strings', () => {
      expect(run('null', '"hello" + " " + "world"', { nullInput: true })).toBe('"hello world"');
    });

    it('merges objects', () => {
      expect(run('null', '{"a":1} + {"b":2}', { nullInput: true })).toBe('{"a":1,"b":2}');
    });

    it('concatenates arrays', () => {
      expect(run('null', '[1,2] + [3,4]', { nullInput: true })).toBe('[1,2,3,4]');
    });

    it('subtracts numbers', () => {
      expect(run('null', '5 - 3', { nullInput: true })).toBe('2');
    });

    it('multiplies numbers', () => {
      expect(run('null', '3 * 4', { nullInput: true })).toBe('12');
    });

    it('divides numbers', () => {
      expect(run('null', '10 / 4', { nullInput: true })).toBe('2.5');
    });

    it('computes modulo', () => {
      expect(run('null', '7 % 3', { nullInput: true })).toBe('1');
    });

    it('null + value = value', () => {
      expect(run('null', 'null + 5', { nullInput: true })).toBe('5');
    });

    it('array subtraction removes elements', () => {
      expect(run('null', '[1,2,3,2,1] - [1,2]', { nullInput: true })).toBe('[3]');
    });

    it('string division splits', () => {
      expect(run('null', '"a,b,c" / ","', { nullInput: true })).toBe('["a","b","c"]');
    });
  });

  describe('comparison', () => {
    it('equals', () => {
      expect(run('null', '1 == 1', { nullInput: true })).toBe('true');
      expect(run('null', '1 == 2', { nullInput: true })).toBe('false');
    });

    it('not equals', () => {
      expect(run('null', '1 != 2', { nullInput: true })).toBe('true');
    });

    it('less than', () => {
      expect(run('null', '1 < 2', { nullInput: true })).toBe('true');
      expect(run('null', '2 < 1', { nullInput: true })).toBe('false');
    });

    it('string comparison', () => {
      expect(run('null', '"abc" < "abd"', { nullInput: true })).toBe('true');
    });

    it('cross-type comparison (jq ordering)', () => {
      // null < false < true < numbers < strings
      expect(run('null', 'null < false', { nullInput: true })).toBe('true');
      expect(run('null', 'false < true', { nullInput: true })).toBe('true');
      expect(run('null', 'true < 0', { nullInput: true })).toBe('true');
      expect(run('null', '0 < ""', { nullInput: true })).toBe('true');
    });
  });

  describe('logic', () => {
    it('and', () => {
      expect(run('null', 'true and true', { nullInput: true })).toBe('true');
      expect(run('null', 'true and false', { nullInput: true })).toBe('false');
      expect(run('null', 'null and true', { nullInput: true })).toBe('false');
    });

    it('or', () => {
      expect(run('null', 'false or true', { nullInput: true })).toBe('true');
      expect(run('null', 'false or false', { nullInput: true })).toBe('false');
      expect(run('null', 'null or true', { nullInput: true })).toBe('true');
    });
  });

  describe('alternative', () => {
    it('returns left when truthy', () => {
      expect(run('null', '1 // 2', { nullInput: true })).toBe('1');
    });

    it('returns right when left is null', () => {
      expect(run('null', 'null // "default"', { nullInput: true })).toBe('"default"');
    });

    it('returns right when left is false', () => {
      expect(run('null', 'false // "fallback"', { nullInput: true })).toBe('"fallback"');
    });
  });

  describe('optional', () => {
    it('suppresses errors', () => {
      expect(run('42', '.foo?')).toBe('');
    });

    it('passes through valid values', () => {
      expect(run('{"a":1}', '.a?')).toBe('1');
    });

    it('suppresses iteration error on scalar', () => {
      expect(run('42', '.[]?')).toBe('');
    });
  });

  describe('string interpolation', () => {
    it('interpolates field', () => {
      expect(run('{"name":"alice"}', '"Hello \\(.name)"')).toBe('"Hello alice"');
    });

    it('interpolates numbers', () => {
      expect(run('{"x":42}', '"value: \\(.x)"')).toBe('"value: 42"');
    });

    it('interpolates multiple expressions', () => {
      expect(run('{"a":"x","b":"y"}', '"\\(.a) and \\(.b)"')).toBe('"x and y"');
    });
  });

  describe('recursive descent', () => {
    it('yields all values', () => {
      const result = run('{"a":{"b":1},"c":[2,3]}', '..').split('\n');
      // Should include the root, nested objects/arrays, and all leaves
      expect(result.length).toBeGreaterThan(5);
    });

    it('yields scalars from array', () => {
      const result = run('[1,[2,[3]]]', '..').split('\n');
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });
  });

  describe('negation', () => {
    it('negates number', () => {
      expect(run('5', '-.')).toBe('-5');
    });

    it('errors on non-number', () => {
      expect(() => run('"hello"', '-.')).toThrow('cannot negate');
    });
  });

  describe('null propagation', () => {
    it('.missing.field returns null', () => {
      expect(run('{}', '.missing.field')).toBe('null');
    });

    it('.missing on null returns null', () => {
      expect(run('null', '.missing')).toBe('null');
    });
  });

  describe('variables', () => {
    it('uses --arg bindings', () => {
      expect(run('null', '$name', { nullInput: true, args: { name: 'alice' } })).toBe('"alice"');
    });

    it('uses --argjson bindings', () => {
      expect(run('null', '$val', { nullInput: true, argjson: { val: 42 } })).toBe('42');
    });
  });

  describe('output formatting', () => {
    it('pretty-prints by default', () => {
      const result = jq('{"a":1,"b":2}', '.');
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('compact output', () => {
      const result = jq('{"a":1,"b":2}', '.', { compactOutput: true });
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('raw output for strings', () => {
      const result = jq('"hello"', '.', { rawOutput: true });
      expect(result).toBe('hello');
    });

    it('sort keys', () => {
      const result = jq('{"b":2,"a":1}', '.', { compactOutput: true, sortKeys: true });
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('tab indentation', () => {
      const result = jq('{"a":1}', '.', { tab: true });
      expect(result).toContain('\t');
    });
  });

  describe('multiple inputs', () => {
    it('handles concatenated JSON', () => {
      const result = run('1\n2\n3', '.');
      expect(result).toBe('1\n2\n3');
    });

    it('handles concatenated objects', () => {
      const result = run('{"a":1}{"b":2}', '.', { compactOutput: true });
      expect(result).toBe('{"a":1}\n{"b":2}');
    });
  });

  describe('slurp', () => {
    it('collects inputs into array', () => {
      expect(run('1\n2\n3', '.', { slurp: true })).toBe('[1,2,3]');
    });
  });

  describe('null input', () => {
    it('uses null as input', () => {
      expect(run('', '.', { nullInput: true })).toBe('null');
    });
  });

  describe('format strings', () => {
    it('@json formats value', () => {
      expect(run('"hello"', '@json')).toBe('"\\"hello\\""');
    });

    it('@text returns string as-is', () => {
      expect(run('"hello"', '@text')).toBe('"hello"');
    });

    it('@html escapes HTML', () => {
      expect(run('"<b>hi</b>"', '@html')).toBe('"&lt;b&gt;hi&lt;/b&gt;"');
    });
  });
});
