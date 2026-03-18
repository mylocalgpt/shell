import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function reverseStr(s: string): string {
	let result = '';
	for (let i = s.length - 1; i >= 0; i--) {
		result += s[i];
	}
	return result;
}

export const rev: Command = {
	name: 'rev',
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
					stderr += `rev: ${args[i]}: No such file or directory\n`;
				}
			}
		}
		if (content.length === 0) {
			return { exitCode: stderr.length > 0 ? 1 : 0, stdout: '', stderr };
		}

		const hasTrailingNewline = content[content.length - 1] === '\n';
		const lines = content.split('\n');
		if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop();

		let stdout = '';
		for (let i = 0; i < lines.length; i++) {
			stdout += `${reverseStr(lines[i])}\n`;
		}
		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
