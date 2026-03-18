import { describe, expect, it } from 'vitest';
import { InMemoryFs } from '../../src/fs/memory.js';
import { expandBraces, globExpand, globMatch, globMatchPath } from '../../src/utils/glob.js';

describe('globMatch', () => {
	it('matches exact string', () => {
		expect(globMatch('hello', 'hello')).toBe(true);
	});

	it('rejects different string', () => {
		expect(globMatch('hello', 'world')).toBe(false);
	});

	it('matches * wildcard', () => {
		expect(globMatch('*.txt', 'file.txt')).toBe(true);
		expect(globMatch('*.txt', 'file.md')).toBe(false);
	});

	it('* does not match /', () => {
		expect(globMatch('*', 'a/b')).toBe(false);
	});

	it('matches ? wildcard', () => {
		expect(globMatch('?.txt', 'a.txt')).toBe(true);
		expect(globMatch('?.txt', 'ab.txt')).toBe(false);
	});

	it('? does not match /', () => {
		expect(globMatch('?', '/')).toBe(false);
	});

	it('matches character class [abc]', () => {
		expect(globMatch('[abc].txt', 'a.txt')).toBe(true);
		expect(globMatch('[abc].txt', 'd.txt')).toBe(false);
	});

	it('matches negated character class [!abc]', () => {
		expect(globMatch('[!abc].txt', 'd.txt')).toBe(true);
		expect(globMatch('[!abc].txt', 'a.txt')).toBe(false);
	});

	it('matches character range [a-z]', () => {
		expect(globMatch('[a-z].txt', 'm.txt')).toBe(true);
		expect(globMatch('[a-z].txt', 'A.txt')).toBe(false);
	});

	it('matches empty pattern only against empty text', () => {
		expect(globMatch('', '')).toBe(true);
		expect(globMatch('', 'x')).toBe(false);
	});

	it('matches * at start', () => {
		expect(globMatch('*bar', 'foobar')).toBe(true);
	});

	it('matches * in middle', () => {
		expect(globMatch('foo*bar', 'fooXYZbar')).toBe(true);
		expect(globMatch('foo*bar', 'fobar')).toBe(false);
	});

	it('matches multiple *', () => {
		expect(globMatch('*.*', 'file.txt')).toBe(true);
	});
});

describe('globMatchPath', () => {
	it('matches without ** same as globMatch', () => {
		expect(globMatchPath('*.txt', 'file.txt')).toBe(true);
	});

	it('** matches zero directories', () => {
		expect(globMatchPath('/**/*.txt', '/file.txt')).toBe(true);
	});

	it('** matches one directory', () => {
		expect(globMatchPath('/**/*.txt', '/dir/file.txt')).toBe(true);
	});

	it('** matches multiple directories', () => {
		expect(globMatchPath('/**/*.txt', '/a/b/c/file.txt')).toBe(true);
	});

	it('** at end matches everything', () => {
		expect(globMatchPath('/dir/**', '/dir/a/b/c')).toBe(true);
	});

	it('prefix/**/suffix pattern', () => {
		expect(globMatchPath('/src/**/*.ts', '/src/utils/glob.ts')).toBe(true);
		expect(globMatchPath('/src/**/*.ts', '/src/deep/nested/file.ts')).toBe(true);
		expect(globMatchPath('/src/**/*.ts', '/other/file.ts')).toBe(false);
	});
});

describe('expandBraces', () => {
	it('expands simple alternatives', () => {
		expect(expandBraces('{a,b}')).toEqual(['a', 'b']);
	});

	it('expands with prefix and suffix', () => {
		expect(expandBraces('file.{js,ts}')).toEqual(['file.js', 'file.ts']);
	});

	it('expands nested braces', () => {
		const result = expandBraces('{a,{b,c}}');
		expect(result).toEqual(['a', 'b', 'c']);
	});

	it('returns pattern unchanged if no braces', () => {
		expect(expandBraces('hello')).toEqual(['hello']);
	});

	it('returns pattern unchanged if single item in braces', () => {
		expect(expandBraces('{a}')).toEqual(['{a}']);
	});

	it('expands multiple brace groups', () => {
		const result = expandBraces('{a,b}.{x,y}');
		expect(result).toEqual(['a.x', 'a.y', 'b.x', 'b.y']);
	});
});

describe('globExpand', () => {
	function makeFs(files: Record<string, string>): InMemoryFs {
		return new InMemoryFs(files);
	}

	it('returns exact match for literal path', () => {
		const fs = makeFs({ '/file.txt': 'hello' });
		expect(globExpand('/file.txt', fs, '/')).toEqual(['/file.txt']);
	});

	it('returns empty for non-existent literal path', () => {
		const fs = makeFs({});
		expect(globExpand('/nope.txt', fs, '/')).toEqual([]);
	});

	it('expands * in directory', () => {
		const fs = makeFs({
			'/a.txt': '',
			'/b.txt': '',
			'/c.md': '',
		});
		const result = globExpand('/*.txt', fs, '/');
		expect(result).toEqual(['/a.txt', '/b.txt']);
	});

	it('expands ? wildcard', () => {
		const fs = makeFs({
			'/a.txt': '',
			'/ab.txt': '',
		});
		expect(globExpand('/?.txt', fs, '/')).toEqual(['/a.txt']);
	});

	it('expands in subdirectory', () => {
		const fs = makeFs({
			'/dir/a.txt': '',
			'/dir/b.txt': '',
			'/other/c.txt': '',
		});
		expect(globExpand('/dir/*.txt', fs, '/')).toEqual(['/dir/a.txt', '/dir/b.txt']);
	});

	it('hides dot files by default', () => {
		const fs = makeFs({
			'/dir/.hidden': '',
			'/dir/visible': '',
		});
		expect(globExpand('/dir/*', fs, '/')).toEqual(['/dir/visible']);
	});

	it('shows dot files when pattern starts with .', () => {
		const fs = makeFs({
			'/dir/.hidden': '',
			'/dir/visible': '',
		});
		expect(globExpand('/dir/.*', fs, '/')).toEqual(['/dir/.hidden']);
	});

	it('expands brace patterns', () => {
		const fs = makeFs({
			'/file.js': '',
			'/file.ts': '',
			'/file.md': '',
		});
		expect(globExpand('/file.{js,ts}', fs, '/')).toEqual(['/file.js', '/file.ts']);
	});

	it('resolves relative patterns against cwd', () => {
		const fs = makeFs({
			'/home/user/a.txt': '',
			'/home/user/b.txt': '',
		});
		expect(globExpand('*.txt', fs, '/home/user')).toEqual(['/home/user/a.txt', '/home/user/b.txt']);
	});

	it('expands ** globstar pattern', () => {
		const fs = makeFs({
			'/src/a.ts': '',
			'/src/utils/b.ts': '',
			'/src/utils/deep/c.ts': '',
		});
		const result = globExpand('/src/**/*.ts', fs, '/');
		expect(result).toEqual(['/src/a.ts', '/src/utils/b.ts', '/src/utils/deep/c.ts']);
	});

	it('returns sorted results', () => {
		const fs = makeFs({
			'/z.txt': '',
			'/a.txt': '',
			'/m.txt': '',
		});
		expect(globExpand('/*.txt', fs, '/')).toEqual(['/a.txt', '/m.txt', '/z.txt']);
	});

	it('handles empty pattern', () => {
		const fs = makeFs({ '/a.txt': '' });
		expect(globExpand('', fs, '/')).toEqual([]);
	});

	it('handles character class patterns', () => {
		const fs = makeFs({
			'/a.txt': '',
			'/b.txt': '',
			'/c.txt': '',
		});
		expect(globExpand('/[ab].txt', fs, '/')).toEqual(['/a.txt', '/b.txt']);
	});
});
