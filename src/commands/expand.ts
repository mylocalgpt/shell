import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const expand: Command = {
	name: 'expand',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let tabStop = 8;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-t' && i + 1 < args.length) {
				i++;
				tabStop = Number.parseInt(args[i], 10);
				continue;
			}
			if (arg.startsWith('-t') && arg.length > 2) {
				tabStop = Number.parseInt(arg.slice(2), 10);
				continue;
			}
			files.push(arg);
		}

		let content = '';
		let stderr = '';
		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			for (let i = 0; i < files.length; i++) {
				const path = resolvePath(files[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					content += typeof data === 'string' ? data : await data;
				} catch {
					stderr += `expand: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		let stdout = '';
		let col = 0;
		for (let i = 0; i < content.length; i++) {
			if (content[i] === '\t') {
				const spaces = tabStop - (col % tabStop);
				for (let s = 0; s < spaces; s++) stdout += ' ';
				col += spaces;
			} else if (content[i] === '\n') {
				stdout += '\n';
				col = 0;
			} else {
				stdout += content[i];
				col++;
			}
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
