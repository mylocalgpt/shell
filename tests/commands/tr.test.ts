import { describe, expect, it } from 'vitest';
import { tr } from '../../src/commands/tr.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(stdin?: string): CommandContext {
	return {
		fs: new InMemoryFs(),
		cwd: '/',
		env: new Map(),
		stdin: stdin ?? '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('tr', () => {
	it('translates characters', async () => {
		const r = await tr.execute(['abc', 'xyz'], makeCtx('abcabc'));
		expect(r.stdout).toBe('xyzxyz');
	});

	it('translates ranges', async () => {
		const r = await tr.execute(['a-z', 'A-Z'], makeCtx('hello'));
		expect(r.stdout).toBe('HELLO');
	});

	it('deletes characters with -d', async () => {
		const r = await tr.execute(['-d', 'aeiou'], makeCtx('hello world'));
		expect(r.stdout).toBe('hll wrld');
	});

	it('squeezes repeats with -s', async () => {
		const r = await tr.execute(['-s', ' '], makeCtx('hello   world'));
		expect(r.stdout).toBe('hello world');
	});

	it('translates and squeezes with -s', async () => {
		const r = await tr.execute(['-s', 'a-z', 'A-Z'], makeCtx('aabbcc'));
		expect(r.stdout).toBe('ABC');
	});

	it('supports [:upper:] class', async () => {
		const r = await tr.execute(['[:upper:]', '[:lower:]'], makeCtx('HELLO'));
		expect(r.stdout).toBe('hello');
	});

	it('supports [:lower:] class', async () => {
		const r = await tr.execute(['[:lower:]', '[:upper:]'], makeCtx('hello'));
		expect(r.stdout).toBe('HELLO');
	});

	it('supports [:digit:] class', async () => {
		const r = await tr.execute(['-d', '[:digit:]'], makeCtx('abc123def'));
		expect(r.stdout).toBe('abcdef');
	});

	it('supports [:space:] class', async () => {
		const r = await tr.execute(['-d', '[:space:]'], makeCtx('hello world\n'));
		expect(r.stdout).toBe('helloworld');
	});

	it('supports escape sequences', async () => {
		const r = await tr.execute(['\\n', ' '], makeCtx('a\nb\nc'));
		expect(r.stdout).toBe('a b c');
	});

	it('reports missing operand', async () => {
		const r = await tr.execute([], makeCtx(''));
		expect(r.exitCode).toBe(1);
	});
});
