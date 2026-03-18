import { formatPrintf } from '../utils/printf.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const printf: Command = {
	name: 'printf',
	async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
		if (args.length === 0) {
			return { exitCode: 1, stdout: '', stderr: 'printf: usage: printf format [arguments]\n' };
		}
		const format = args[0];
		const fmtArgs = args.slice(1);
		const output = formatPrintf(format, fmtArgs);
		return { exitCode: 0, stdout: output, stderr: '' };
	},
};
