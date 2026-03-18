import { describe, expect, it } from 'vitest';
import { comm } from '../../src/commands/comm.js';
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

describe('comm', () => {
	it('shows three columns', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\nc\n', '/b.txt': 'b\nc\nd\n' });
		const r = await comm.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('a');
		expect(r.stdout).toContain('\t\tb'); // common
		expect(r.stdout).toContain('\td'); // only in b
	});
	it('suppresses column 1', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\n', '/b.txt': 'b\nc\n' });
		const r = await comm.execute(['-1', '/a.txt', '/b.txt'], ctx);
		expect(r.stdout).not.toContain('a\n');
	});
	it('suppresses column 3 (common)', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\n', '/b.txt': 'b\nc\n' });
		const r = await comm.execute(['-3', '/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('a');
		expect(r.stdout).toContain('c');
	});
});
