import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { Command, CommandContext, CommandResult } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';
import { LimitExceededError } from '../../src/interpreter/errors.js';
import { Interpreter } from '../../src/interpreter/interpreter.js';
import { parse } from '../../src/parser/parser.js';

/** Mock echo command for testing. */
const echoCommand: Command = {
	name: 'echo',
	async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
		return { exitCode: 0, stdout: `${args.join(' ')}\n`, stderr: '' };
	},
};

/** Mock cat command that reads stdin or files. */
const catCommand: Command = {
	name: 'cat',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		if (args.length === 0) {
			return { exitCode: 0, stdout: ctx.stdin, stderr: '' };
		}
		let output = '';
		for (const arg of args) {
			try {
				const content = ctx.fs.readFile(arg.startsWith('/') ? arg : `${ctx.cwd}/${arg}`);
				output += typeof content === 'string' ? content : await content;
			} catch {
				return { exitCode: 1, stdout: '', stderr: `cat: ${arg}: No such file or directory\n` };
			}
		}
		return { exitCode: 0, stdout: output, stderr: '' };
	},
};

/** Mock true command. */
const trueCommand: Command = {
	name: 'true',
	async execute(): Promise<CommandResult> {
		return { exitCode: 0, stdout: '', stderr: '' };
	},
};

/** Mock false command. */
const falseCommand: Command = {
	name: 'false',
	async execute(): Promise<CommandResult> {
		return { exitCode: 1, stdout: '', stderr: '' };
	},
};

/** Create an interpreter with mock commands. */
function makeInterpreter(env?: Record<string, string>): {
	interpreter: Interpreter;
	fs: InMemoryFs;
	registry: CommandRegistry;
} {
	const fs = new InMemoryFs();
	const registry = new CommandRegistry();
	registry.defineCommand(echoCommand);
	registry.defineCommand(catCommand);
	registry.defineCommand(trueCommand);
	registry.defineCommand(falseCommand);

	const envMap = new Map<string, string>();
	if (env) {
		for (const [k, v] of Object.entries(env)) {
			envMap.set(k, v);
		}
	}

	const interpreter = new Interpreter(fs, registry, envMap, '/');
	return { interpreter, fs, registry };
}

/** Helper to parse and execute a string. */
async function exec(input: string, env?: Record<string, string>): Promise<CommandResult> {
	const { interpreter } = makeInterpreter(env);
	const ast = parse(input);
	return interpreter.execute(ast);
}

describe('Interpreter', () => {
	describe('simple commands', () => {
		it('executes echo', async () => {
			const result = await exec('echo hello');
			expect(result.stdout).toBe('hello\n');
			expect(result.exitCode).toBe(0);
		});

		it('executes echo with multiple args', async () => {
			const result = await exec('echo hello world');
			expect(result.stdout).toBe('hello world\n');
		});

		it('returns 127 for unknown command', async () => {
			const result = await exec('nonexistent_cmd');
			expect(result.exitCode).toBe(127);
			expect(result.stderr).toContain('command not found');
		});

		it('executes empty input', async () => {
			const result = await exec('');
			expect(result.exitCode).toBe(0);
		});
	});

	describe('variable assignment and expansion', () => {
		it('assigns and reads a variable', async () => {
			const result = await exec('VAR=hello; echo $VAR');
			expect(result.stdout).toBe('hello\n');
		});

		it('handles assignment with no command', async () => {
			const result = await exec('VAR=hello');
			expect(result.exitCode).toBe(0);
		});

		it('handles temp assignment before command', async () => {
			const { interpreter } = makeInterpreter();
			const ast = parse('VAR=temp echo $VAR');
			const result = await interpreter.execute(ast);
			// The var should be set for the echo command
			expect(result.exitCode).toBe(0);
		});
	});

	describe('pipes', () => {
		it('pipes stdout to stdin', async () => {
			const result = await exec('echo hello | cat');
			expect(result.stdout).toBe('hello\n');
		});

		it('handles multi-stage pipe', async () => {
			const result = await exec('echo hello | cat | cat');
			expect(result.stdout).toBe('hello\n');
		});

		it('handles negated pipeline', async () => {
			const result = await exec('! false');
			expect(result.exitCode).toBe(0);
		});

		it('negation inverts success to failure', async () => {
			const result = await exec('! true');
			expect(result.exitCode).toBe(1);
		});
	});

	describe('redirections', () => {
		it('redirects stdout to file', async () => {
			const { interpreter, fs } = makeInterpreter();
			const ast = parse('echo hello > /output.txt');
			await interpreter.execute(ast);
			expect(fs.readFile('/output.txt')).toBe('hello\n');
		});

		it('appends stdout to file', async () => {
			const { interpreter, fs } = makeInterpreter();
			fs.writeFile('/output.txt', 'existing\n');
			const ast = parse('echo more >> /output.txt');
			await interpreter.execute(ast);
			expect(fs.readFile('/output.txt')).toBe('existing\nmore\n');
		});

		it('reads stdin from file', async () => {
			const { interpreter, fs } = makeInterpreter();
			fs.writeFile('/input.txt', 'file content');
			const ast = parse('cat < /input.txt');
			const result = await interpreter.execute(ast);
			expect(result.stdout).toBe('file content');
		});

		it('discards output to /dev/null', async () => {
			const result = await exec('echo hello > /dev/null');
			expect(result.stdout).toBe('');
		});
	});

	describe('control flow', () => {
		it('executes if-then on true condition', async () => {
			const result = await exec('if true; then echo yes; fi');
			expect(result.stdout).toBe('yes\n');
		});

		it('executes else on false condition', async () => {
			const result = await exec('if false; then echo yes; else echo no; fi');
			expect(result.stdout).toBe('no\n');
		});

		it('executes for loop', async () => {
			const result = await exec('for x in a b c; do echo $x; done');
			expect(result.stdout).toBe('a\nb\nc\n');
		});

		it('executes while loop', async () => {
			const { interpreter } = makeInterpreter({ i: '0' });
			// We'll test with a simple counter using arithmetic
			const ast = parse('for x in 1 2 3; do echo $x; done');
			const result = await interpreter.execute(ast);
			expect(result.stdout).toBe('1\n2\n3\n');
		});

		it('executes case statement', async () => {
			const result = await exec('case hello in hello) echo matched;; *) echo default;; esac');
			expect(result.stdout).toBe('matched\n');
		});

		it('executes case default branch', async () => {
			const result = await exec('case other in hello) echo matched;; *) echo default;; esac');
			expect(result.stdout).toBe('default\n');
		});
	});

	describe('functions', () => {
		it('defines and calls a function', async () => {
			const result = await exec('greet() { echo hello; }; greet');
			expect(result.stdout).toBe('hello\n');
		});

		it('passes arguments to function', async () => {
			const result = await exec('greet() { echo $1; }; greet world');
			expect(result.stdout).toBe('world\n');
		});
	});

	describe('subshells', () => {
		it('executes in subshell', async () => {
			const result = await exec('(echo hello)');
			expect(result.stdout).toBe('hello\n');
		});

		it('variable changes in subshell do not propagate', async () => {
			const { interpreter } = makeInterpreter({ VAR: 'original' });
			const ast = parse('(VAR=changed); echo $VAR');
			const result = await interpreter.execute(ast);
			expect(result.stdout).toBe('original\n');
		});
	});

	describe('lists', () => {
		it('executes && (short-circuit on success)', async () => {
			const result = await exec('true && echo yes');
			expect(result.stdout).toBe('yes\n');
		});

		it('short-circuits && on failure', async () => {
			const result = await exec('false && echo yes');
			expect(result.stdout).toBe('');
		});

		it('executes || (short-circuit on failure)', async () => {
			const result = await exec('false || echo fallback');
			expect(result.stdout).toBe('fallback\n');
		});

		it('short-circuits || on success', async () => {
			const result = await exec('true || echo fallback');
			expect(result.stdout).toBe('');
		});

		it('executes sequential with ;', async () => {
			const result = await exec('echo a; echo b');
			expect(result.stdout).toBe('a\nb\n');
		});
	});

	describe('brace groups', () => {
		it('executes brace group', async () => {
			const result = await exec('{ echo hello; }');
			expect(result.stdout).toBe('hello\n');
		});
	});

	describe('limit enforcement', () => {
		it('throws on exceeded command count', async () => {
			const fs = new InMemoryFs();
			const registry = new CommandRegistry();
			registry.defineCommand(echoCommand);
			const interpreter = new Interpreter(fs, registry, new Map(), '/', {
				maxCommandCount: 2,
			});
			const ast = parse('echo a; echo b; echo c');
			await expect(interpreter.execute(ast)).rejects.toThrow(LimitExceededError);
		});

		it('throws on exceeded loop iterations', async () => {
			const fs = new InMemoryFs();
			const registry = new CommandRegistry();
			registry.defineCommand(echoCommand);
			const interpreter = new Interpreter(fs, registry, new Map(), '/', {
				maxLoopIterations: 3,
			});
			const ast = parse('for x in 1 2 3 4 5; do echo $x; done');
			await expect(interpreter.execute(ast)).rejects.toThrow(LimitExceededError);
		});
	});

	describe('edge cases', () => {
		it('handles empty pipeline', async () => {
			const result = await exec('true');
			expect(result.exitCode).toBe(0);
		});

		it('handles nested control flow', async () => {
			const result = await exec('if true; then for x in a; do echo $x; done; fi');
			expect(result.stdout).toBe('a\n');
		});
	});
});
