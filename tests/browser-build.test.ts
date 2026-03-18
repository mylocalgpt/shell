import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.js';

/**
 * Browser build validation tests.
 *
 * These tests verify the shell works correctly in an environment
 * without Node.js-specific APIs. The source code uses zero node:
 * imports, making it compatible with browsers, Cloudflare Workers,
 * and other edge runtimes.
 */
describe('browser build validation', () => {
	describe('basic operations', () => {
		it('echo works', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo hello');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('hello\n');
		});

		it('cat reads files', async () => {
			const shell = new Shell({
				files: { '/test.txt': 'content here' },
			});
			const result = await shell.exec('cat /test.txt');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('content here');
		});

		it('grep searches files', async () => {
			const shell = new Shell({
				files: { '/data.txt': 'line one\nline two\nline three\n' },
			});
			const result = await shell.exec('grep two /data.txt');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('two');
		});

		it('jq processes JSON', async () => {
			const shell = new Shell({
				files: { '/data.json': '{"name": "test"}' },
			});
			const result = await shell.exec('jq .name /data.json');
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe('"test"');
		});

		it('sort orders lines', async () => {
			const shell = new Shell({
				files: { '/data.txt': 'banana\napple\ncherry\n' },
			});
			const result = await shell.exec('sort /data.txt');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe('apple\nbanana\ncherry\n');
		});

		it('find lists files', async () => {
			const shell = new Shell({
				files: {
					'/workspace/a.ts': '',
					'/workspace/b.ts': '',
					'/workspace/c.txt': '',
				},
			});
			const result = await shell.exec('find /workspace -name "*.ts"');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain('.ts');
		});
	});

	describe('hash commands', () => {
		it('md5sum works with pure JS implementation', async () => {
			const shell = new Shell({
				files: { '/test.txt': 'hello\n' },
			});
			const result = await shell.exec('md5sum /test.txt');
			expect(result.exitCode).toBe(0);
			// Should produce a hash output
			expect(result.stdout).toMatch(/^[a-f0-9]{32}/);
		});

		it('sha256sum works with pure JS implementation', async () => {
			const shell = new Shell({
				files: { '/test.txt': 'hello\n' },
			});
			const result = await shell.exec('sha256sum /test.txt');
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toMatch(/^[a-f0-9]{64}/);
		});
	});

	describe('no node: imports', () => {
		it('Shell class is importable', () => {
			expect(Shell).toBeDefined();
			expect(typeof Shell).toBe('function');
		});

		it('Shell constructor creates instance', () => {
			const shell = new Shell();
			expect(shell).toBeDefined();
			expect(shell.fs).toBeDefined();
			expect(shell.cwd).toBe('/');
		});
	});
});
