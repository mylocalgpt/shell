import type { Command, CommandContext, CommandResult } from './types.js';

export const sleep: Command = {
	name: 'sleep',
	async execute(_args: string[], _ctx: CommandContext): Promise<CommandResult> {
		return { exitCode: 0, stdout: '', stderr: '' };
	},
};
