import { describe, expect, it } from 'vitest';
import { nl } from '../../src/commands/nl.js';
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

describe('nl', () => {
	it('numbers non-empty lines by default', async () => {
		const r = await nl.execute([], makeCtx({}, 'a\n\nb\n'));
		expect(r.stdout).toContain('1\ta');
		expect(r.stdout).toContain('2\tb');
	});
	it('numbers all lines with -b a', async () => {
		const r = await nl.execute(['-b', 'a'], makeCtx({}, 'a\n\nb\n'));
		expect(r.stdout).toContain('1\ta');
		expect(r.stdout).toContain('2\t');
		expect(r.stdout).toContain('3\tb');
	});
	it('reads from file', async () => {
		const r = await nl.execute(['/f.txt'], makeCtx({ '/f.txt': 'hello\n' }));
		expect(r.stdout).toContain('1\thello');
	});
});
