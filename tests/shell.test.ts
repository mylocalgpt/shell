import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.js';

describe('Shell.exec()', () => {
	describe('acceptance criteria', () => {
		it('1. echo hello | cat works', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo hello | cat');
			expect(result.stdout).toBe('hello\n');
			expect(result.exitCode).toBe(0);
		});

		it('2. VAR=hello; echo $VAR works', async () => {
			const shell = new Shell();
			const result = await shell.exec('VAR=hello; echo $VAR');
			expect(result.stdout).toBe('hello\n');
		});

		it('3. for loop works', async () => {
			const shell = new Shell();
			const result = await shell.exec('for i in 1 2 3; do echo $i; done');
			expect(result.stdout).toBe('1\n2\n3\n');
		});

		it('4. function with local works', async () => {
			const shell = new Shell();
			const result = await shell.exec('fn() { local x=1; echo $x; }; fn');
			expect(result.stdout).toBe('1\n');
		});

		it('5. set -e stops at false', async () => {
			const shell = new Shell();
			const result = await shell.exec('set -e; false; echo nope');
			expect(result.stdout).not.toContain('nope');
			expect(result.exitCode).toBe(1);
		});

		it('6. command substitution works', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo "$(echo nested)"');
			expect(result.stdout).toBe('nested\n');
		});

		it('7. heredoc works', async () => {
			const shell = new Shell();
			const result = await shell.exec('cat <<EOF\nhello\nEOF');
			expect(result.stdout).toBe('hello\n');
		});

		it('8. conditional expression works', async () => {
			const shell = new Shell();
			shell.getFs().writeFile('/test', 'content');
			const result = await shell.exec('if [[ -f /test ]]; then echo yes; fi');
			expect(result.stdout).toBe('yes\n');
		});

		it('10. arithmetic $((2 + 3 * 4)) outputs 14', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo $((2 + 3 * 4))');
			expect(result.stdout).toBe('14\n');
		});

		it('11. string substitution ${x/hello/world}', async () => {
			const shell = new Shell();
			const result = await shell.exec('x=hello; echo ${x/hello/world}');
			expect(result.stdout).toBe('world\n');
		});

		it('12. brace expansion {1..5}', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo {1..5}');
			expect(result.stdout).toBe('1 2 3 4 5\n');
		});

		it('13. unsupported syntax produces actionable error', async () => {
			const shell = new Shell();
			const result = await shell.exec('trap exit EXIT');
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.length).toBeGreaterThan(0);
		});

		it('14. filesystem persists across calls', async () => {
			const shell = new Shell();
			await shell.exec('echo content > /test.txt');
			// Verify file exists for second call
			const result = await shell.exec('cat /test.txt');
			expect(result.stdout).toBe('content\n');
		});
	});

	describe('error handling', () => {
		it('returns parse error as stderr with exit code 2', async () => {
			const shell = new Shell();
			const result = await shell.exec('if; then');
			expect(result.exitCode).toBe(2);
			expect(result.stderr.length).toBeGreaterThan(0);
		});

		it('never throws to the caller', async () => {
			const shell = new Shell();
			// Even with malformed input, no exception
			const result = await shell.exec('((((');
			expect(typeof result.exitCode).toBe('number');
		});
	});

	describe('constructor options', () => {
		it('accepts custom env', async () => {
			const shell = new Shell({ env: { MY_VAR: 'custom' } });
			const result = await shell.exec('echo $MY_VAR');
			expect(result.stdout).toBe('custom\n');
		});

		it('accepts custom cwd', async () => {
			const shell = new Shell({ cwd: '/home' });
			const result = await shell.exec('pwd');
			expect(result.stdout).toBe('/home\n');
		});

		it('sets default env variables', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo $HOME');
			expect(result.stdout).toBe('/root\n');
		});
	});

	describe('state management', () => {
		it('resets env between exec calls', async () => {
			const shell = new Shell();
			await shell.exec('MY_VAR=hello');
			const result = await shell.exec('echo ${MY_VAR:-unset}');
			expect(result.stdout).toBe('unset\n');
		});
	});
});
