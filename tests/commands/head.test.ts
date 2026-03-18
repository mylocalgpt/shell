import { describe, expect, it } from 'vitest';
import { head } from '../../src/commands/head.js';
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

describe('head', () => {
	it('shows first 10 lines by default', async () => {
		const lines = `${Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n')}\n`;
		const r = await head.execute(['/f.txt'], makeCtx({ '/f.txt': lines }));
		expect(r.stdout.split('\n').filter(Boolean)).toHaveLength(10);
	});

	it('supports -n to specify line count', async () => {
		const r = await head.execute(['-n', '3', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\nc\nd\n' }));
		expect(r.stdout).toBe('a\nb\nc\n');
	});

	it('supports -c byte count', async () => {
		const r = await head.execute(['-c', '5', '/f.txt'], makeCtx({ '/f.txt': 'hello world' }));
		expect(r.stdout).toBe('hello');
	});

	it('reads from stdin', async () => {
		const r = await head.execute(['-n', '1'], makeCtx({}, 'first\nsecond\n'));
		expect(r.stdout).toBe('first\n');
	});

	it('shows headers for multiple files', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\n', '/b.txt': 'b\n' });
		const r = await head.execute(['-n', '1', '/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('==> /a.txt <==');
		expect(r.stdout).toContain('==> /b.txt <==');
	});

	it('reports missing file', async () => {
		const r = await head.execute(['/nope'], makeCtx());
		expect(r.exitCode).toBe(1);
	});
});
