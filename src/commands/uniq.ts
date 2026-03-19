import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const uniq: Command = {
	name: 'uniq',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let showCount = false;
		let onlyDuplicates = false;
		let onlyUnique = false;
		let caseInsensitive = false;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) files.push(args[j]);
				break;
			}
			if (arg.startsWith('-') && arg.length > 1) {
				for (let c = 1; c < arg.length; c++) {
					switch (arg[c]) {
						case 'c':
							showCount = true;
							break;
						case 'd':
							onlyDuplicates = true;
							break;
						case 'u':
							onlyUnique = true;
							break;
						case 'i':
							caseInsensitive = true;
							break;
						default:
							return {
								exitCode: 1,
								stdout: '',
								stderr: `uniq: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
			} else {
				files.push(arg);
			}
		}

		let content = '';
		let stderr = '';

		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			const path = resolvePath(files[0], ctx.cwd);
			try {
				const data = ctx.fs.readFile(path);
				content = typeof data === 'string' ? data : await data;
			} catch {
				stderr += `uniq: ${files[0]}: No such file or directory\n`;
				return { exitCode: 1, stdout: '', stderr };
			}
		}

		if (content.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

		const hasTrailingNewline = content[content.length - 1] === '\n';
		const lines = content.split('\n');
		if (hasTrailingNewline && lines[lines.length - 1] === '') {
			lines.pop();
		}

		// Group adjacent identical lines
		const groups: Array<{ line: string; count: number }> = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const cmpLine = caseInsensitive ? line.toLowerCase() : line;
			if (groups.length > 0) {
				const prevCmp = caseInsensitive
					? groups[groups.length - 1].line.toLowerCase()
					: groups[groups.length - 1].line;
				if (cmpLine === prevCmp) {
					groups[groups.length - 1].count++;
					continue;
				}
			}
			groups.push({ line, count: 1 });
		}

		let stdout = '';
		for (let i = 0; i < groups.length; i++) {
			const g = groups[i];
			if (onlyDuplicates && g.count < 2) continue;
			if (onlyUnique && g.count > 1) continue;

			if (showCount) {
				const countStr = String(g.count);
				let pad = '';
				for (let p = countStr.length; p < 4; p++) pad += ' ';
				stdout += `${pad}${countStr} ${g.line}\n`;
			} else {
				stdout += `${g.line}\n`;
			}
		}

		return { exitCode: 0, stdout, stderr };
	},
};
