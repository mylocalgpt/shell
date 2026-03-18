import { describe, expect, it } from 'vitest';
import { jq } from '../../src/jq/index.js';

function run(input: string, filter: string, opts?: Parameters<typeof jq>[2]): string {
	return jq(input, filter, { compactOutput: true, ...opts });
}

describe('jq control flow', () => {
	describe('if/then/else', () => {
		it('evaluates then branch when truthy', () => {
			expect(run('true', 'if . then "yes" else "no" end')).toBe('"yes"');
		});

		it('evaluates else branch when falsy', () => {
			expect(run('false', 'if . then "yes" else "no" end')).toBe('"no"');
		});

		it('null is falsy', () => {
			expect(run('null', 'if . then "yes" else "no" end')).toBe('"no"');
		});

		it('numbers are truthy', () => {
			expect(run('0', 'if . then "yes" else "no" end')).toBe('"yes"');
		});

		it('if without else yields input', () => {
			expect(run('42', 'if true then "yes" end')).toBe('"yes"');
			expect(run('42', 'if false then "yes" end')).toBe('42');
		});

		it('elif chains', () => {
			expect(run('1', 'if . > 5 then "big" elif . > 0 then "small" else "zero" end')).toBe(
				'"small"',
			);
		});

		it('comparison in condition', () => {
			expect(run('3', 'if . > 2 then "yes" else "no" end')).toBe('"yes"');
		});
	});

	describe('try/catch', () => {
		it('catches errors', () => {
			expect(run('null', 'try (.[] | .) catch "caught"')).toBe('"caught"');
		});

		it('try without catch yields nothing on error', () => {
			expect(run('null', 'try .[]')).toBe('');
		});

		it('passes through on no error', () => {
			expect(run('[1,2]', 'try .[]')).toBe('1\n2');
		});
	});

	describe('reduce', () => {
		it('sums array', () => {
			expect(run('[1,2,3]', 'reduce .[] as $x (0; . + $x)')).toBe('6');
		});

		it('concatenates strings', () => {
			expect(run('["a","b","c"]', 'reduce .[] as $x (""; . + $x)')).toBe('"abc"');
		});

		it('builds object', () => {
			expect(
				run('[{"k":"a","v":1},{"k":"b","v":2}]', 'reduce .[] as $x ({}; . + {($x.k): $x.v})'),
			).toBe('{"a":1,"b":2}');
		});
	});

	describe('foreach', () => {
		it('yields accumulator at each step', () => {
			expect(run('null', 'foreach range(3) as $x (0; . + $x)', { nullInput: true })).toBe(
				'0\n1\n3',
			);
		});

		it('with extract clause', () => {
			expect(run('null', 'foreach range(3) as $x (0; . + $x; . * 2)', { nullInput: true })).toBe(
				'0\n2\n6',
			);
		});
	});

	describe('label/break', () => {
		it('breaks out of foreach', () => {
			// label $out | foreach .[] as $x (0; . + $x; if . > 3 then ., break $out else . end)
			expect(
				run(
					'[1,2,3,4,5]',
					'label $out | foreach .[] as $x (0; . + $x; if . > 3 then ., break $out else . end)',
				),
			).toBe('1\n3\n6');
		});
	});

	describe('variable binding', () => {
		it('binds simple variable', () => {
			expect(run('{"name":"alice"}', '.name as $n | "hello " + $n')).toBe('"hello alice"');
		});

		it('nested bindings', () => {
			expect(run('5', '. as $a | (. + 1) as $b | $a + $b')).toBe('11');
		});

		it('array destructuring', () => {
			expect(run('[1,2]', '. as [$a, $b] | $a + $b')).toBe('3');
		});

		it('object destructuring', () => {
			expect(run('{"x":10,"y":20}', '. as {x: $x, y: $y} | $x + $y')).toBe('30');
		});
	});

	describe('user functions', () => {
		it('defines and calls function', () => {
			expect(run('5', 'def double: . * 2; double')).toBe('10');
		});

		it('function with params as closures', () => {
			expect(run('5', 'def addone(f): f + 1; addone(. * 2)')).toBe('11');
		});

		it('recursive function', () => {
			expect(run('5', 'def fact: if . <= 1 then 1 else . * ((. - 1) | fact) end; fact')).toBe(
				'120',
			);
		});

		it('nested defs', () => {
			expect(run('3', 'def a: def b: . * 2; b + 1; a')).toBe('7');
		});

		it('recursion depth limit', () => {
			expect(() => run('0', 'def inf: inf; inf', { limits: { maxCallDepth: 10 } })).toThrow(
				'maximum call depth exceeded',
			);
		});
	});

	describe('update operators', () => {
		it('|= updates field', () => {
			expect(run('{"a":1}', '.a |= . + 10')).toBe('{"a":11}');
		});

		it('+= adds to field', () => {
			expect(run('{"a":1,"b":2}', '.a += .b')).toBe('{"a":3,"b":2}');
		});

		it('-= subtracts', () => {
			expect(run('{"a":5}', '.a -= 3')).toBe('{"a":2}');
		});

		it('|= on array elements', () => {
			expect(run('[1,2,3]', '.[] |= . * 2')).toBe('[2,4,6]');
		});

		it('//= sets default', () => {
			expect(run('{"a":null}', '.a //= 42')).toBe('{"a":42}');
		});

		it('nested path update', () => {
			expect(run('{"a":{"b":1}}', '.a.b |= . + 10')).toBe('{"a":{"b":11}}');
		});
	});

	describe('builtins (essential)', () => {
		it('length on string', () => {
			expect(run('"hello"', 'length')).toBe('5');
		});

		it('length on array', () => {
			expect(run('[1,2,3]', 'length')).toBe('3');
		});

		it('length on object', () => {
			expect(run('{"a":1,"b":2}', 'length')).toBe('2');
		});

		it('keys', () => {
			expect(run('{"b":2,"a":1}', 'keys')).toBe('["a","b"]');
		});

		it('values', () => {
			expect(run('{"a":1,"b":2}', 'values')).toBe('[1,2]');
		});

		it('type', () => {
			expect(run('42', 'type')).toBe('"number"');
			expect(run('"hi"', 'type')).toBe('"string"');
			expect(run('null', 'type')).toBe('"null"');
		});

		it('empty yields nothing', () => {
			expect(run('null', 'empty')).toBe('');
		});

		it('not', () => {
			expect(run('true', 'not')).toBe('false');
			expect(run('false', 'not')).toBe('true');
			expect(run('null', 'not')).toBe('true');
		});

		it('map', () => {
			expect(run('[1,2,3]', 'map(. * 2)')).toBe('[2,4,6]');
		});

		it('select', () => {
			expect(run('[1,2,3,4,5]', '[.[] | select(. > 3)]')).toBe('[4,5]');
		});

		it('add', () => {
			expect(run('[1,2,3]', 'add')).toBe('6');
			expect(run('["a","b"]', 'add')).toBe('"ab"');
		});

		it('sort', () => {
			expect(run('[3,1,2]', 'sort')).toBe('[1,2,3]');
		});

		it('reverse', () => {
			expect(run('[1,2,3]', 'reverse')).toBe('[3,2,1]');
		});

		it('unique', () => {
			expect(run('[1,2,1,3,2]', 'unique')).toBe('[1,2,3]');
		});

		it('flatten', () => {
			expect(run('[[1,[2]],3]', 'flatten')).toBe('[1,2,3]');
		});

		it('range', () => {
			expect(run('null', '[range(3)]', { nullInput: true })).toBe('[0,1,2]');
			expect(run('null', '[range(1;4)]', { nullInput: true })).toBe('[1,2,3]');
		});

		it('to_entries/from_entries', () => {
			expect(run('{"a":1}', 'to_entries')).toBe('[{"key":"a","value":1}]');
			expect(run('[{"key":"a","value":1}]', 'from_entries')).toBe('{"a":1}');
		});

		it('has', () => {
			expect(run('{"a":1}', 'has("a")')).toBe('true');
			expect(run('{"a":1}', 'has("b")')).toBe('false');
		});

		it('contains', () => {
			expect(run('[1,2,3]', 'contains([2,3])')).toBe('true');
			expect(run('[1,2]', 'contains([3])')).toBe('false');
		});

		it('tostring/tonumber', () => {
			expect(run('42', 'tostring')).toBe('"42"');
			expect(run('"42"', 'tonumber')).toBe('42');
		});

		it('tojson/fromjson', () => {
			expect(run('{"a":1}', 'tojson')).toBe('"{\\"a\\":1}"');
			expect(run('"{\\"a\\":1}"', 'fromjson')).toBe('{"a":1}');
		});

		it('split/join', () => {
			expect(run('"a,b,c"', 'split(",")')).toBe('["a","b","c"]');
			expect(run('["a","b","c"]', 'join(",")')).toBe('"a,b,c"');
		});

		it('ascii_downcase/ascii_upcase', () => {
			expect(run('"Hello"', 'ascii_downcase')).toBe('"hello"');
			expect(run('"hello"', 'ascii_upcase')).toBe('"HELLO"');
		});

		it('startswith/endswith', () => {
			expect(run('"hello"', 'startswith("hel")')).toBe('true');
			expect(run('"hello"', 'endswith("llo")')).toBe('true');
		});

		it('ltrimstr/rtrimstr', () => {
			expect(run('"hello"', 'ltrimstr("hel")')).toBe('"lo"');
			expect(run('"hello"', 'rtrimstr("llo")')).toBe('"he"');
		});

		it('floor/ceil/round', () => {
			expect(run('3.7', 'floor')).toBe('3');
			expect(run('3.2', 'ceil')).toBe('4');
			expect(run('3.5', 'round')).toBe('4');
		});

		it('del', () => {
			expect(run('{"a":1,"b":2}', 'del(.a)')).toBe('{"b":2}');
		});

		it('getpath/setpath', () => {
			expect(run('{"a":{"b":1}}', 'getpath(["a","b"])')).toBe('1');
			expect(run('{"a":{"b":1}}', 'setpath(["a","b"]; 99)')).toBe('{"a":{"b":99}}');
		});

		it('path', () => {
			expect(run('{"a":1,"b":2}', '[path(.a)]')).toBe('[["a"]]');
		});

		it('with_entries', () => {
			expect(run('{"a":1,"b":2}', 'with_entries(select(.value > 1))')).toBe('{"b":2}');
		});

		it('first/last', () => {
			expect(run('null', 'first(range(5))', { nullInput: true })).toBe('0');
			expect(run('null', 'last(range(5))', { nullInput: true })).toBe('4');
		});

		it('limit', () => {
			expect(run('null', '[limit(3; range(10))]', { nullInput: true })).toBe('[0,1,2]');
		});

		it('walk', () => {
			expect(run('{"a":1,"b":[2,3]}', 'walk(if type == "number" then . * 2 else . end)')).toBe(
				'{"a":2,"b":[4,6]}',
			);
		});
	});
});
