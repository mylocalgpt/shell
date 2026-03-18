import { describe, expect, it } from 'vitest';
import { mkdir } from '../../src/commands/mkdir.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(): CommandContext {
	const fs = new InMemoryFs();
	return {
		fs,
		cwd: '/',
		env: new Map(),
		stdin: '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('mkdir', () => {
	it('creates a directory', async () => {
		const ctx = makeCtx();
		await mkdir.execute(['/newdir'], ctx);
		expect(ctx.fs.exists('/newdir')).toBe(true);
		expect(ctx.fs.stat('/newdir').isDirectory()).toBe(true);
	});

	it('creates nested directories with -p', async () => {
		const ctx = makeCtx();
		await mkdir.execute(['-p', '/a/b/c'], ctx);
		expect(ctx.fs.exists('/a/b/c')).toBe(true);
	});

	it('no error for existing dir with -p', async () => {
		const ctx = makeCtx();
		ctx.fs.mkdir('/existing');
		const r = await mkdir.execute(['-p', '/existing'], ctx);
		expect(r.exitCode).toBe(0);
	});

	it('errors for existing dir without -p', async () => {
		const ctx = makeCtx();
		ctx.fs.mkdir('/existing');
		const r = await mkdir.execute(['/existing'], ctx);
		expect(r.exitCode).toBe(1);
	});

	it('errors for missing parent without -p', async () => {
		const ctx = makeCtx();
		const r = await mkdir.execute(['/a/b'], ctx);
		expect(r.exitCode).toBe(1);
	});

	it('creates multiple directories', async () => {
		const ctx = makeCtx();
		await mkdir.execute(['/dir1', '/dir2'], ctx);
		expect(ctx.fs.exists('/dir1')).toBe(true);
		expect(ctx.fs.exists('/dir2')).toBe(true);
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await mkdir.execute([], ctx);
		expect(r.exitCode).toBe(1);
	});
});
