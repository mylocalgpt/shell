import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { CommandResult } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';
import { registerBuiltins } from '../../src/interpreter/builtins.js';
import { Interpreter } from '../../src/interpreter/interpreter.js';
import { parse } from '../../src/parser/parser.js';

function makeInterpreter(env?: Record<string, string>): Interpreter {
	const fs = new InMemoryFs();
	const registry = new CommandRegistry();
	const envMap = new Map<string, string>();
	if (env) {
		for (const [k, v] of Object.entries(env)) {
			envMap.set(k, v);
		}
	}
	const interpreter = new Interpreter(fs, registry, envMap, '/');
	registerBuiltins(interpreter);
	return interpreter;
}

async function exec(input: string, env?: Record<string, string>): Promise<CommandResult> {
	const interpreter = makeInterpreter(env);
	const ast = parse(input);
	return interpreter.execute(ast);
}

describe('Errexit (set -e)', () => {
	it('stops execution on failure', async () => {
		const result = await exec('set -e; false; echo nope');
		expect(result.stdout).not.toContain('nope');
		expect(result.exitCode).toBe(1);
	});

	it('continues on success', async () => {
		const result = await exec('set -e; true; echo yes');
		expect(result.stdout).toBe('yes\n');
	});

	it('does not trigger in if condition', async () => {
		const result = await exec('set -e; if false; then echo no; fi; echo yes');
		expect(result.stdout).toBe('yes\n');
	});

	it('does not trigger on left side of ||', async () => {
		const result = await exec('set -e; false || true; echo yes');
		expect(result.stdout).toBe('yes\n');
	});

	it('does not trigger on left side of &&', async () => {
		const result = await exec('set -e; false && true; echo yes');
		expect(result.stdout).toBe('yes\n');
	});

	it('does not trigger with ! negation', async () => {
		const result = await exec('set -e; ! false; echo yes');
		expect(result.stdout).toBe('yes\n');
	});
});

describe('Pipefail (set -o pipefail)', () => {
	it('reports non-zero from earlier pipe stage', async () => {
		const result = await exec('set -o pipefail; false | true');
		expect(result.exitCode).not.toBe(0);
	});

	it('reports zero when all stages succeed', async () => {
		const result = await exec('set -o pipefail; true | true');
		expect(result.exitCode).toBe(0);
	});

	it('without pipefail, only last stage matters', async () => {
		const result = await exec('false | true');
		expect(result.exitCode).toBe(0);
	});
});

describe('Nounset (set -u)', () => {
	it('errors on unset variable', async () => {
		const result = await exec('set -u; echo $UNSET_VAR');
		expect(result.exitCode).not.toBe(0);
	});

	it('allows ${VAR:-default}', async () => {
		const result = await exec('set -u; echo ${UNSET_VAR:-fallback}');
		expect(result.stdout).toBe('fallback\n');
	});

	it('allows $? (always defined)', async () => {
		const result = await exec('set -u; echo $?');
		expect(result.exitCode).toBe(0);
	});

	it('allows $# (always defined)', async () => {
		const result = await exec('set -u; echo $#');
		expect(result.exitCode).toBe(0);
	});
});

describe('Combined: set -euo pipefail', () => {
	it('parses the canonical LLM pattern', async () => {
		const result = await exec('set -euo pipefail; echo ok');
		expect(result.stdout).toBe('ok\n');
		expect(result.exitCode).toBe(0);
	});

	it('errexit triggers after pipefail failure', async () => {
		const result = await exec('set -euo pipefail; false | true; echo nope');
		expect(result.stdout).not.toContain('nope');
	});
});
