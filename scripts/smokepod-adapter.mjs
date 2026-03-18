#!/usr/bin/env node

/**
 * Smokepod JSONL adapter for @mylocalgpt/shell.
 *
 * Reads JSONL on stdin (one JSON object per line with a "command" field),
 * executes each command via Shell.exec(), and writes JSONL results to stdout.
 *
 * Uses dynamic import of the built dist so it tests actual build output.
 */

import { createInterface } from 'node:readline';

async function main() {
	const { Shell } = await import('../dist/index.mjs');
	const shell = new Shell();

	const rl = createInterface({ input: process.stdin });

	for await (const line of rl) {
		if (!line.trim()) continue;

		try {
			const input = JSON.parse(line);
			const command = input.command;

			if (typeof command !== 'string') {
				const result = { stdout: '', stderr: 'missing or invalid "command" field', exit_code: 1 };
				process.stdout.write(`${JSON.stringify(result)}\n`);
				continue;
			}

			try {
				const result = await shell.exec(command);
				const output = {
					stdout: result.stdout,
					stderr: result.stderr,
					exit_code: result.exitCode,
				};
				process.stdout.write(`${JSON.stringify(output)}\n`);
			} catch (err) {
				const output = {
					stdout: '',
					stderr: err instanceof Error ? err.message : String(err),
					exit_code: 1,
				};
				process.stdout.write(`${JSON.stringify(output)}\n`);
			}
		} catch (err) {
			const output = {
				stdout: '',
				stderr: `invalid JSON input: ${err instanceof Error ? err.message : String(err)}`,
				exit_code: 1,
			};
			process.stdout.write(`${JSON.stringify(output)}\n`);
		}
	}
}

main().catch((err) => {
	process.stderr.write(`adapter error: ${err.message}\n`);
	process.exit(1);
});
