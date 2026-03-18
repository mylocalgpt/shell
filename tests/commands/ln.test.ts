import { describe, expect, it } from 'vitest';
import { ln } from '../../src/commands/ln.js';
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

describe('ln', () => {
	it('creates a symbolic link', async () => {
		const ctx = makeCtx({ '/target.txt': 'hello' });
		const r = await ln.execute(['-s', '/target.txt', '/link.txt'], ctx);
		expect(r.exitCode).toBe(0);
		expect(ctx.fs.readlink('/link.txt')).toBe('/target.txt');
	});

	it('fails without -s', async () => {
		const ctx = makeCtx({ '/target.txt': 'hello' });
		const r = await ln.execute(['/target.txt', '/link.txt'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('hard links not supported');
	});

	it('fails if link already exists', async () => {
		const ctx = makeCtx({ '/target.txt': 'hello', '/link.txt': 'existing' });
		const r = await ln.execute(['-s', '/target.txt', '/link.txt'], ctx);
		expect(r.exitCode).toBe(1);
	});

	it('force overwrites with -sf', async () => {
		const ctx = makeCtx({ '/target.txt': 'hello' });
		ctx.fs.writeFile('/link.txt', 'old');
		const r = await ln.execute(['-sf', '/target.txt', '/link.txt'], ctx);
		expect(r.exitCode).toBe(0);
		expect(ctx.fs.readlink('/link.txt')).toBe('/target.txt');
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await ln.execute(['-s'], ctx);
		expect(r.exitCode).toBe(1);
	});
});
