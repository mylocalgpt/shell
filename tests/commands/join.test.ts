import { describe, expect, it } from 'vitest';
import { join } from '../../src/commands/join.js';
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

describe('join', () => {
	it('joins on first field', async () => {
		const ctx = makeCtx({ '/a.txt': 'a 1\nb 2\n', '/b.txt': 'a x\nb y\n' });
		const r = await join.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('a');
		expect(r.stdout).toContain('b');
	});
	it('supports custom delimiter', async () => {
		const ctx = makeCtx({ '/a.txt': 'a,1\nb,2\n', '/b.txt': 'a,x\n' });
		const r = await join.execute(['-t', ',', '/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('a');
	});
	it('reports missing files', async () => {
		const ctx = makeCtx();
		const r = await join.execute([], ctx);
		expect(r.exitCode).toBe(1);
	});
});
