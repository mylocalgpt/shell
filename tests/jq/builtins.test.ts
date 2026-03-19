import { describe, expect, it } from 'vitest';
import { jq } from '../../src/jq/index.js';

function run(input: string, filter: string, opts?: Parameters<typeof jq>[2]): string {
	return jq(input, filter, { compactOutput: true, ...opts });
}

describe('jq builtins (phase 4)', () => {
	describe('regex builtins', () => {
		it('test matches', () => {
			expect(run('"foobar"', 'test("foo")')).toBe('true');
			expect(run('"foobar"', 'test("^bar")')).toBe('false');
		});

		it('test with flags', () => {
			expect(run('"FOOBAR"', 'test("foo"; "i")')).toBe('true');
		});

		it('match returns match object', () => {
			const result = run('"foobar"', 'match("(foo)(bar)")');
			const parsed = JSON.parse(result);
			expect(parsed.string).toBe('foobar');
			expect(parsed.offset).toBe(0);
			expect(parsed.captures).toHaveLength(2);
		});

		it('capture returns named groups', () => {
			const result = run('"2024-01-15"', 'capture("(?<y>\\\\d{4})-(?<m>\\\\d{2})-(?<d>\\\\d{2})")');
			const parsed = JSON.parse(result);
			expect(parsed.y).toBe('2024');
			expect(parsed.m).toBe('01');
			expect(parsed.d).toBe('15');
		});

		it('scan finds all matches', () => {
			expect(run('"test 123 foo 456"', '[scan("[0-9]+")]')).toBe('["123","456"]');
		});

		it('sub replaces first match', () => {
			expect(run('"hello world"', 'sub("o"; "0")')).toBe('"hell0 world"');
		});

		it('gsub replaces all matches', () => {
			expect(run('"hello world"', 'gsub("o"; "0")')).toBe('"hell0 w0rld"');
		});
	});

	describe('format strings', () => {
		it('@base64 encodes', () => {
			expect(run('"hello"', '@base64')).toBe('"aGVsbG8="');
		});

		it('@base64d decodes', () => {
			expect(run('"aGVsbG8="', '@base64d')).toBe('"hello"');
		});

		it('@base64 round-trip', () => {
			expect(run('"hello world"', '@base64 | @base64d')).toBe('"hello world"');
		});

		it('@uri encodes', () => {
			expect(run('"hello world"', '@uri')).toBe('"hello%20world"');
		});

		it('@csv formats array', () => {
			expect(run('["a","b,c",1]', '@csv')).toBe('"\\"a\\",\\"b,c\\",1"');
		});

		it('@tsv formats array', () => {
			expect(run('["a","b","c"]', '@tsv')).toBe('"a\\tb\\tc"');
		});

		it('@json encodes', () => {
			expect(run('{"a":1}', '@json')).toBe('"{\\"a\\":1}"');
		});

		it('@html escapes', () => {
			expect(run('"<b>hi</b>"', '@html')).toBe('"&lt;b&gt;hi&lt;/b&gt;"');
		});

		it('@sh escapes', () => {
			expect(run('"hello world"', '@sh')).toBe('"\'hello world\'"');
		});

		it('@text passes through', () => {
			expect(run('"hello"', '@text')).toBe('"hello"');
		});
	});

	describe('date builtins', () => {
		it('todate converts timestamp', () => {
			expect(run('0', 'todate')).toBe('"1970-01-01T00:00:00Z"');
		});

		it('fromdate parses ISO date', () => {
			expect(run('"1970-01-01T00:00:00Z"', 'fromdate')).toBe('0');
		});

		it('strftime formats', () => {
			expect(run('0', 'strftime("%Y-%m-%d")')).toBe('"1970-01-01"');
		});

		it('gmtime returns broken-down time', () => {
			const result = run('0', 'gmtime');
			const parsed = JSON.parse(result);
			expect(parsed[0]).toBe(1970);
			expect(parsed[1]).toBe(0);
			expect(parsed[2]).toBe(1);
		});

		it('mktime converts back', () => {
			expect(run('[1970,0,1,0,0,0]', 'mktime')).toBe('0');
		});

		it('now returns a number', () => {
			const result = run('null', 'now', { nullInput: true });
			expect(Number(result)).toBeGreaterThan(0);
		});
	});

	describe('additional builtins coverage', () => {
		it('group_by groups correctly', () => {
			expect(run('[{"a":1},{"a":2},{"a":1}]', 'group_by(.a)')).toBe(
				'[[{"a":1},{"a":1}],[{"a":2}]]',
			);
		});

		it('sort_by sorts', () => {
			expect(run('[{"a":3},{"a":1},{"a":2}]', 'sort_by(.a)')).toBe('[{"a":1},{"a":2},{"a":3}]');
		});

		it('unique_by deduplicates', () => {
			expect(run('[{"a":1,"b":1},{"a":2,"b":2},{"a":1,"b":3}]', '[unique_by(.a)[] | .b]')).toBe(
				'[1,2]',
			);
		});

		it('min_by/max_by', () => {
			expect(run('[{"a":3},{"a":1},{"a":2}]', 'min_by(.a).a')).toBe('1');
			expect(run('[{"a":3},{"a":1},{"a":2}]', 'max_by(.a).a')).toBe('3');
		});

		it('indices finds all occurrences', () => {
			expect(run('"abcabc"', 'indices("bc")')).toBe('[1,4]');
		});

		it('index/rindex', () => {
			expect(run('"abcabc"', 'index("bc")')).toBe('1');
			expect(run('"abcabc"', 'rindex("bc")')).toBe('4');
		});

		it('any/all', () => {
			expect(run('[true,false]', 'any')).toBe('true');
			expect(run('[true,false]', 'all')).toBe('false');
			expect(run('[true,true]', 'all')).toBe('true');
		});

		it('while loop', () => {
			expect(run('1', '[while(. < 10; . * 2)]')).toBe('[1,2,4,8]');
		});

		it('until loop', () => {
			expect(run('1', 'until(. >= 10; . * 2)')).toBe('16');
		});

		it('recurse', () => {
			expect(run('2', '[recurse(. * 2; . < 20)]')).toBe('[2,4,8,16]');
		});

		it('isempty', () => {
			expect(run('null', 'isempty(empty)', { nullInput: true })).toBe('true');
			expect(run('null', 'isempty(1)', { nullInput: true })).toBe('false');
		});

		it('paths', () => {
			const result = run('{"a":1,"b":{"c":2}}', '[paths]');
			expect(result).toContain('["a"]');
			expect(result).toContain('["b"]');
			expect(result).toContain('["b","c"]');
		});

		it('leaf_paths', () => {
			const result = run('{"a":1,"b":{"c":2}}', '[leaf_paths]');
			expect(result).toContain('["a"]');
			expect(result).toContain('["b","c"]');
			expect(result).not.toContain('["b"]');
		});

		it('map_values', () => {
			expect(run('{"a":1,"b":2}', 'map_values(. + 10)')).toBe('{"a":11,"b":12}');
		});

		it('delpaths', () => {
			expect(run('{"a":1,"b":2,"c":3}', 'delpaths([["a"],["c"]])')).toBe('{"b":2}');
		});

		it('transpose', () => {
			expect(run('[[1,2],[3,4]]', 'transpose')).toBe('[[1,3],[2,4]]');
		});

		it('combinations', () => {
			expect(run('[[1,2],[3,4]]', '[combinations]')).toBe('[[1,3],[1,4],[2,3],[2,4]]');
		});

		it('ascii_downcase/upcase', () => {
			expect(run('"Hello"', 'ascii_downcase')).toBe('"hello"');
			expect(run('"hello"', 'ascii_upcase')).toBe('"HELLO"');
		});

		it('explode/implode', () => {
			expect(run('"abc"', 'explode')).toBe('[97,98,99]');
			expect(run('[97,98,99]', 'implode')).toBe('"abc"');
		});

		it('type selectors', () => {
			expect(run('1', 'numbers')).toBe('1');
			expect(run('"hi"', 'numbers')).toBe('');
			expect(run('"hi"', 'strings')).toBe('"hi"');
			expect(run('null', 'nulls')).toBe('null');
			expect(run('[1]', 'arrays')).toBe('[1]');
			expect(run('1', 'scalars')).toBe('1');
			expect(run('[1]', 'scalars')).toBe('');
		});

		it('pick', () => {
			expect(run('{"a":1,"b":2,"c":3}', 'pick(.a, .c)')).toBe('{"a":1,"c":3}');
		});
	});
});
