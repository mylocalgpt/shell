import type { Command, CommandContext, CommandResult } from './types.js';

export const hostname: Command = {
	name: 'hostname',
	async execute(_args: string[], ctx: CommandContext): Promise<CommandResult> {
		const name = ctx.env.get('HOSTNAME') ?? 'localhost';
		return { exitCode: 0, stdout: `${name}\n`, stderr: '' };
	},
};
