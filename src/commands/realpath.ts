import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const realpath: Command = {
	name: 'realpath',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		const paths: string[] = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i].startsWith('-')) continue; // skip flags
			paths.push(args[i]);
		}

		if (paths.length === 0) {
			return { exitCode: 1, stdout: '', stderr: 'realpath: missing operand\n' };
		}

		let stdout = '';
		let stderr = '';
		let exitCode = 0;

		for (let i = 0; i < paths.length; i++) {
			const resolved = resolvePath(paths[i], ctx.cwd);
			try {
				const real = ctx.fs.realpath(resolved);
				stdout += `${real}\n`;
			} catch {
				stderr += `realpath: ${paths[i]}: No such file or directory\n`;
				exitCode = 1;
			}
		}

		return { exitCode, stdout, stderr };
	},
};
