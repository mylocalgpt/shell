import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const paste: Command = {
	name: 'paste',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let delimiters = '\t';
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-d' && i + 1 < args.length) {
				i++;
				delimiters = args[i];
				continue;
			}
			if (arg.startsWith('-d') && arg.length > 2) {
				delimiters = arg.slice(2);
				continue;
			}
			files.push(arg);
		}

		const columns: string[][] = [];
		let stderr = '';

		for (let i = 0; i < files.length; i++) {
			if (files[i] === '-') {
				const lines = ctx.stdin.split('\n');
				if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
				columns.push(lines);
			} else {
				const path = resolvePath(files[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					const text = typeof data === 'string' ? data : await data;
					const lines = text.split('\n');
					if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
						lines.pop();
					}
					columns.push(lines);
				} catch {
					stderr += `paste: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		if (columns.length === 0) return { exitCode: 0, stdout: '', stderr };

		let maxLines = 0;
		for (let i = 0; i < columns.length; i++) {
			if (columns[i].length > maxLines) maxLines = columns[i].length;
		}

		let stdout = '';
		for (let row = 0; row < maxLines; row++) {
			for (let col = 0; col < columns.length; col++) {
				if (col > 0) {
					stdout += delimiters[(col - 1) % delimiters.length];
				}
				stdout += row < columns[col].length ? columns[col][row] : '';
			}
			stdout += '\n';
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
