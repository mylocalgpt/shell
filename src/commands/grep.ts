import { checkRegexSafety, checkSubjectLength } from '../security/regex.js';
import { globMatch } from '../utils/glob.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function joinPath(base: string, name: string): string {
	if (base === '/') return `/${name}`;
	return `${base}/${name}`;
}

function collectFiles(
	dir: string,
	ctx: CommandContext,
	includeGlob: string,
	excludeGlob: string,
	results: string[],
): void {
	let entries: string[];
	try {
		entries = ctx.fs.readdir(dir);
	} catch {
		return;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const fullPath = joinPath(dir, entry);

		try {
			const st = ctx.fs.stat(fullPath);
			if (st.isDirectory()) {
				collectFiles(fullPath, ctx, includeGlob, excludeGlob, results);
			} else {
				if (includeGlob && !globMatch(includeGlob, entry)) continue;
				if (excludeGlob && globMatch(excludeGlob, entry)) continue;
				results.push(fullPath);
			}
		} catch {
			// skip inaccessible entries
		}
	}
}

export const grep: Command = {
	name: 'grep',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let caseInsensitive = false;
		let invertMatch = false;
		let showLineNumbers = false;
		let countOnly = false;
		let filesOnly = false;
		let onlyMatching = false;
		let wordMatch = false;
		let suppressFilename = false;
		let forceFilename = false;
		let recursive = false;
		let includeGlob = '';
		let excludeGlob = '';
		let pattern = '';
		let patternSet = false;
		const files: string[] = [];
		const expressions: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) files.push(args[j]);
				break;
			}
			if (arg === '-e' && i + 1 < args.length) {
				i++;
				expressions.push(args[i]);
				continue;
			}
			if (arg.startsWith('--include=')) {
				includeGlob = arg.slice(10);
				continue;
			}
			if (arg.startsWith('--exclude=')) {
				excludeGlob = arg.slice(10);
				continue;
			}
			if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
				for (let c = 1; c < arg.length; c++) {
					switch (arg[c]) {
						case 'i':
							caseInsensitive = true;
							break;
						case 'v':
							invertMatch = true;
							break;
						case 'n':
							showLineNumbers = true;
							break;
						case 'c':
							countOnly = true;
							break;
						case 'l':
							filesOnly = true;
							break;
						case 'o':
							onlyMatching = true;
							break;
						case 'w':
							wordMatch = true;
							break;
						case 'h':
							suppressFilename = true;
							break;
						case 'H':
							forceFilename = true;
							break;
						case 'r':
						case 'R':
							recursive = true;
							break;
						case 'E':
							break; // Extended regex is default
						case 'F':
							break; // Fixed string - we handle below
						default:
							return {
								exitCode: 2,
								stdout: '',
								stderr: `grep: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
				continue;
			}
			if (!patternSet && expressions.length === 0) {
				pattern = arg;
				patternSet = true;
			} else {
				files.push(arg);
			}
		}

		if (expressions.length > 0) {
			pattern = expressions.join('|');
			patternSet = true;
		}

		if (!patternSet) {
			return { exitCode: 2, stdout: '', stderr: 'grep: missing pattern\n' };
		}

		// Word match wrapping
		let regexPattern = pattern;
		if (wordMatch) {
			regexPattern = `\\b${pattern}\\b`;
		}

		// Security check
		const safetyCheck = checkRegexSafety(regexPattern);
		if (safetyCheck) {
			return { exitCode: 2, stdout: '', stderr: `grep: ${safetyCheck}\n` };
		}

		let regex: RegExp;
		try {
			const flags = caseInsensitive ? 'gi' : 'g';
			regex = new RegExp(regexPattern, flags);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exitCode: 2, stdout: '', stderr: `grep: invalid regex: ${msg}\n` };
		}

		// Collect input files
		const inputFiles: Array<{ name: string; content: string }> = [];
		let stderr = '';

		if (files.length === 0 && !recursive) {
			inputFiles.push({ name: '(standard input)', content: ctx.stdin });
		} else {
			const allPaths: string[] = [];
			for (let i = 0; i < files.length; i++) {
				const resolved = resolvePath(files[i], ctx.cwd);
				try {
					const st = ctx.fs.stat(resolved);
					if (st.isDirectory()) {
						if (recursive) {
							collectFiles(resolved, ctx, includeGlob, excludeGlob, allPaths);
						} else {
							stderr += `grep: ${files[i]}: Is a directory\n`;
						}
					} else {
						allPaths.push(resolved);
					}
				} catch {
					stderr += `grep: ${files[i]}: No such file or directory\n`;
				}
			}

			if (recursive && files.length === 0) {
				collectFiles(ctx.cwd, ctx, includeGlob, excludeGlob, allPaths);
			}

			for (let i = 0; i < allPaths.length; i++) {
				try {
					const data = ctx.fs.readFile(allPaths[i]);
					const text = typeof data === 'string' ? data : await data;
					inputFiles.push({ name: allPaths[i], content: text });
				} catch {
					stderr += `grep: ${allPaths[i]}: No such file or directory\n`;
				}
			}
		}

		const showFilename = forceFilename || (!suppressFilename && inputFiles.length > 1);
		let stdout = '';
		let anyMatch = false;

		for (let f = 0; f < inputFiles.length; f++) {
			const { name, content } = inputFiles[f];
			const subjectCheck = checkSubjectLength(content);
			if (subjectCheck) {
				stderr += `grep: ${name}: ${subjectCheck}\n`;
				continue;
			}

			const lines = content.split('\n');
			if (lines.length > 0 && lines[lines.length - 1] === '' && content.endsWith('\n')) {
				lines.pop();
			}

			let matchCount = 0;

			for (let i = 0; i < lines.length; i++) {
				regex.lastIndex = 0;
				const hasMatch = regex.test(lines[i]);
				const isMatch = invertMatch ? !hasMatch : hasMatch;

				if (isMatch) {
					matchCount++;
					anyMatch = true;

					if (filesOnly) break;
					if (countOnly) continue;

					const prefix = showFilename ? `${name}:` : '';
					const lineNum = showLineNumbers ? `${i + 1}:` : '';

					if (onlyMatching && !invertMatch) {
						regex.lastIndex = 0;
						let m: RegExpExecArray | null;
						while (true) {
							m = regex.exec(lines[i]);
							if (m === null) break;
							stdout += `${prefix}${lineNum}${m[0]}\n`;
							if (m[0].length === 0) {
								regex.lastIndex++;
							}
						}
					} else {
						stdout += `${prefix}${lineNum}${lines[i]}\n`;
					}
				}
			}

			if (filesOnly && matchCount > 0) {
				stdout += `${name}\n`;
			}
			if (countOnly) {
				const prefix = showFilename ? `${name}:` : '';
				stdout += `${prefix}${matchCount}\n`;
			}
		}

		const exitCode = anyMatch ? 0 : 1;
		return { exitCode: stderr.length > 0 ? 2 : exitCode, stdout, stderr };
	},
};
