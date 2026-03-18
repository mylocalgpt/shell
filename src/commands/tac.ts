import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const tac: Command = {
	name: 'tac',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let content = '';
		let stderr = '';
		if (args.length === 0) {
			content = ctx.stdin;
		} else {
			for (let i = 0; i < args.length; i++) {
				const path = resolvePath(args[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					content += typeof data === 'string' ? data : await data;
				} catch {
					stderr += `tac: ${args[i]}: No such file or directory\n`;
				}
			}
		}
		const hasTrailingNewline = content.length > 0 && content[content.length - 1] === '\n';
		const lines = content.split('\n');
		if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop();

		let stdout = '';
		for (let i = lines.length - 1; i >= 0; i--) {
			stdout += `${lines[i]}\n`;
		}
		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
