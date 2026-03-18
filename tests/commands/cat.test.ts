import { describe, expect, it } from 'vitest';
import { cat } from '../../src/commands/cat.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
	const fs = new InMemoryFs(files);
	return {
		fs,
		cwd: '/',
		env: new Map(),
		stdin: stdin ?? '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('cat', () => {
	it('reads a single file', async () => {
		const r = await cat.execute(['/hello.txt'], makeCtx({ '/hello.txt': 'hello world\n' }));
		expect(r.stdout).toBe('hello world\n');
		expect(r.exitCode).toBe(0);
	});

	it('reads multiple files', async () => {
		const ctx = makeCtx({ '/a.txt': 'aaa\n', '/b.txt': 'bbb\n' });
		const r = await cat.execute(['/a.txt', '/b.txt'], ctx);
		expect(r.stdout).toBe('aaa\nbbb\n');
	});

	it('reads from stdin with no args', async () => {
		const r = await cat.execute([], makeCtx({}, 'from stdin\n'));
		expect(r.stdout).toBe('from stdin\n');
	});

	it('reads from stdin with -', async () => {
		const r = await cat.execute(['-'], makeCtx({}, 'piped\n'));
		expect(r.stdout).toBe('piped\n');
	});

	it('numbers all lines with -n', async () => {
		const r = await cat.execute(['-n', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\nc\n' }));
		expect(r.stdout).toContain('     1\ta');
		expect(r.stdout).toContain('     2\tb');
		expect(r.stdout).toContain('     3\tc');
	});

	it('numbers non-blank lines with -b', async () => {
		const r = await cat.execute(['-b', '/f.txt'], makeCtx({ '/f.txt': 'a\n\nb\n' }));
		expect(r.stdout).toContain('     1\ta');
		expect(r.stdout).toContain('     2\tb');
		// Empty line should not be numbered
		const lines = r.stdout.split('\n');
		const emptyLine = lines.find((l) => l.trim() === '');
		expect(emptyLine).toBeDefined();
	});

	it('squeezes blank lines with -s', async () => {
		const r = await cat.execute(['-s', '/f.txt'], makeCtx({ '/f.txt': 'a\n\n\n\nb\n' }));
		expect(r.stdout).toBe('a\n\nb\n');
	});

	it('shows ends with -E', async () => {
		const r = await cat.execute(['-E', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\n' }));
		expect(r.stdout).toBe('a$\nb$\n');
	});

	it('reports missing file', async () => {
		const r = await cat.execute(['/nope.txt'], makeCtx());
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('No such file or directory');
	});

	it('handles empty file', async () => {
		const r = await cat.execute(['/empty.txt'], makeCtx({ '/empty.txt': '' }));
		expect(r.stdout).toBe('');
		expect(r.exitCode).toBe(0);
	});

	it('handles unicode content', async () => {
		const content = 'hello \u{1f600} world\n';
		const r = await cat.execute(['/u.txt'], makeCtx({ '/u.txt': content }));
		expect(r.stdout).toBe(content);
	});

	it('combines -n and -s', async () => {
		const r = await cat.execute(['-ns', '/f.txt'], makeCtx({ '/f.txt': 'a\n\n\nb\n' }));
		expect(r.stdout).toContain('     1\ta');
		expect(r.stdout).toContain('     3\tb');
	});
});
