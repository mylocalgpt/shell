import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const comm: Command = {
	name: 'comm',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let suppress1 = false;
		let suppress2 = false;
		let suppress3 = false;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg.startsWith('-') && arg.length > 1) {
				for (let c = 1; c < arg.length; c++) {
					if (arg[c] === '1') suppress1 = true;
					else if (arg[c] === '2') suppress2 = true;
					else if (arg[c] === '3') suppress3 = true;
				}
			} else {
				files.push(arg);
			}
		}

		if (files.length < 2) {
			return { exitCode: 1, stdout: '', stderr: 'comm: requires two files\n' };
		}

		const readFile = async (name: string): Promise<string[]> => {
			const path = resolvePath(name, ctx.cwd);
			const data = ctx.fs.readFile(path);
			const text = typeof data === 'string' ? data : await data;
			const lines = text.split('\n');
			if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
				lines.pop();
			}
			return lines;
		};

		let lines1: string[];
		let lines2: string[];
		try {
			lines1 = await readFile(files[0]);
			lines2 = await readFile(files[1]);
		} catch {
			return { exitCode: 1, stdout: '', stderr: 'comm: cannot read input files\n' };
		}

		let i = 0;
		let j = 0;
		let stdout = '';

		while (i < lines1.length && j < lines2.length) {
			if (lines1[i] < lines2[j]) {
				if (!suppress1) stdout += `${lines1[i]}\n`;
				i++;
			} else if (lines1[i] > lines2[j]) {
				if (!suppress2) {
					stdout += suppress1 ? `${lines2[j]}\n` : `\t${lines2[j]}\n`;
				}
				j++;
			} else {
				if (!suppress3) {
					let prefix = '';
					if (!suppress1) prefix += '\t';
					if (!suppress2) prefix += '\t';
					stdout += `${prefix}${lines1[i]}\n`;
				}
				i++;
				j++;
			}
		}

		while (i < lines1.length) {
			if (!suppress1) stdout += `${lines1[i]}\n`;
			i++;
		}
		while (j < lines2.length) {
			if (!suppress2) {
				stdout += suppress1 ? `${lines2[j]}\n` : `\t${lines2[j]}\n`;
			}
			j++;
		}

		return { exitCode: 0, stdout, stderr: '' };
	},
};
