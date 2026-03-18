import { describe, expect, it } from 'vitest';
import { rmdir } from '../../src/commands/rmdir.js';
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

describe('rmdir', () => {
	it('removes an empty directory', async () => {
		const ctx = makeCtx();
		ctx.fs.mkdir('/empty');
		await rmdir.execute(['/empty'], ctx);
		expect(ctx.fs.exists('/empty')).toBe(false);
	});

	it('fails on non-empty directory', async () => {
		const ctx = makeCtx({ '/dir/file.txt': '' });
		const r = await rmdir.execute(['/dir'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('not empty');
	});

	it('fails on non-existent directory', async () => {
		const ctx = makeCtx();
		const r = await rmdir.execute(['/nope'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('No such file or directory');
	});

	it('removes parents with -p', async () => {
		const ctx = makeCtx();
		ctx.fs.mkdir('/a/b/c', { recursive: true });
		await rmdir.execute(['-p', '/a/b/c'], ctx);
		expect(ctx.fs.exists('/a/b/c')).toBe(false);
		expect(ctx.fs.exists('/a/b')).toBe(false);
		expect(ctx.fs.exists('/a')).toBe(false);
	});

	it('stops -p when parent is not empty', async () => {
		const ctx = makeCtx({ '/a/sibling.txt': '' });
		ctx.fs.mkdir('/a/b', { recursive: true });
		await rmdir.execute(['-p', '/a/b'], ctx);
		expect(ctx.fs.exists('/a/b')).toBe(false);
		expect(ctx.fs.exists('/a')).toBe(true); // has sibling.txt
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await rmdir.execute([], ctx);
		expect(r.exitCode).toBe(1);
	});
});
