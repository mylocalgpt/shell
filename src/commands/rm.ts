import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const rm: Command = {
	name: 'rm',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let recursive = false;
		let force = false;
		const paths: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) paths.push(args[j]);
				break;
			}
			if (arg.startsWith('-') && arg.length > 1) {
				for (let c = 1; c < arg.length; c++) {
					switch (arg[c]) {
						case 'r':
						case 'R':
							recursive = true;
							break;
						case 'f':
							force = true;
							break;
						default:
							return {
								exitCode: 1,
								stdout: '',
								stderr: `rm: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
			} else {
				paths.push(arg);
			}
		}

		if (paths.length === 0 && !force) {
			return { exitCode: 1, stdout: '', stderr: 'rm: missing operand\n' };
		}

		let stderr = '';
		let exitCode = 0;

		for (let i = 0; i < paths.length; i++) {
			const resolved = resolvePath(paths[i], ctx.cwd);
			try {
				const st = ctx.fs.stat(resolved);
				if (st.isDirectory()) {
					if (!recursive) {
						stderr += `rm: cannot remove '${paths[i]}': Is a directory\n`;
						exitCode = 1;
						continue;
					}
					ctx.fs.rmdir(resolved, { recursive: true });
				} else {
					ctx.fs.unlink(resolved);
				}
			} catch {
				if (!force) {
					stderr += `rm: cannot remove '${paths[i]}': No such file or directory\n`;
					exitCode = 1;
				}
			}
		}

		return { exitCode, stdout: '', stderr };
	},
};
