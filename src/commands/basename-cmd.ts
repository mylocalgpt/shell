import type { Command, CommandContext, CommandResult } from './types.js';

export const basename: Command = {
	name: 'basename',
	async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
		if (args.length === 0)
			return { exitCode: 1, stdout: '', stderr: 'basename: missing operand\n' };
		const path = args[0];
		const suffix = args.length > 1 ? args[1] : '';
		const idx = path.lastIndexOf('/');
		let name = idx >= 0 ? path.slice(idx + 1) : path;
		if (suffix && name.endsWith(suffix)) {
			name = name.slice(0, name.length - suffix.length);
		}
		return { exitCode: 0, stdout: `${name}\n`, stderr: '' };
	},
};
