import { describe, expect, it } from 'vitest';
import { column } from '../../src/commands/column.js';
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

describe('column', () => {
	it('formats table with -t', async () => {
		const r = await column.execute(['-t'], makeCtx('a b c\nxx yy zz\n'));
		const lines = r.stdout.split('\n').filter(Boolean);
		expect(lines).toHaveLength(2);
		// Columns should be aligned
		expect(lines[0]).toContain('a');
		expect(lines[0]).toContain('b');
	});
	it('uses custom separator with -s', async () => {
		const r = await column.execute(['-t', '-s', ','], makeCtx('a,b,c\nxx,yy,zz\n'));
		expect(r.stdout).toContain('a');
		expect(r.stdout).toContain('xx');
	});
	it('handles empty input', async () => {
		const r = await column.execute(['-t'], makeCtx(''));
		expect(r.stdout).toBe('');
	});
});
