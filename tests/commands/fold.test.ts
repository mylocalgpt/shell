import { describe, expect, it } from 'vitest';
import { fold } from '../../src/commands/fold.js';
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

describe('fold', () => {
	it('wraps at specified width', async () => {
		const r = await fold.execute(['-w', '5'], makeCtx({}, 'abcdefghij\n'));
		expect(r.stdout).toContain('abcde\n');
		expect(r.stdout).toContain('fghij');
	});
	it('breaks at spaces with -s', async () => {
		const r = await fold.execute(['-w', '10', '-s'], makeCtx({}, 'hello world foo\n'));
		const lines = r.stdout.split('\n').filter(Boolean);
		expect(lines.length).toBeGreaterThan(1);
	});
	it('does not wrap short lines', async () => {
		const r = await fold.execute(['-w', '80'], makeCtx({}, 'short\n'));
		expect(r.stdout).toBe('short\n');
	});
});
