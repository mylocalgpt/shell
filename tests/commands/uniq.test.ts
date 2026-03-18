import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../../src/commands/types.js';
import { uniq } from '../../src/commands/uniq.js';
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

describe('uniq', () => {
	it('removes adjacent duplicates', async () => {
		const r = await uniq.execute([], makeCtx({}, 'a\na\nb\nb\na\n'));
		expect(r.stdout).toBe('a\nb\na\n');
	});

	it('supports -c count', async () => {
		const r = await uniq.execute(['-c'], makeCtx({}, 'a\na\nb\n'));
		expect(r.stdout).toContain('2 a');
		expect(r.stdout).toContain('1 b');
	});

	it('supports -d only duplicates', async () => {
		const r = await uniq.execute(['-d'], makeCtx({}, 'a\na\nb\nc\nc\n'));
		expect(r.stdout).toBe('a\nc\n');
	});

	it('supports -u only unique', async () => {
		const r = await uniq.execute(['-u'], makeCtx({}, 'a\na\nb\nc\nc\n'));
		expect(r.stdout).toBe('b\n');
	});

	it('supports -i ignore case', async () => {
		const r = await uniq.execute(['-i'], makeCtx({}, 'Hello\nhello\nWorld\n'));
		expect(r.stdout).toBe('Hello\nWorld\n');
	});

	it('reads from file', async () => {
		const ctx = makeCtx({ '/f.txt': 'a\na\nb\n' });
		const r = await uniq.execute(['/f.txt'], ctx);
		expect(r.stdout).toBe('a\nb\n');
	});
});
