import { describe, expect, it } from 'vitest';
import { mv } from '../../src/commands/mv.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>): CommandContext {
	const fs = new InMemoryFs(files);
	return {
		fs,
		cwd: '/',
		env: new Map(),
		stdin: '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('mv', () => {
	it('renames a file', async () => {
		const ctx = makeCtx({ '/a.txt': 'hello' });
		await mv.execute(['/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.exists('/a.txt')).toBe(false);
		expect(ctx.fs.readFile('/b.txt')).toBe('hello');
	});

	it('moves file to directory', async () => {
		const ctx = makeCtx({ '/a.txt': 'hello' });
		ctx.fs.mkdir('/dir');
		await mv.execute(['/a.txt', '/dir'], ctx);
		expect(ctx.fs.exists('/a.txt')).toBe(false);
		expect(ctx.fs.readFile('/dir/a.txt')).toBe('hello');
	});

	it('respects -n no-clobber', async () => {
		const ctx = makeCtx({ '/a.txt': 'new', '/b.txt': 'old' });
		await mv.execute(['-n', '/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.readFile('/a.txt')).toBe('new');
		expect(ctx.fs.readFile('/b.txt')).toBe('old');
	});

	it('overwrites by default', async () => {
		const ctx = makeCtx({ '/a.txt': 'new', '/b.txt': 'old' });
		await mv.execute(['/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.readFile('/b.txt')).toBe('new');
	});

	it('reports missing source', async () => {
		const ctx = makeCtx();
		const r = await mv.execute(['/nope', '/dest'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('No such file or directory');
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await mv.execute([], ctx);
		expect(r.exitCode).toBe(1);
	});
});
