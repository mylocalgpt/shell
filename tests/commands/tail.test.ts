import { describe, expect, it } from 'vitest';
import { tail } from '../../src/commands/tail.js';
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

describe('tail', () => {
	it('shows last 10 lines by default', async () => {
		const lines = `${Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n')}\n`;
		const r = await tail.execute(['/f.txt'], makeCtx({ '/f.txt': lines }));
		const output = r.stdout.split('\n').filter(Boolean);
		expect(output).toHaveLength(10);
		expect(output[0]).toBe('line6');
	});

	it('supports -n to specify line count', async () => {
		const r = await tail.execute(['-n', '2', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\nc\nd\n' }));
		expect(r.stdout).toBe('c\nd\n');
	});

	it('supports +N syntax (from line N)', async () => {
		const r = await tail.execute(['-n', '+3', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\nc\nd\n' }));
		expect(r.stdout).toBe('c\nd\n');
	});

	it('supports -c byte count', async () => {
		const r = await tail.execute(['-c', '5', '/f.txt'], makeCtx({ '/f.txt': 'hello world' }));
		expect(r.stdout).toBe('world');
	});

	it('reads from stdin', async () => {
		const r = await tail.execute(['-n', '1'], makeCtx({}, 'first\nsecond\n'));
		expect(r.stdout).toBe('second\n');
	});

	it('accepts -f silently', async () => {
		const r = await tail.execute(['-f', '-n', '1', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\n' }));
		expect(r.exitCode).toBe(0);
	});
});
