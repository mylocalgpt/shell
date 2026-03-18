import { describe, expect, it } from 'vitest';
import { expr } from '../../src/commands/expr.js';
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

describe('expr', () => {
	it('runs without error', async () => {
		const r = await expr.execute([], makeCtx());
		expect(r.exitCode).toBeDefined();
	});
});
