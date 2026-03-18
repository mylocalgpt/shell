import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function joinPath(base: string, name: string): string {
	if (base === '/') return `/${name}`;
	return `${base}/${name}`;
}

export const tree: Command = {
	name: 'tree',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let maxDepth = Number.POSITIVE_INFINITY;
		let dirsOnly = false;
		let showAll = false;
		let noReport = false;
		const paths: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-L' && i + 1 < args.length) {
				i++;
				maxDepth = Number.parseInt(args[i], 10);
				continue;
			}
			if (arg === '-d') {
				dirsOnly = true;
				continue;
			}
			if (arg === '-a') {
				showAll = true;
				continue;
			}
			if (arg === '--noreport') {
				noReport = true;
				continue;
			}
			paths.push(arg);
		}

		if (paths.length === 0) paths.push('.');

		let stdout = '';
		let totalDirs = 0;
		let totalFiles = 0;

		for (let p = 0; p < paths.length; p++) {
			const resolved = resolvePath(paths[p], ctx.cwd);
			stdout += `${paths[p]}\n`;

			const counts = printTree(resolved, '', 0, maxDepth, dirsOnly, showAll, ctx);
			stdout += counts.output;
			totalDirs += counts.dirs;
			totalFiles += counts.files;
		}

		if (!noReport) {
			stdout += `\n${totalDirs} director${totalDirs === 1 ? 'y' : 'ies'}, ${totalFiles} file${totalFiles === 1 ? '' : 's'}\n`;
		}

		return { exitCode: 0, stdout, stderr: '' };
	},
};

function printTree(
	dir: string,
	prefix: string,
	depth: number,
	maxDepth: number,
	dirsOnly: boolean,
	showAll: boolean,
	ctx: CommandContext,
): { output: string; dirs: number; files: number } {
	if (depth >= maxDepth) return { output: '', dirs: 0, files: 0 };

	let entries: string[];
	try {
		entries = ctx.fs.readdir(dir);
	} catch {
		return { output: '', dirs: 0, files: 0 };
	}

	if (!showAll) entries = entries.filter((e) => !e.startsWith('.'));

	let output = '';
	let dirs = 0;
	let files = 0;

	for (let i = 0; i < entries.length; i++) {
		const isLast = i === entries.length - 1;
		const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
		const childPrefix = isLast ? '    ' : '\u2502   ';
		const childPath = joinPath(dir, entries[i]);

		let isDir = false;
		try {
			const st = ctx.fs.stat(childPath);
			isDir = st.isDirectory();
		} catch {
			continue;
		}

		if (dirsOnly && !isDir) continue;

		output += `${prefix}${connector}${entries[i]}\n`;

		if (isDir) {
			dirs++;
			const sub = printTree(
				childPath,
				prefix + childPrefix,
				depth + 1,
				maxDepth,
				dirsOnly,
				showAll,
				ctx,
			);
			output += sub.output;
			dirs += sub.dirs;
			files += sub.files;
		} else {
			files++;
		}
	}

	return { output, dirs, files };
}
