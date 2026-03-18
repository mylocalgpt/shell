import { briefDiff, unifiedDiff } from '../utils/diff.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const diff: Command = {
	name: 'diff',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let brief = false;
		let recursive = false;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-q') {
				brief = true;
				continue;
			}
			if (arg === '-u') continue; // unified is default
			if (arg === '-r') {
				recursive = true;
				continue;
			}
			files.push(arg);
		}

		if (files.length < 2) {
			return { exitCode: 2, stdout: '', stderr: 'diff: missing file operand\n' };
		}

		const path1 = resolvePath(files[0], ctx.cwd);
		const path2 = resolvePath(files[1], ctx.cwd);

		try {
			const data1 = ctx.fs.readFile(path1);
			const text1 = typeof data1 === 'string' ? data1 : await data1;
			const data2 = ctx.fs.readFile(path2);
			const text2 = typeof data2 === 'string' ? data2 : await data2;

			if (brief) {
				if (briefDiff(text1, text2)) {
					return {
						exitCode: 1,
						stdout: `Files ${files[0]} and ${files[1]} differ\n`,
						stderr: '',
					};
				}
				return { exitCode: 0, stdout: '', stderr: '' };
			}

			const result = unifiedDiff(text1, text2, { labelA: files[0], labelB: files[1] });
			return { exitCode: result.length > 0 ? 1 : 0, stdout: result, stderr: '' };
		} catch {
			return {
				exitCode: 2,
				stdout: '',
				stderr: 'diff: cannot read file\n',
			};
		}
	},
};
