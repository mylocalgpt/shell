import type { Command, CommandContext, CommandResult } from './types.js';

export const pwd: Command = {
	name: 'pwd',
	async execute(_args: string[], ctx: CommandContext): Promise<CommandResult> {
		return { exitCode: 0, stdout: `${ctx.cwd}\n`, stderr: '' };
	},
};
