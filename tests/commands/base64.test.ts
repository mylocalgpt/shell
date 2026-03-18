import { describe, expect, it } from 'vitest';
import { base64 } from '../../src/commands/base64.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
	return {
		fs: new InMemoryFs(files),
		cwd: '/',
		env: new Map([
			['USER', 'testuser'],
			['HOSTNAME', 'testhost'],
		]),
		stdin: stdin ?? '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('base64', () => {
	it('runs without error', async () => {
		const r = await base64.execute([], makeCtx());
		expect(r.exitCode).toBeDefined();
	});
});
