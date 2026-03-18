import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const fold: Command = {
	name: 'fold',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let width = 80;
		let breakAtSpaces = false;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-w' && i + 1 < args.length) {
				i++;
				width = Number.parseInt(args[i], 10);
				continue;
			}
			if (arg.startsWith('-w') && arg.length > 2) {
				width = Number.parseInt(arg.slice(2), 10);
				continue;
			}
			if (arg === '-s') {
				breakAtSpaces = true;
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
					stderr += `fold: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		const lines = content.split('\n');
		let stdout = '';

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.length <= width) {
				stdout += line;
				if (i < lines.length - 1) stdout += '\n';
				continue;
			}

			let pos = 0;
			while (pos < line.length) {
				let end = pos + width;
				if (end >= line.length) {
					stdout += line.slice(pos);
					break;
				}
				if (breakAtSpaces) {
					let breakPos = end;
					while (breakPos > pos && line[breakPos] !== ' ') breakPos--;
					if (breakPos > pos) end = breakPos + 1;
				}
				stdout += `${line.slice(pos, end)}\n`;
				pos = end;
			}
			if (i < lines.length - 1) stdout += '\n';
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
