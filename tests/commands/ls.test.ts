import { describe, expect, it } from 'vitest';
import { ls } from '../../src/commands/ls.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>): CommandContext {
	return {
		fs: new InMemoryFs(files),
		cwd: '/',
		env: new Map(),
		stdin: '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('ls', () => {
	it('lists directory contents', async () => {
		const ctx = makeCtx({ '/a.txt': '', '/b.txt': '' });
		const r = await ls.execute(['/'], ctx);
		expect(r.stdout).toContain('a.txt');
		expect(r.stdout).toContain('b.txt');
	});

	it('hides dot files by default', async () => {
		const ctx = makeCtx({ '/.hidden': '', '/visible': '' });
		const r = await ls.execute(['/'], ctx);
		expect(r.stdout).toContain('visible');
		expect(r.stdout).not.toContain('.hidden');
	});

	it('shows dot files with -a', async () => {
		const ctx = makeCtx({ '/.hidden': '', '/visible': '' });
		const r = await ls.execute(['-a', '/'], ctx);
		expect(r.stdout).toContain('.hidden');
	});

	it('shows long format with -l', async () => {
		const ctx = makeCtx({ '/file.txt': 'hello' });
		const r = await ls.execute(['-l', '/'], ctx);
		expect(r.stdout).toContain('file.txt');
		expect(r.stdout).toContain('root');
	});

	it('reports missing directory', async () => {
		const ctx = makeCtx();
		const r = await ls.execute(['/nope'], ctx);
		expect(r.exitCode).toBe(2);
	});
});
