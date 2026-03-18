import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const ln: Command = {
	name: 'ln',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let symbolic = false;
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
						case 's':
							symbolic = true;
							break;
						case 'f':
							force = true;
							break;
						default:
							return {
								exitCode: 1,
								stdout: '',
								stderr: `ln: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
			} else {
				paths.push(arg);
			}
		}

		if (!symbolic) {
			return {
				exitCode: 1,
				stdout: '',
				stderr: 'ln: hard links not supported in virtual filesystem. Use -s for symbolic links.\n',
			};
		}

		if (paths.length < 2) {
			return { exitCode: 1, stdout: '', stderr: 'ln: missing file operand\n' };
		}

		const target = paths[0];
		const linkPath = resolvePath(paths[1], ctx.cwd);

		try {
			if (force && ctx.fs.exists(linkPath)) {
				ctx.fs.unlink(linkPath);
			}
			ctx.fs.symlink(target, linkPath);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return {
				exitCode: 1,
				stdout: '',
				stderr: `ln: failed to create symbolic link '${paths[1]}': ${msg}\n`,
			};
		}

		return { exitCode: 0, stdout: '', stderr: '' };
	},
};
