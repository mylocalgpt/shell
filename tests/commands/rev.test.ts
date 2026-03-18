import { describe, expect, it } from 'vitest';
import { rev } from '../../src/commands/rev.js';
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

describe('rev', () => {
	it('reverses each line', async () => {
		const r = await rev.execute([], makeCtx({}, 'abc\nxyz\n'));
		expect(r.stdout).toBe('cba\nzyx\n');
	});
	it('reads from file', async () => {
		const r = await rev.execute(['/f.txt'], makeCtx({ '/f.txt': 'hello\n' }));
		expect(r.stdout).toBe('olleh\n');
	});
	it('handles empty input', async () => {
		const r = await rev.execute([], makeCtx({}, ''));
		expect(r.stdout).toBe('');
	});
});
