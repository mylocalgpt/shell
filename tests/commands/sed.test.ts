import { describe, expect, it } from 'vitest';
import { sed } from '../../src/commands/sed.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
	const fs = new InMemoryFs(files);
	return {
		fs,
		cwd: '/',
		env: new Map(),
		stdin: stdin ?? '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('sed', () => {
	it('substitutes first match', async () => {
		const r = await sed.execute(['s/hello/world/'], makeCtx({}, 'hello there hello\n'));
		expect(r.stdout).toBe('world there hello\n');
	});

	it('substitutes globally with g flag', async () => {
		const r = await sed.execute(['s/a/b/g'], makeCtx({}, 'aaa\n'));
		expect(r.stdout).toBe('bbb\n');
	});

	it('supports case-insensitive with i flag', async () => {
		const r = await sed.execute(['s/hello/world/i'], makeCtx({}, 'HELLO\n'));
		expect(r.stdout).toBe('world\n');
	});

	it('deletes lines with d', async () => {
		const r = await sed.execute(['2d'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout).toBe('a\nc\n');
	});

	it('prints lines with p and -n', async () => {
		const r = await sed.execute(['-n', '2p'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout).toBe('b\n');
	});

	it('supports line number address', async () => {
		const r = await sed.execute(['2s/b/B/'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout).toBe('a\nB\nc\n');
	});

	it('supports $ address for last line', async () => {
		const r = await sed.execute(['$s/c/C/'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout).toBe('a\nb\nC\n');
	});

	it('supports regex address', async () => {
		const r = await sed.execute(['/^b/d'], makeCtx({}, 'a\nba\nbc\nc\n'));
		expect(r.stdout).toBe('a\nc\n');
	});

	it('supports range address', async () => {
		const r = await sed.execute(['2,3d'], makeCtx({}, 'a\nb\nc\nd\n'));
		expect(r.stdout).toBe('a\nd\n');
	});

	it('supports backreferences', async () => {
		const r = await sed.execute(['s/\\(hello\\)/[\\1]/'], makeCtx({}, 'hello world\n'));
		// Note: in ERE mode (default), use () not \\(\\)
		// Let's test with regular groups
		const r2 = await sed.execute(['s/(hello)/[\\1]/'], makeCtx({}, 'hello world\n'));
		expect(r2.stdout).toContain('[hello]');
	});

	it('supports & in replacement', async () => {
		const r = await sed.execute(['s/hello/[&]/'], makeCtx({}, 'hello\n'));
		expect(r.stdout).toBe('[hello]\n');
	});

	it('reads from file', async () => {
		const ctx = makeCtx({ '/f.txt': 'hello\n' });
		const r = await sed.execute(['s/hello/world/', '/f.txt'], ctx);
		expect(r.stdout).toBe('world\n');
	});

	it('supports in-place edit', async () => {
		const ctx = makeCtx({ '/f.txt': 'hello\n' });
		await sed.execute(['-i', 's/hello/world/', '/f.txt'], ctx);
		expect(ctx.fs.readFile('/f.txt')).toBe('world\n');
	});

	it('supports multiple -e expressions', async () => {
		const r = await sed.execute(['-e', 's/a/A/', '-e', 's/b/B/'], makeCtx({}, 'ab\n'));
		expect(r.stdout).toBe('AB\n');
	});

	it('rejects hold-space commands', async () => {
		const r = await sed.execute(['h'], makeCtx({}, 'hello\n'));
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('hold-space');
	});

	it('supports different delimiters', async () => {
		const r = await sed.execute(['s|/path|/new|'], makeCtx({}, '/path/to/file\n'));
		expect(r.stdout).toBe('/new/to/file\n');
	});
});
