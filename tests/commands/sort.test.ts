import { describe, expect, it } from 'vitest';
import { sort } from '../../src/commands/sort.js';
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

describe('sort', () => {
	it('sorts lines alphabetically', async () => {
		const r = await sort.execute([], makeCtx({}, 'cherry\napple\nbanana\n'));
		expect(r.stdout).toBe('apple\nbanana\ncherry\n');
	});

	it('supports -r reverse', async () => {
		const r = await sort.execute(['-r'], makeCtx({}, 'a\nb\nc\n'));
		expect(r.stdout).toBe('c\nb\na\n');
	});

	it('supports -n numeric', async () => {
		const r = await sort.execute(['-n'], makeCtx({}, '10\n2\n1\n20\n'));
		expect(r.stdout).toBe('1\n2\n10\n20\n');
	});

	it('supports -u unique', async () => {
		const r = await sort.execute(['-u'], makeCtx({}, 'a\nb\na\nc\nb\n'));
		expect(r.stdout).toBe('a\nb\nc\n');
	});

	it('supports -f ignore case', async () => {
		const r = await sort.execute(['-f'], makeCtx({}, 'Banana\napple\nCherry\n'));
		expect(r.stdout).toBe('apple\nBanana\nCherry\n');
	});

	it('supports -k field sort', async () => {
		const r = await sort.execute(['-t', ',', '-k', '2'], makeCtx({}, 'b,2\na,3\nc,1\n'));
		expect(r.stdout).toBe('c,1\nb,2\na,3\n');
	});

	it('supports -k with numeric modifier', async () => {
		const r = await sort.execute(['-t', ',', '-k', '2,2n'], makeCtx({}, 'a,10\nb,2\nc,1\n'));
		expect(r.stdout).toBe('c,1\nb,2\na,10\n');
	});

	it('supports -h human-numeric', async () => {
		const r = await sort.execute(['-h'], makeCtx({}, '1G\n2K\n3M\n'));
		expect(r.stdout).toBe('2K\n3M\n1G\n');
	});

	it('reads from file', async () => {
		const ctx = makeCtx({ '/f.txt': 'c\na\nb\n' });
		const r = await sort.execute(['/f.txt'], ctx);
		expect(r.stdout).toBe('a\nb\nc\n');
	});
});
