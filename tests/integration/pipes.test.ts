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

describe('pipe integration', () => {
	it('cat | grep | sort', async () => {
		const shell = makeShell({
			'/data.txt': 'banana\napple\ncherry\napple\nbanana\n',
		});
		const r = await shell.exec('cat /data.txt | grep a | sort -u');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe('apple\nbanana\n');
	});

	it('echo | cut | sort -n', async () => {
		const shell = makeShell();
		const r = await shell.exec('echo "3,a\n1,b\n2,c" | sort -t, -n');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('1,b');
	});

	it('seq | sort -n | tail', async () => {
		const shell = makeShell();
		const r = await shell.exec('seq 1 20 | tail -n 5');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('16');
		expect(r.stdout).toContain('20');
	});

	it('cat | sort | uniq', async () => {
		const shell = makeShell({ '/words.txt': 'hello\nworld\nhello\n' });
		const r = await shell.exec('cat /words.txt | sort | uniq');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe('hello\nworld\n');
	});

	it('cat | sed | tee', async () => {
		const shell = makeShell({ '/input.txt': 'hello world\n' });
		const r = await shell.exec('cat /input.txt | sed "s/hello/goodbye/" | tee /output.txt');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe('goodbye world\n');
		expect(shell.getFs().readFile('/output.txt')).toBe('goodbye world\n');
	});

	it('ls | grep', async () => {
		const shell = makeShell({
			'/dir/file1.txt': '',
			'/dir/file2.md': '',
			'/dir/file3.txt': '',
		});
		const r = await shell.exec('ls /dir | grep txt');
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain('file1.txt');
		expect(r.stdout).toContain('file3.txt');
		expect(r.stdout).not.toContain('file2.md');
	});

	it('echo | wc -w', async () => {
		const shell = makeShell();
		const r = await shell.exec('echo "one two three" | wc -w');
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toContain('3');
	});
});
