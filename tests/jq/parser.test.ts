import { describe, expect, it } from 'vitest';
import type { JqNode } from '../../src/jq/ast.js';
import { JqParseError } from '../../src/jq/errors.js';
import { parseJq } from '../../src/jq/parser.js';

describe('jq parser', () => {
  describe('identity and field access', () => {
    it('parses identity', () => {
      const ast = parseJq('.');
      expect(ast.type).toBe('Identity');
    });

    it('parses field access', () => {
      const ast = parseJq('.name');
      expect(ast.type).toBe('Field');
      if (ast.type === 'Field') {
        expect(ast.name).toBe('name');
      }
    });

    it('parses nested field access', () => {
      const ast = parseJq('.a.b');
      expect(ast.type).toBe('Pipe');
      if (ast.type === 'Pipe') {
        expect(ast.left.type).toBe('Field');
        expect(ast.right.type).toBe('Field');
      }
    });

    it('parses quoted field access', () => {
      const ast = parseJq('."field name"');
      expect(ast.type).toBe('Field');
      if (ast.type === 'Field') {
        expect(ast.name).toBe('field name');
      }
    });

    it('parses recursive descent', () => {
      const ast = parseJq('..');
      expect(ast.type).toBe('RecursiveDescent');
    });
  });

  describe('iteration and indexing', () => {
    it('parses .[]', () => {
      const ast = parseJq('.[]');
      expect(ast.type).toBe('Iterate');
    });

    it('parses .[0]', () => {
      const ast = parseJq('.[0]');
      expect(ast.type).toBe('Index');
      if (ast.type === 'Index') {
        expect(ast.index.type).toBe('Literal');
      }
    });

    it('parses .[2:5]', () => {
      const ast = parseJq('.[2:5]');
      expect(ast.type).toBe('Slice');
      if (ast.type === 'Slice') {
        expect(ast.from).not.toBeNull();
        expect(ast.to).not.toBeNull();
      }
    });

    it('parses .[:3]', () => {
      const ast = parseJq('.[:3]');
      expect(ast.type).toBe('Slice');
      if (ast.type === 'Slice') {
        expect(ast.from).toBeNull();
      }
    });

    it('parses .[2:]', () => {
      const ast = parseJq('.[2:]');
      expect(ast.type).toBe('Slice');
      if (ast.type === 'Slice') {
        expect(ast.to).toBeNull();
      }
    });
  });

  describe('pipe and comma', () => {
    it('parses pipe', () => {
      const ast = parseJq('.[] | .name');
      expect(ast.type).toBe('Pipe');
    });

    it('parses comma', () => {
      const ast = parseJq('.a, .b');
      expect(ast.type).toBe('Comma');
    });

    it('pipe binds looser than comma', () => {
      // .a, .b | .c should be (.a, .b) | .c
      const ast = parseJq('.a, .b | .c');
      expect(ast.type).toBe('Pipe');
      if (ast.type === 'Pipe') {
        expect(ast.left.type).toBe('Comma');
      }
    });
  });

  describe('literals', () => {
    it('parses number', () => {
      const ast = parseJq('42');
      expect(ast.type).toBe('Literal');
      if (ast.type === 'Literal') {
        expect(ast.value).toBe(42);
      }
    });

    it('parses string', () => {
      const ast = parseJq('"hello"');
      expect(ast.type).toBe('Literal');
      if (ast.type === 'Literal') {
        expect(ast.value).toBe('hello');
      }
    });

    it('parses true', () => {
      const ast = parseJq('true');
      expect(ast.type).toBe('Literal');
      if (ast.type === 'Literal') {
        expect(ast.value).toBe(true);
      }
    });

    it('parses false', () => {
      const ast = parseJq('false');
      expect(ast.type).toBe('Literal');
      if (ast.type === 'Literal') {
        expect(ast.value).toBe(false);
      }
    });

    it('parses null', () => {
      const ast = parseJq('null');
      expect(ast.type).toBe('Literal');
      if (ast.type === 'Literal') {
        expect(ast.value).toBeNull();
      }
    });
  });

  describe('array and object construction', () => {
    it('parses empty array', () => {
      const ast = parseJq('[]');
      expect(ast.type).toBe('ArrayConstruction');
      if (ast.type === 'ArrayConstruction') {
        expect(ast.expr).toBeNull();
      }
    });

    it('parses array with expression', () => {
      const ast = parseJq('[.[] | . * 2]');
      expect(ast.type).toBe('ArrayConstruction');
      if (ast.type === 'ArrayConstruction') {
        expect(ast.expr).not.toBeNull();
      }
    });

    it('parses empty object', () => {
      const ast = parseJq('{}');
      expect(ast.type).toBe('ObjectConstruction');
      if (ast.type === 'ObjectConstruction') {
        expect(ast.entries).toHaveLength(0);
      }
    });

    it('parses object with entries', () => {
      const ast = parseJq('{name: .name, age: .age}');
      expect(ast.type).toBe('ObjectConstruction');
      if (ast.type === 'ObjectConstruction') {
        expect(ast.entries).toHaveLength(2);
      }
    });

    it('parses object with shorthand', () => {
      const ast = parseJq('{name, age}');
      expect(ast.type).toBe('ObjectConstruction');
      if (ast.type === 'ObjectConstruction') {
        expect(ast.entries).toHaveLength(2);
        // Shorthand: {name} -> {name: .name}
        expect(ast.entries[0].value).not.toBeNull();
        if (ast.entries[0].value) {
          expect(ast.entries[0].value.type).toBe('Field');
        }
      }
    });

    it('parses object with computed key', () => {
      const ast = parseJq('{(.name): .value}');
      expect(ast.type).toBe('ObjectConstruction');
      if (ast.type === 'ObjectConstruction') {
        expect(ast.entries[0].computed).toBe(true);
      }
    });
  });

  describe('arithmetic operators', () => {
    it('parses addition', () => {
      const ast = parseJq('.a + .b');
      expect(ast.type).toBe('Arithmetic');
      if (ast.type === 'Arithmetic') {
        expect(ast.op).toBe('+');
      }
    });

    it('parses subtraction', () => {
      const ast = parseJq('.a - .b');
      expect(ast.type).toBe('Arithmetic');
      if (ast.type === 'Arithmetic') {
        expect(ast.op).toBe('-');
      }
    });

    it('parses multiplication', () => {
      const ast = parseJq('.a * .b');
      expect(ast.type).toBe('Arithmetic');
      if (ast.type === 'Arithmetic') {
        expect(ast.op).toBe('*');
      }
    });

    it('multiplication binds tighter than addition', () => {
      const ast = parseJq('.a + .b * .c');
      expect(ast.type).toBe('Arithmetic');
      if (ast.type === 'Arithmetic') {
        expect(ast.op).toBe('+');
        expect(ast.right.type).toBe('Arithmetic');
      }
    });
  });

  describe('comparison operators', () => {
    it('parses ==', () => {
      const ast = parseJq('.a == .b');
      expect(ast.type).toBe('Comparison');
      if (ast.type === 'Comparison') {
        expect(ast.op).toBe('==');
      }
    });

    it('parses !=', () => {
      const ast = parseJq('.a != .b');
      expect(ast.type).toBe('Comparison');
    });

    it('parses <, >, <=, >=', () => {
      for (const op of ['<', '>', '<=', '>=']) {
        const ast = parseJq(`.a ${op} .b`);
        expect(ast.type).toBe('Comparison');
      }
    });
  });

  describe('logic operators', () => {
    it('parses and', () => {
      const ast = parseJq('.a and .b');
      expect(ast.type).toBe('Logic');
      if (ast.type === 'Logic') {
        expect(ast.op).toBe('and');
      }
    });

    it('parses or', () => {
      const ast = parseJq('.a or .b');
      expect(ast.type).toBe('Logic');
      if (ast.type === 'Logic') {
        expect(ast.op).toBe('or');
      }
    });

    it('parses not as function call', () => {
      const ast = parseJq('not');
      expect(ast.type).toBe('FunctionCall');
      if (ast.type === 'FunctionCall') {
        expect(ast.name).toBe('not');
      }
    });
  });

  describe('alternative operator', () => {
    it('parses //', () => {
      const ast = parseJq('.a // .b');
      expect(ast.type).toBe('Alternative');
    });

    it('alternative binds looser than comparison', () => {
      const ast = parseJq('.a == 1 // .b');
      expect(ast.type).toBe('Alternative');
      if (ast.type === 'Alternative') {
        expect(ast.left.type).toBe('Comparison');
      }
    });
  });

  describe('update operators', () => {
    it('parses |=', () => {
      const ast = parseJq('.a |= . + 1');
      expect(ast.type).toBe('Update');
    });

    it('parses +=', () => {
      const ast = parseJq('.a += 1');
      expect(ast.type).toBe('UpdateOp');
      if (ast.type === 'UpdateOp') {
        expect(ast.op).toBe('+=');
      }
    });

    it('parses //=', () => {
      const ast = parseJq('.a //= "default"');
      expect(ast.type).toBe('UpdateOp');
      if (ast.type === 'UpdateOp') {
        expect(ast.op).toBe('//=');
      }
    });
  });

  describe('unary operators', () => {
    it('parses negation', () => {
      const ast = parseJq('-.a');
      expect(ast.type).toBe('Negate');
    });
  });

  describe('optional operator', () => {
    it('parses ?', () => {
      const ast = parseJq('.a?');
      expect(ast.type).toBe('Optional');
      if (ast.type === 'Optional') {
        expect(ast.expr.type).toBe('Field');
      }
    });

    it('parses .[]?', () => {
      const ast = parseJq('.[]?');
      expect(ast.type).toBe('Optional');
    });
  });

  describe('control flow', () => {
    it('parses if/then/end', () => {
      const ast = parseJq('if . > 0 then "positive" end');
      expect(ast.type).toBe('If');
      if (ast.type === 'If') {
        expect(ast.else).toBeNull();
      }
    });

    it('parses if/then/else/end', () => {
      const ast = parseJq('if . > 0 then "positive" else "non-positive" end');
      expect(ast.type).toBe('If');
      if (ast.type === 'If') {
        expect(ast.else).not.toBeNull();
      }
    });

    it('parses if/elif/else/end', () => {
      const ast = parseJq('if . > 0 then "pos" elif . < 0 then "neg" else "zero" end');
      expect(ast.type).toBe('If');
      if (ast.type === 'If') {
        expect(ast.elifs).toHaveLength(1);
        expect(ast.else).not.toBeNull();
      }
    });

    it('parses try', () => {
      const ast = parseJq('try .a');
      expect(ast.type).toBe('TryCatch');
      if (ast.type === 'TryCatch') {
        expect(ast.catch).toBeNull();
      }
    });

    it('parses try/catch', () => {
      const ast = parseJq('try .a catch "error"');
      expect(ast.type).toBe('TryCatch');
      if (ast.type === 'TryCatch') {
        expect(ast.catch).not.toBeNull();
      }
    });
  });

  describe('reduce and foreach', () => {
    it('parses reduce', () => {
      const ast = parseJq('reduce .[] as $x (0; . + $x)');
      expect(ast.type).toBe('Reduce');
      if (ast.type === 'Reduce') {
        expect(ast.variable).toBe('x');
      }
    });

    it('parses foreach', () => {
      const ast = parseJq('foreach .[] as $x (0; . + $x)');
      expect(ast.type).toBe('Foreach');
      if (ast.type === 'Foreach') {
        expect(ast.variable).toBe('x');
        expect(ast.extract).toBeNull();
      }
    });

    it('parses foreach with extract', () => {
      const ast = parseJq('foreach .[] as $x (0; . + $x; . * 2)');
      expect(ast.type).toBe('Foreach');
      if (ast.type === 'Foreach') {
        expect(ast.extract).not.toBeNull();
      }
    });
  });

  describe('label and break', () => {
    it('parses label', () => {
      const ast = parseJq('label $out | .[]');
      expect(ast.type).toBe('Label');
      if (ast.type === 'Label') {
        expect(ast.name).toBe('out');
      }
    });

    it('parses break', () => {
      const ast = parseJq('break $out');
      expect(ast.type).toBe('Break');
      if (ast.type === 'Break') {
        expect(ast.name).toBe('out');
      }
    });
  });

  describe('function definitions', () => {
    it('parses simple def', () => {
      const ast = parseJq('def double: . * 2; double');
      expect(ast.type).toBe('FunctionDef');
      if (ast.type === 'FunctionDef') {
        expect(ast.name).toBe('double');
        expect(ast.params).toHaveLength(0);
      }
    });

    it('parses def with params', () => {
      const ast = parseJq('def add(x; y): x + y; add(1; 2)');
      expect(ast.type).toBe('FunctionDef');
      if (ast.type === 'FunctionDef') {
        expect(ast.name).toBe('add');
        expect(ast.params).toEqual(['x', 'y']);
      }
    });

    it('parses nested defs', () => {
      const ast = parseJq('def a: def b: .; b; a');
      expect(ast.type).toBe('FunctionDef');
      if (ast.type === 'FunctionDef') {
        expect(ast.body.type).toBe('FunctionDef');
      }
    });
  });

  describe('function calls', () => {
    it('parses zero-arg call', () => {
      const ast = parseJq('length');
      expect(ast.type).toBe('FunctionCall');
      if (ast.type === 'FunctionCall') {
        expect(ast.name).toBe('length');
        expect(ast.args).toHaveLength(0);
      }
    });

    it('parses call with args', () => {
      const ast = parseJq('map(. + 1)');
      expect(ast.type).toBe('FunctionCall');
      if (ast.type === 'FunctionCall') {
        expect(ast.name).toBe('map');
        expect(ast.args).toHaveLength(1);
      }
    });

    it('parses call with multiple args', () => {
      const ast = parseJq('sub("a"; "b")');
      expect(ast.type).toBe('FunctionCall');
      if (ast.type === 'FunctionCall') {
        expect(ast.name).toBe('sub');
        expect(ast.args).toHaveLength(2);
      }
    });
  });

  describe('variable binding', () => {
    it('parses as binding', () => {
      const ast = parseJq('.name as $n | $n');
      expect(ast.type).toBe('VariableBinding');
      if (ast.type === 'VariableBinding') {
        expect(ast.pattern).toEqual({ kind: 'variable', name: 'n' });
      }
    });

    it('parses destructuring array', () => {
      const ast = parseJq('. as [$a, $b] | $a');
      expect(ast.type).toBe('VariableBinding');
      if (ast.type === 'VariableBinding') {
        expect(ast.pattern.kind).toBe('array');
      }
    });

    it('parses destructuring object', () => {
      const ast = parseJq('. as {name: $n, age: $a} | $n');
      expect(ast.type).toBe('VariableBinding');
      if (ast.type === 'VariableBinding') {
        expect(ast.pattern.kind).toBe('object');
      }
    });
  });

  describe('string interpolation', () => {
    it('parses string with interpolation', () => {
      const ast = parseJq('"hello \\(.name)"');
      expect(ast.type).toBe('StringInterpolation');
      if (ast.type === 'StringInterpolation') {
        expect(ast.parts.length).toBeGreaterThan(1);
      }
    });

    it('parses plain string without interpolation', () => {
      const ast = parseJq('"hello"');
      expect(ast.type).toBe('Literal');
    });
  });

  describe('format strings', () => {
    it('parses standalone format', () => {
      const ast = parseJq('@base64');
      expect(ast.type).toBe('Format');
      if (ast.type === 'Format') {
        expect(ast.name).toBe('base64');
        expect(ast.str).toBeNull();
      }
    });

    it('parses format with string', () => {
      const ast = parseJq('@base64 "hello"');
      expect(ast.type).toBe('Format');
      if (ast.type === 'Format') {
        expect(ast.name).toBe('base64');
        expect(ast.str).not.toBeNull();
      }
    });
  });

  describe('variables', () => {
    it('parses variable reference', () => {
      const ast = parseJq('$x');
      expect(ast.type).toBe('Variable');
      if (ast.type === 'Variable') {
        expect(ast.name).toBe('x');
      }
    });

    it('parses $ENV', () => {
      const ast = parseJq('$ENV');
      expect(ast.type).toBe('Variable');
      if (ast.type === 'Variable') {
        expect(ast.name).toBe('ENV');
      }
    });
  });

  describe('grouping', () => {
    it('parses parenthesized expression', () => {
      const ast = parseJq('(.a + .b) * .c');
      expect(ast.type).toBe('Arithmetic');
      if (ast.type === 'Arithmetic') {
        expect(ast.op).toBe('*');
      }
    });
  });

  describe('complex expressions', () => {
    it('parses select filter', () => {
      const ast = parseJq('[.[] | select(. > 3)]');
      expect(ast.type).toBe('ArrayConstruction');
    });

    it('parses map', () => {
      const ast = parseJq('map(. * 2)');
      expect(ast.type).toBe('FunctionCall');
      if (ast.type === 'FunctionCall') {
        expect(ast.name).toBe('map');
      }
    });

    it('parses to_entries | from_entries', () => {
      const ast = parseJq('to_entries | from_entries');
      expect(ast.type).toBe('Pipe');
    });

    it('parses complex real-world filter', () => {
      const ast = parseJq('[.[] | select(.age > 28) | .name]');
      expect(ast.type).toBe('ArrayConstruction');
    });
  });

  describe('error handling', () => {
    it('rejects import', () => {
      expect(() => parseJq('import "foo"')).toThrow(JqParseError);
      expect(() => parseJq('import "foo"')).toThrow('import/include not supported');
    });

    it('rejects include', () => {
      expect(() => parseJq('include "foo"')).toThrow(JqParseError);
      expect(() => parseJq('include "foo"')).toThrow('import/include not supported');
    });

    it('reports position on error', () => {
      try {
        parseJq('. | }');
        expect.unreachable('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(JqParseError);
        if (e instanceof JqParseError) {
          expect(e.position).toBeDefined();
        }
      }
    });

    it('rejects unexpected tokens', () => {
      expect(() => parseJq('.')).not.toThrow();
      expect(() => parseJq('. .')).toThrow(JqParseError);
    });
  });

  describe('operator precedence', () => {
    it('pipe binds loosest', () => {
      const ast = parseJq('.a + .b | .c');
      expect(ast.type).toBe('Pipe');
    });

    it('comma binds above pipe', () => {
      const ast = parseJq('.a | .b, .c');
      expect(ast.type).toBe('Pipe');
      if (ast.type === 'Pipe') {
        expect(ast.right.type).toBe('Comma');
      }
    });

    it('comparison binds below addition', () => {
      const ast = parseJq('.a + 1 == 3');
      expect(ast.type).toBe('Comparison');
      if (ast.type === 'Comparison') {
        expect(ast.left.type).toBe('Arithmetic');
      }
    });
  });
});
