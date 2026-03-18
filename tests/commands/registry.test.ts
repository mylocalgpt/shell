import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/commands/registry.js';
import type { Command, CommandContext, CommandResult } from '../../src/commands/types.js';

function makeCommand(name: string): Command {
	return {
		name,
		async execute(_args: string[], _ctx: CommandContext): Promise<CommandResult> {
			return { stdout: `${name} output`, stderr: '', exitCode: 0 };
		},
	};
}

describe('CommandRegistry', () => {
	it('registers and retrieves a lazy command', async () => {
		const registry = new CommandRegistry();
		const echoCmd = makeCommand('echo');

		registry.register({
			name: 'echo',
			load: async () => echoCmd,
		});

		const result = await registry.get('echo');
		expect(result).toBe(echoCmd);
	});

	it('lazy loading: command module loaded only on first get(), not on register()', async () => {
		const registry = new CommandRegistry();
		const loadFn = vi.fn(async () => makeCommand('cat'));

		registry.register({ name: 'cat', load: loadFn });

		expect(loadFn).not.toHaveBeenCalled();

		await registry.get('cat');
		expect(loadFn).toHaveBeenCalledTimes(1);
	});

	it('caching: second get() returns same instance without re-calling load()', async () => {
		const registry = new CommandRegistry();
		const loadFn = vi.fn(async () => makeCommand('grep'));

		registry.register({ name: 'grep', load: loadFn });

		const first = await registry.get('grep');
		const second = await registry.get('grep');

		expect(first).toBe(second);
		expect(loadFn).toHaveBeenCalledTimes(1);
	});

	it('has() returns true for registered, false for unknown', () => {
		const registry = new CommandRegistry();
		registry.register({ name: 'ls', load: async () => makeCommand('ls') });

		expect(registry.has('ls')).toBe(true);
		expect(registry.has('unknown')).toBe(false);
	});

	it('list() returns sorted command names', () => {
		const registry = new CommandRegistry();
		registry.register({ name: 'cat', load: async () => makeCommand('cat') });
		registry.register({ name: 'echo', load: async () => makeCommand('echo') });
		registry.register({ name: 'awk', load: async () => makeCommand('awk') });

		expect(registry.list()).toEqual(['awk', 'cat', 'echo']);
	});

	it('defineCommand() registers pre-loaded commands returned by get()', async () => {
		const registry = new CommandRegistry();
		const cmd = makeCommand('custom');
		registry.defineCommand(cmd);

		const result = await registry.get('custom');
		expect(result).toBe(cmd);
	});

	it('defineCommand() commands appear in list() and has()', () => {
		const registry = new CommandRegistry();
		registry.defineCommand(makeCommand('custom'));

		expect(registry.has('custom')).toBe(true);
		expect(registry.list()).toContain('custom');
	});

	it('onUnknownCommand callback invoked for unregistered commands', async () => {
		const registry = new CommandRegistry();
		const fallback = makeCommand('fallback');

		registry.onUnknownCommand = (name: string) => {
			if (name === 'mystery') {
				return fallback;
			}
			return undefined;
		};

		const result = await registry.get('mystery');
		expect(result).toBe(fallback);
	});

	it('returns undefined for unknown command when no callback set', async () => {
		const registry = new CommandRegistry();
		const result = await registry.get('nonexistent');
		expect(result).toBeUndefined();
	});

	it('list() merges lazy definitions and cached commands without duplicates', async () => {
		const registry = new CommandRegistry();
		registry.register({ name: 'echo', load: async () => makeCommand('echo') });
		registry.defineCommand(makeCommand('cat'));

		// Load echo so it appears in both definitions and cache
		await registry.get('echo');

		const names = registry.list();
		expect(names).toEqual(['cat', 'echo']);
	});
});
