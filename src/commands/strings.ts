import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function isPrintable(code: number): boolean {
	return code >= 32 && code <= 126;
}

export const strings: Command = {
	name: 'strings',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let minLength = 4;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-n' && i + 1 < args.length) {
				i++;
				minLength = Number.parseInt(args[i], 10);
				continue;
			}
			if (arg.startsWith('-n') && arg.length > 2) {
				minLength = Number.parseInt(arg.slice(2), 10);
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
					stderr += `strings: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		let stdout = '';
		let current = '';

		for (let i = 0; i < content.length; i++) {
			const code = content.charCodeAt(i);
			if (isPrintable(code)) {
				current += content[i];
			} else {
				if (current.length >= minLength) {
					stdout += `${current}\n`;
				}
				current = '';
			}
		}
		if (current.length >= minLength) {
			stdout += `${current}\n`;
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
