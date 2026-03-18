import { describe, expect, it } from 'vitest';
import { registerDefaultCommands } from '../../src/commands/defaults.js';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { CommandResult } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';
import { registerBuiltins } from '../../src/interpreter/builtins.js';
import { Interpreter } from '../../src/interpreter/interpreter.js';
import { parse } from '../../src/parser/parser.js';

/** Create an interpreter with builtins and default commands registered. */
function makeInterpreter(env?: Record<string, string>): {
	interpreter: Interpreter;
	fs: InMemoryFs;
} {
	const fs = new InMemoryFs();
	const registry = new CommandRegistry();
	registerDefaultCommands(registry);
	const envMap = new Map<string, string>();
	if (env) {
		for (const [k, v] of Object.entries(env)) {
			envMap.set(k, v);
		}
	}
	const interpreter = new Interpreter(fs, registry, envMap, '/');
	registerBuiltins(interpreter);
	return { interpreter, fs };
}

async function exec(input: string, env?: Record<string, string>): Promise<CommandResult> {
	const { interpreter } = makeInterpreter(env);
	const ast = parse(input);
	return interpreter.execute(ast);
}

async function execWith(
	input: string,
	setup: (fs: InMemoryFs, interp: Interpreter) => void,
): Promise<CommandResult> {
	const { interpreter, fs } = makeInterpreter();
	setup(fs, interpreter);
	const ast = parse(input);
	return interpreter.execute(ast);
}

describe('Shell Builtins', () => {
	describe('echo', () => {
		it('prints arguments', async () => {
			const result = await exec('echo hello world');
			expect(result.stdout).toBe('hello world\n');
		});

		it('handles -n flag (no newline)', async () => {
			const result = await exec('echo -n hello');
			expect(result.stdout).toBe('hello');
		});

		it('prints empty line with no args', async () => {
			const result = await exec('echo');
			expect(result.stdout).toBe('\n');
		});
	});

	describe('cd', () => {
		it('changes to absolute path', async () => {
			const result = await execWith('cd /home; pwd', (fs) => {
				fs.mkdir('/home');
			});
			expect(result.stdout).toBe('/home\n');
		});

		it('changes to HOME with no args', async () => {
			const result = await execWith('cd; pwd', (fs) => {
				fs.mkdir('/home/user', { recursive: true });
			});
			// HOME not set, defaults to /
			expect(result.stdout).toBe('/\n');
		});

		it('errors on nonexistent path', async () => {
			const result = await exec('cd /nonexistent');
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('No such file');
		});
	});

	describe('set', () => {
		it('sets errexit flag', async () => {
			const result = await exec('set -e; true');
			expect(result.exitCode).toBe(0);
		});

		it('sets combined flags', async () => {
			const result = await exec('set -eu; true');
			expect(result.exitCode).toBe(0);
		});

		it('sets pipefail via -o', async () => {
			const result = await exec('set -o pipefail; true');
			expect(result.exitCode).toBe(0);
		});

		it('parses -euo pipefail (common LLM pattern)', async () => {
			const result = await exec('set -euo pipefail; echo ok');
			expect(result.stdout).toBe('ok\n');
		});
	});

	describe('export', () => {
		it('exports a variable with value', async () => {
			const result = await exec('export VAR=hello; echo $VAR');
			expect(result.stdout).toBe('hello\n');
		});
	});

	describe('test / [', () => {
		it('tests string equality', async () => {
			const result = await exec('test hello = hello');
			expect(result.exitCode).toBe(0);
		});

		it('tests string inequality', async () => {
			const result = await exec('test hello != world');
			expect(result.exitCode).toBe(0);
		});

		it('tests -z for empty string', async () => {
			const result = await exec('test -z ""');
			expect(result.exitCode).toBe(0);
		});

		it('tests -n for non-empty string', async () => {
			const result = await exec('test -n hello');
			expect(result.exitCode).toBe(0);
		});

		it('tests -f for file existence', async () => {
			const result = await execWith('test -f /file.txt', (fs) => {
				fs.writeFile('/file.txt', 'content');
			});
			expect(result.exitCode).toBe(0);
		});

		it('tests -d for directory', async () => {
			const result = await execWith('test -d /mydir', (fs) => {
				fs.mkdir('/mydir');
			});
			expect(result.exitCode).toBe(0);
		});

		it('tests arithmetic -eq', async () => {
			const result = await exec('test 5 -eq 5');
			expect(result.exitCode).toBe(0);
		});

		it('tests arithmetic -gt', async () => {
			const result = await exec('test 5 -gt 3');
			expect(result.exitCode).toBe(0);
		});

		it('bracket form requires ]', async () => {
			const result = await exec('[ hello = hello ]');
			expect(result.exitCode).toBe(0);
		});
	});

	describe('true / false', () => {
		it('true returns 0', async () => {
			const result = await exec('true');
			expect(result.exitCode).toBe(0);
		});

		it('false returns 1', async () => {
			const result = await exec('false');
			expect(result.exitCode).toBe(1);
		});
	});

	describe('exit', () => {
		it('exits with code 0', async () => {
			const result = await exec('exit 0');
			expect(result.exitCode).toBe(0);
		});

		it('exits with custom code', async () => {
			const result = await exec('exit 42');
			expect(result.exitCode).toBe(42);
		});
	});

	describe('eval', () => {
		it('evaluates a string as command', async () => {
			const result = await exec('eval echo hello');
			expect(result.stdout).toBe('hello\n');
		});
	});

	describe('source', () => {
		it('sources a file', async () => {
			const result = await execWith('source /script.sh', (fs) => {
				fs.writeFile('/script.sh', 'echo sourced');
			});
			expect(result.stdout).toBe('sourced\n');
		});

		it('errors on nonexistent file', async () => {
			const result = await exec('source /nonexistent.sh');
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain('No such file');
		});
	});

	describe('pwd', () => {
		it('prints current directory', async () => {
			const result = await exec('pwd');
			expect(result.stdout).toBe('/\n');
		});
	});

	describe('read', () => {
		it('reads from stdin', async () => {
			const { interpreter, fs } = makeInterpreter();
			// We need to provide stdin - read uses builtin context stdin
			// For now, test that read with empty stdin returns 1
			const ast = parse('read VAR');
			const result = await interpreter.execute(ast);
			expect(result.exitCode).toBe(1);
		});
	});

	describe('flow control', () => {
		it('break exits a for loop', async () => {
			const result = await exec('for x in 1 2 3; do echo $x; break; done');
			expect(result.stdout).toBe('1\n');
		});

		it('continue skips to next iteration', async () => {
			const result = await exec(
				'for x in 1 2 3; do if test $x = 2; then continue; fi; echo $x; done',
			);
			expect(result.stdout).toBe('1\n3\n');
		});
	});

	describe('type', () => {
		it('identifies a builtin', async () => {
			const result = await exec('type cd');
			expect(result.stdout).toContain('builtin');
		});

		it('type -t returns builtin', async () => {
			const result = await exec('type -t cd');
			expect(result.stdout).toBe('builtin\n');
		});
	});

	describe('unset', () => {
		it('removes a variable', async () => {
			const result = await exec('VAR=hello; unset VAR; echo ${VAR:-gone}');
			expect(result.stdout).toBe('gone\n');
		});
	});
});
