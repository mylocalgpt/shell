import { describe, expect, it } from 'vitest';
import { file } from '../../src/commands/file.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>): CommandContext {
	const fs = new InMemoryFs(files);
	return {
		fs,
		cwd: '/',
		env: new Map(),
		stdin: '',
		exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
	};
}

describe('file', () => {
	it('detects empty file', async () => {
		const ctx = makeCtx({ '/empty': '' });
		const r = await file.execute(['/empty'], ctx);
		expect(r.stdout).toContain('empty');
	});

	it('detects JSON', async () => {
		const ctx = makeCtx({ '/data.json': '{"key": "value"}' });
		const r = await file.execute(['/data.json'], ctx);
		expect(r.stdout).toContain('json');
	});

	it('detects shell script', async () => {
		const ctx = makeCtx({ '/script.sh': '#!/bin/bash\necho hello\n' });
		const r = await file.execute(['/script.sh'], ctx);
		expect(r.stdout).toContain('shellscript');
	});

	it('detects ASCII text', async () => {
		const ctx = makeCtx({ '/text.txt': 'Hello, world!\n' });
		const r = await file.execute(['/text.txt'], ctx);
		expect(r.stdout).toContain('text/plain');
		expect(r.stdout).toContain('ascii');
	});

	it('detects UTF-8 text', async () => {
		const ctx = makeCtx({ '/utf8.txt': 'Hello \u{1f600}\n' });
		const r = await file.execute(['/utf8.txt'], ctx);
		expect(r.stdout).toContain('utf-8');
	});

	it('detects XML', async () => {
		const ctx = makeCtx({ '/doc.xml': '<?xml version="1.0"?><root/>' });
		const r = await file.execute(['/doc.xml'], ctx);
		expect(r.stdout).toContain('xml');
	});

	it('detects directory', async () => {
		const ctx = makeCtx();
		ctx.fs.mkdir('/mydir');
		const r = await file.execute(['/mydir'], ctx);
		expect(r.stdout).toContain('directory');
	});

	it('reports missing file', async () => {
		const ctx = makeCtx();
		const r = await file.execute(['/nope'], ctx);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain('No such file or directory');
	});

	it('reports missing operand', async () => {
		const ctx = makeCtx();
		const r = await file.execute([], ctx);
		expect(r.exitCode).toBe(1);
	});

	it('handles multiple files', async () => {
		const ctx = makeCtx({ '/a.json': '{}', '/b.txt': 'hello' });
		const r = await file.execute(['/a.json', '/b.txt'], ctx);
		expect(r.stdout).toContain('json');
		expect(r.stdout).toContain('text/plain');
	});
});
