import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const mkdir: Command = {
	name: 'mkdir',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let parents = false;
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
						case 'p':
							parents = true;
							break;
						default:
							return {
								exitCode: 1,
								stdout: '',
								stderr: `mkdir: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
			} else {
				paths.push(arg);
			}
		}

		if (paths.length === 0) {
			return { exitCode: 1, stdout: '', stderr: 'mkdir: missing operand\n' };
		}

		let stderr = '';
		let exitCode = 0;

		for (let i = 0; i < paths.length; i++) {
			const resolved = resolvePath(paths[i], ctx.cwd);
			try {
				ctx.fs.mkdir(resolved, { recursive: parents });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (msg.includes('EEXIST') && parents) continue;
				stderr += `mkdir: cannot create directory '${paths[i]}': ${msg}\n`;
				exitCode = 1;
			}
		}

		return { exitCode, stdout: '', stderr };
	},
};
