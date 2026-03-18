import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';

function makeShell(files?: Record<string, string>): Shell {
	const shell = new Shell();
	if (files) {
		const fs = shell.getFs();
		const keys = Object.keys(files);
		for (let i = 0; i < keys.length; i++) {
			fs.writeFile(keys[i], files[keys[i]]);
		}
	}
	return shell;
}

describe('find + xargs integration', () => {
	it('find -name *.txt', async () => {
		const shell = makeShell({
			'/project/a.txt': '',
			'/project/b.md': '',
			'/project/sub/c.txt': '',
		});
		const r = await shell.exec('find /project -name "*.txt"');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('a.txt');
		expect(r.stdout).toContain('c.txt');
		expect(r.stdout).not.toContain('b.md');
	});

	it('find -type f', async () => {
		const shell = makeShell({
			'/dir/file.txt': '',
			'/dir/sub/other.txt': '',
		});
		const r = await shell.exec('find /dir -type f');
		expect(r.stdout).toContain('file.txt');
		expect(r.stdout).toContain('other.txt');
	});

	it('find -maxdepth 1 -type d', async () => {
		const shell = makeShell({
			'/root/sub/deep/file.txt': '',
		});
		const r = await shell.exec('find /root -maxdepth 1 -type d');
		expect(r.stdout).toContain('/root');
		expect(r.stdout).toContain('sub');
		expect(r.stdout).not.toContain('deep');
	});

	it('find | wc -l counts files', async () => {
		const shell = makeShell({
			'/dir/a.txt': '',
			'/dir/b.txt': '',
			'/dir/c.txt': '',
		});
		const r = await shell.exec('find /dir -type f | wc -l');
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toContain('3');
	});
});
