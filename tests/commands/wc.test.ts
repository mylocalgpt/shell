import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../../src/commands/types.js';
import { wc } from '../../src/commands/wc.js';
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

describe('wc', () => {
	it('counts lines, words, bytes by default', async () => {
		const r = await wc.execute([], makeCtx({}, 'hello world\n'));
		expect(r.stdout).toContain('1'); // 1 line
		expect(r.stdout).toContain('2'); // 2 words
		expect(r.stdout).toContain('12'); // 12 bytes
	});

	it('supports -l lines only', async () => {
		const r = await wc.execute(['-l'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout.trim()).toContain('3');
	});

	it('supports -w words only', async () => {
		const r = await wc.execute(['-w'], makeCtx({}, 'hello world foo\n'));
		expect(r.stdout.trim()).toContain('3');
	});

	it('supports -c bytes', async () => {
		const r = await wc.execute(['-c'], makeCtx({}, 'hello\n'));
		expect(r.stdout.trim()).toContain('6');
	});

	it('reads from file', async () => {
		const ctx = makeCtx({ '/f.txt': 'hello\n' });
		const r = await wc.execute(['/f.txt'], ctx);
		expect(r.stdout).toContain('f.txt');
	});

	it('shows total for multiple files', async () => {
		const ctx = makeCtx({ '/a.txt': 'a\n', '/b.txt': 'b\n' });
		const r = await wc.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toContain('total');
	});

	it('reads from stdin with no args', async () => {
		const r = await wc.execute([], makeCtx({}, 'one two three\n'));
		expect(r.stdout).toContain('3'); // 3 words
	});
});
