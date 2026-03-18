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
			shell.fs.writeFile('/test', 'content');
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

		it('accepts files option with string content', async () => {
			const shell = new Shell({
				files: { '/workspace/data.txt': 'hello world' },
			});
			const result = await shell.exec('cat /workspace/data.txt');
			expect(result.stdout).toBe('hello world');
		});

		it('accepts files option with lazy content', async () => {
			const shell = new Shell({
				files: { '/workspace/lazy.txt': () => 'lazy content' },
			});
			const result = await shell.exec('cat /workspace/lazy.txt');
			expect(result.stdout).toBe('lazy content');
		});

		it('accepts custom commands', async () => {
			const shell = new Shell({
				commands: {
					'my-tool': async (args) => ({
						stdout: `tool: ${args.join(' ')}\n`,
						stderr: '',
						exitCode: 0,
					}),
				},
			});
			const result = await shell.exec('my-tool hello world');
			expect(result.stdout).toBe('tool: hello world\n');
		});

		it('custom commands work in pipes', async () => {
			const shell = new Shell({
				commands: {
					upper: async (_args, ctx) => ({
						stdout: ctx.stdin.toUpperCase(),
						stderr: '',
						exitCode: 0,
					}),
				},
			});
			const result = await shell.exec('echo hello | upper');
			expect(result.stdout).toBe('HELLO\n');
		});

		it('onUnknownCommand callback fires for unregistered commands', async () => {
			const shell = new Shell({
				onUnknownCommand: async (name, args) => ({
					stdout: `unknown: ${name} ${args.join(' ')}\n`,
					stderr: '',
					exitCode: 0,
				}),
			});
			const result = await shell.exec('nonexistent-cmd foo bar');
			expect(result.stdout).toBe('unknown: nonexistent-cmd foo bar\n');
		});

		it('onOutput hook can modify output', async () => {
			const shell = new Shell({
				onOutput: (result) => ({
					...result,
					stdout: result.stdout.toUpperCase(),
				}),
			});
			const result = await shell.exec('echo hello');
			expect(result.stdout).toBe('HELLO\n');
		});

		it('hostname option sets HOSTNAME env var', async () => {
			const shell = new Shell({ hostname: 'test-host' });
			const result = await shell.exec('hostname');
			expect(result.stdout).toBe('test-host\n');
		});

		it('username option sets USER env var', async () => {
			const shell = new Shell({ username: 'agent' });
			const result = await shell.exec('whoami');
			expect(result.stdout).toBe('agent\n');
		});

		it('enabledCommands filters available commands', async () => {
			const shell = new Shell({ enabledCommands: ['echo'] });
			const echoResult = await shell.exec('echo hello');
			expect(echoResult.exitCode).toBe(0);
			expect(echoResult.stdout).toBe('hello\n');

			const catResult = await shell.exec('cat /test');
			expect(catResult.exitCode).not.toBe(0);
		});

		it('sets default env variables', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo $HOME');
			expect(result.stdout).toBe('/root\n');
		});
	});

	describe('exec options', () => {
		it('per-call env overrides', async () => {
			const shell = new Shell();
			const result = await shell.exec('echo $MY_INPUT', {
				env: { MY_INPUT: 'per-call-value' },
			});
			expect(result.stdout).toBe('per-call-value\n');
		});

		it('per-call cwd override', async () => {
			const shell = new Shell();
			shell.fs.writeFile('/workspace/file.txt', 'data');
			const result = await shell.exec('pwd', { cwd: '/workspace' });
			expect(result.stdout).toBe('/workspace\n');
		});

		it('AbortSignal cancellation', async () => {
			const controller = new AbortController();
			controller.abort();
			const shell = new Shell();
			const result = await shell.exec('echo hello', {
				signal: controller.signal,
			});
			expect(result.exitCode).toBe(130);
			expect(result.stderr).toContain('aborted');
		});

		it('timeout option', async () => {
			const shell = new Shell();
			// Very short timeout with a long-running command
			const result = await shell.exec('echo quick', { timeout: 5000 });
			// Quick command should complete within timeout
			expect(result.exitCode).toBe(0);
		});
	});

	describe('state management', () => {
		it('env persists across exec calls via export', async () => {
			const shell = new Shell();
			await shell.exec('export MY_VAR=hello');
			const result = await shell.exec('echo $MY_VAR');
			expect(result.stdout).toBe('hello\n');
		});

		it('functions persist across exec calls', async () => {
			const shell = new Shell();
			await shell.exec('greet() { echo "Hello $1"; }');
			const result = await shell.exec('greet World');
			expect(result.stdout).toBe('Hello World\n');
		});

		it('cwd persists via cd', async () => {
			const shell = new Shell();
			shell.fs.writeFile('/workspace/test.txt', 'data');
			await shell.exec('cd /workspace');
			const result = await shell.exec('pwd');
			expect(result.stdout).toBe('/workspace\n');
		});

		it('shell options reset between calls', async () => {
			const shell = new Shell();
			await shell.exec('set -e');
			// set -e should have been reset; false should not abort
			const result = await shell.exec('false; echo still-here');
			expect(result.stdout).toContain('still-here');
		});

		it('per-call env does not persist', async () => {
			const shell = new Shell();
			await shell.exec('echo $TEMP_VAR', { env: { TEMP_VAR: 'temp' } });
			const result = await shell.exec('echo ${TEMP_VAR:-unset}');
			expect(result.stdout).toBe('unset\n');
		});
	});

	describe('accessors', () => {
		it('shell.fs getter exposes filesystem', () => {
			const shell = new Shell({
				files: { '/test.txt': 'content' },
			});
			expect(shell.fs.readFile('/test.txt')).toBe('content');
		});

		it('shell.cwd returns current working directory', () => {
			const shell = new Shell();
			expect(shell.cwd).toBe('/');
		});

		it('shell.env returns environment Map', () => {
			const shell = new Shell({ env: { CUSTOM: 'value' } });
			expect(shell.env.get('CUSTOM')).toBe('value');
		});
	});

	describe('defineCommand', () => {
		it('registers command that works in pipes', async () => {
			const shell = new Shell();
			shell.defineCommand('reverse', async (_args, ctx) => {
				const reversed = ctx.stdin.split('').reverse().join('');
				return { stdout: reversed, stderr: '', exitCode: 0 };
			});
			const result = await shell.exec('echo abc | reverse');
			expect(result.stdout).toContain('cba');
		});
	});

	describe('reset', () => {
		it('clears env and functions but keeps filesystem', async () => {
			const shell = new Shell();
			await shell.exec('export MY_VAR=hello');
			await shell.exec('echo data > /test.txt');
			shell.reset();

			// Env should be reset
			const envResult = await shell.exec('echo ${MY_VAR:-unset}');
			expect(envResult.stdout).toBe('unset\n');

			// Filesystem should persist
			const fsResult = await shell.exec('cat /test.txt');
			expect(fsResult.stdout).toBe('data\n');
		});

		it('resets cwd to initial', async () => {
			const shell = new Shell();
			shell.fs.writeFile('/workspace/test.txt', '');
			await shell.exec('cd /workspace');
			shell.reset();
			expect(shell.cwd).toBe('/');
		});
	});
});
