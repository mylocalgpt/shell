import { describe, expect, it } from 'vitest';
import { paste } from '../../src/commands/paste.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
	return {
		fs: new InMemoryFs(files),
		cwd: '/',
		env: new Map(),
		stdin: stdin ?? '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('paste', () => {
	it('merges two files with tab', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\n', '/b.txt': '1\n2\n' });
		const r = await paste.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toBe('a\t1\nb\t2\n');
	});
	it('uses custom delimiter', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\n', '/b.txt': '1\n2\n' });
		const r = await paste.execute(['-d', ',', '/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toBe('a,1\nb,2\n');
	});
	it('handles unequal lengths', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\nb\nc\n', '/b.txt': '1\n' });
		const r = await paste.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('a\t1');
		expect(r.stdout).toContain('c\t');
	});
});
