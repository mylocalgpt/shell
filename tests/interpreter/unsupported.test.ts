import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { CommandResult } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';
import { registerBuiltins } from '../../src/interpreter/builtins.js';
import { Interpreter } from '../../src/interpreter/interpreter.js';
import { parse } from '../../src/parser/parser.js';

async function exec(input: string): Promise<CommandResult> {
	const fs = new InMemoryFs();
	const registry = new CommandRegistry();
	const interpreter = new Interpreter(fs, registry, new Map(), '/');
	registerBuiltins(interpreter);
	const ast = parse(input);
	return interpreter.execute(ast);
}

describe('Unsupported Features', () => {
	it('trap produces actionable error', async () => {
		const result = await exec('trap "echo exit" EXIT');
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('signal traps not supported');
	});

	it('getopts produces actionable error with alternative', async () => {
		const result = await exec('getopts abc opt');
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('getopts not supported');
		expect(result.stderr).toContain('case statements');
	});

	it('declare -A produces actionable error', async () => {
		const result = await exec('declare -A mymap');
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('associative arrays');
		expect(result.stderr).toContain('not supported');
	});

	it('declare -n produces actionable error', async () => {
		const result = await exec('declare -n ref');
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('namerefs');
		expect(result.stderr).toContain('not supported');
	});
});
