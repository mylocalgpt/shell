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

describe('redirection integration', () => {
	it('grep to output file', async () => {
		const shell = makeShell({ '/data.txt': 'hello\nworld\n' });
		const r = await shell.exec('grep hello /data.txt > /output.txt');
		expect(r.exitCode).toBe(0);
		expect(shell.getFs().readFile('/output.txt')).toBe('hello\n');
	});

	it('echo append', async () => {
		const shell = makeShell();
		await shell.exec('echo first > /file.txt');
		await shell.exec('echo second >> /file.txt');
		const content = shell.getFs().readFile('/file.txt');
		expect(content).toContain('first');
		expect(content).toContain('second');
	});

	it('stderr redirect to /dev/null', async () => {
		const shell = makeShell();
		const r = await shell.exec('cat /nonexistent 2>/dev/null');
		expect(r.stderr).toBe('');
	});

	it('sed -i in-place editing', async () => {
		const shell = makeShell({ '/file.txt': 'hello world\n' });
		await shell.exec('sed -i "s/hello/goodbye/" /file.txt');
		expect(shell.getFs().readFile('/file.txt')).toBe('goodbye world\n');
	});
});
