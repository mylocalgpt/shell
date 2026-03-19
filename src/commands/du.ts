import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function joinPath(base: string, name: string): string {
	if (base === '/') return `/${name}`;
	return `${base}/${name}`;
}

function formatSize(bytes: number, human: boolean): string {
	if (!human) return String(Math.ceil(bytes / 1024)); // Default: 1K blocks
	if (bytes < 1024) return `${bytes}`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function calcSize(
	dir: string,
	displayPath: string,
	ctx: CommandContext,
	depth: number,
	maxDepth: number,
	human: boolean,
	summaryOnly: boolean,
): { total: number; output: string } {
	let total = 0;
	let output = '';

	let entries: string[];
	try {
		entries = ctx.fs.readdir(dir);
	} catch {
		return { total: 0, output: '' };
	}

	for (let i = 0; i < entries.length; i++) {
		const childPath = joinPath(dir, entries[i]);
		const childDisplay = displayPath === '/' ? `/${entries[i]}` : `${displayPath}/${entries[i]}`;

		try {
			const st = ctx.fs.stat(childPath);
			if (st.isDirectory()) {
				const sub = calcSize(childPath, childDisplay, ctx, depth + 1, maxDepth, human, summaryOnly);
				total += sub.total;
				if (!summaryOnly && depth + 1 <= maxDepth) {
					output += sub.output;
				}
			} else {
				total += st.size;
			}
		} catch {}
	}

	if (!summaryOnly && depth <= maxDepth) {
		output += `${formatSize(total, human)}\t${displayPath}\n`;
	}

	return { total, output };
}

export const du: Command = {
	name: 'du',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let summaryOnly = false;
		let human = false;
		let maxDepth = Number.POSITIVE_INFINITY;
		const paths: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-s') {
				summaryOnly = true;
				continue;
			}
			if (arg === '-h') {
				human = true;
				continue;
			}
			if (arg === '-d' && i + 1 < args.length) {
				i++;
				maxDepth = Number.parseInt(args[i], 10);
				continue;
			}
			if (arg.startsWith('--max-depth=')) {
				maxDepth = Number.parseInt(arg.slice(12), 10);
				continue;
			}
			paths.push(arg);
		}

		if (paths.length === 0) paths.push('.');

		let stdout = '';
		let stderr = '';

		for (let p = 0; p < paths.length; p++) {
			const resolved = resolvePath(paths[p], ctx.cwd);
			if (!ctx.fs.exists(resolved)) {
				stderr += `du: cannot access '${paths[p]}': No such file or directory\n`;
				continue;
			}
			// Check if it's a regular file (not a directory)
			try {
				const st = ctx.fs.stat(resolved);
				if (!st.isDirectory()) {
					stdout += `${formatSize(st.size, human)}\t${paths[p]}\n`;
					continue;
				}
			} catch {}
			const result = calcSize(resolved, paths[p], ctx, 0, maxDepth, human, summaryOnly);
			if (summaryOnly) {
				stdout += `${formatSize(result.total, human)}\t${paths[p]}\n`;
			} else {
				stdout += result.output;
			}
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
