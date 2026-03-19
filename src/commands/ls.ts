import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function joinPath(base: string, name: string): string {
	if (base === '/') return `/${name}`;
	return `${base}/${name}`;
}

function formatSize(size: number, human: boolean): string {
	if (!human) return String(size);
	if (size < 1024) return `${size}B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}K`;
	if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}M`;
	return `${(size / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function formatPermissions(mode: number, isDir: boolean): string {
	const types = [
		[mode & 0o400, 'r'],
		[mode & 0o200, 'w'],
		[mode & 0o100, 'x'],
		[mode & 0o040, 'r'],
		[mode & 0o020, 'w'],
		[mode & 0o010, 'x'],
		[mode & 0o004, 'r'],
		[mode & 0o002, 'w'],
		[mode & 0o001, 'x'],
	] as const;
	let result = isDir ? 'd' : '-';
	for (let i = 0; i < types.length; i++) {
		result += types[i][0] ? types[i][1] : '-';
	}
	return result;
}

function formatDate(d: Date): string {
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	const mo = months[d.getMonth()];
	const day = String(d.getDate()).padStart(2, ' ');
	const h = String(d.getHours()).padStart(2, '0');
	const mi = String(d.getMinutes()).padStart(2, '0');
	return `${mo} ${day} ${h}:${mi}`;
}

export const ls: Command = {
	name: 'ls',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let longFormat = false;
		let showAll = false;
		let recursive = false;
		let onePerLine = true;
		let humanSizes = false;
		let sortByTime = false;
		let reverseSort = false;
		let sortBySize = false;
		let dirSelf = false;
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
						case 'l':
							longFormat = true;
							break;
						case 'a':
							showAll = true;
							break;
						case 'R':
							recursive = true;
							break;
						case '1':
							onePerLine = true;
							break;
						case 'h':
							humanSizes = true;
							break;
						case 't':
							sortByTime = true;
							break;
						case 'r':
							reverseSort = true;
							break;
						case 'S':
							sortBySize = true;
							break;
						case 'd':
							dirSelf = true;
							break;
					}
				}
				continue;
			}
			paths.push(arg);
		}

		if (paths.length === 0) paths.push('.');

		let stdout = '';
		let stderr = '';
		const showHeaders = paths.length > 1;

		for (let p = 0; p < paths.length; p++) {
			const resolved = resolvePath(paths[p], ctx.cwd);

			if (dirSelf) {
				try {
					const st = ctx.fs.stat(resolved);
					if (longFormat) {
						stdout += `${formatPermissions(st.mode, st.isDirectory())} 1 root root ${formatSize(st.size, humanSizes)} ${formatDate(st.mtime)} ${paths[p]}\n`;
					} else {
						stdout += `${paths[p]}\n`;
					}
				} catch {
					stderr += `ls: cannot access '${paths[p]}': No such file or directory\n`;
				}
				continue;
			}

			try {
				const st = ctx.fs.stat(resolved);
				if (st.isFile()) {
					if (longFormat) {
						stdout += `${formatPermissions(st.mode, false)} 1 root root ${formatSize(st.size, humanSizes)} ${formatDate(st.mtime)} ${paths[p]}\n`;
					} else {
						stdout += `${paths[p]}\n`;
					}
					continue;
				}
			} catch {
				stderr += `ls: cannot access '${paths[p]}': No such file or directory\n`;
				continue;
			}

			if (showHeaders) {
				if (p > 0) stdout += '\n';
				stdout += `${paths[p]}:\n`;
			}

			stdout += listDir(
				resolved,
				ctx,
				showAll,
				longFormat,
				humanSizes,
				sortByTime,
				sortBySize,
				reverseSort,
			);

			if (recursive) {
				stdout += listRecursive(
					resolved,
					paths[p],
					ctx,
					showAll,
					longFormat,
					humanSizes,
					sortByTime,
					sortBySize,
					reverseSort,
				);
			}
		}

		return { exitCode: stderr.length > 0 ? 2 : 0, stdout, stderr };
	},
};

function listDir(
	dir: string,
	ctx: CommandContext,
	showAll: boolean,
	longFormat: boolean,
	humanSizes: boolean,
	sortByTime: boolean,
	sortBySize: boolean,
	reverseSort: boolean,
): string {
	let entries: string[];
	try {
		entries = ctx.fs.readdir(dir);
	} catch {
		return '';
	}

	if (!showAll) {
		entries = entries.filter((e) => !e.startsWith('.'));
	} else {
		// Add . and .. entries when -a is set (like coreutils ls)
		entries = ['.', '..', ...entries];
	}

	// Sort
	if (sortByTime || sortBySize) {
		const stats = new Map<string, { size: number; mtime: number }>();
		for (let i = 0; i < entries.length; i++) {
			try {
				const st = ctx.fs.stat(joinPath(dir, entries[i]));
				stats.set(entries[i], { size: st.size, mtime: st.mtime.getTime() });
			} catch {
				stats.set(entries[i], { size: 0, mtime: 0 });
			}
		}
		if (sortByTime) {
			entries.sort((a, b) => (stats.get(b)?.mtime ?? 0) - (stats.get(a)?.mtime ?? 0));
		} else if (sortBySize) {
			entries.sort((a, b) => (stats.get(b)?.size ?? 0) - (stats.get(a)?.size ?? 0));
		}
	}

	if (reverseSort) entries.reverse();

	let result = '';
	for (let i = 0; i < entries.length; i++) {
		if (longFormat) {
			try {
				const st = ctx.fs.stat(joinPath(dir, entries[i]));
				result += `${formatPermissions(st.mode, st.isDirectory())} 1 root root ${formatSize(st.size, humanSizes)} ${formatDate(st.mtime)} ${entries[i]}\n`;
			} catch {
				result += `${entries[i]}\n`;
			}
		} else {
			result += `${entries[i]}\n`;
		}
	}
	return result;
}

function listRecursive(
	dir: string,
	displayDir: string,
	ctx: CommandContext,
	showAll: boolean,
	longFormat: boolean,
	humanSizes: boolean,
	sortByTime: boolean,
	sortBySize: boolean,
	reverseSort: boolean,
): string {
	let entries: string[];
	try {
		entries = ctx.fs.readdir(dir);
	} catch {
		return '';
	}

	if (!showAll) entries = entries.filter((e) => !e.startsWith('.'));
	let result = '';

	for (let i = 0; i < entries.length; i++) {
		const childPath = joinPath(dir, entries[i]);
		const childDisplay = displayDir === '/' ? `/${entries[i]}` : `${displayDir}/${entries[i]}`;
		try {
			const st = ctx.fs.stat(childPath);
			if (st.isDirectory()) {
				result += `\n${childDisplay}:\n`;
				result += listDir(
					childPath,
					ctx,
					showAll,
					longFormat,
					humanSizes,
					sortByTime,
					sortBySize,
					reverseSort,
				);
				result += listRecursive(
					childPath,
					childDisplay,
					ctx,
					showAll,
					longFormat,
					humanSizes,
					sortByTime,
					sortBySize,
					reverseSort,
				);
			}
		} catch {
			// skip
		}
	}

	return result;
}
