import { describe, expect, it } from 'vitest';
import { cp } from '../../src/commands/cp.js';
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

describe('cp', () => {
	it('copies a file', async () => {
		const ctx = makeCtx({ '/a.txt': 'hello' });
		await cp.execute(['/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.readFile('/b.txt')).toBe('hello');
	});

	it('overwrites existing file by default', async () => {
		const ctx = makeCtx({ '/a.txt': 'new', '/b.txt': 'old' });
		await cp.execute(['/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.readFile('/b.txt')).toBe('new');
	});

	it('respects -n no-clobber', async () => {
		const ctx = makeCtx({ '/a.txt': 'new', '/b.txt': 'old' });
		await cp.execute(['-n', '/a.txt', '/b.txt'], ctx);
		expect(ctx.fs.readFile('/b.txt')).toBe('old');
	});

	it('copies multiple files to directory', async () => {
		const ctx = makeCtx({ '/a.txt': 'aaa', '/b.txt': 'bbb' });
		ctx.fs.mkdir('/dest');
		await cp.execute(['/a.txt', '/b.txt', '/dest'], ctx);
		expect(ctx.fs.readFile('/dest/a.txt')).toBe('aaa');
		expect(ctx.fs.readFile('/dest/b.txt')).toBe('bbb');
	});

	it('copies directory recursively with -r', async () => {
		const ctx = makeCtx({ '/src/a.txt': 'aaa', '/src/sub/b.txt': 'bbb' });
		await cp.execute(['-r', '/src', '/dest'], ctx);
		expect(ctx.fs.readFile('/dest/a.txt')).toBe('aaa');
		expect(ctx.fs.readFile('/dest/sub/b.txt')).toBe('bbb');
	});

	it('fails to copy dir without -r', async () => {
		const ctx = makeCtx({ '/src/a.txt': 'aaa' });
		const r = await cp.execute(['/src', '/dest'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('omitting directory');
	});

	it('reports missing source', async () => {
		const ctx = makeCtx();
		const r = await cp.execute(['/nope', '/dest'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('No such file or directory');
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await cp.execute([], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('missing file operand');
	});
});
