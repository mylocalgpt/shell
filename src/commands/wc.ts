import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function countContent(content: string): {
	lines: number;
	words: number;
	bytes: number;
	chars: number;
} {
	let lines = 0;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === '\n') lines++;
	}

	let words = 0;
	let inWord = false;
	for (let i = 0; i < content.length; i++) {
		const ch = content[i];
		const isSpace = ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
		if (isSpace) {
			inWord = false;
		} else if (!inWord) {
			inWord = true;
			words++;
		}
	}

	// bytes is content.length for ASCII; for UTF-8 we approximate with string length
	const bytes = content.length;
	const chars = content.length;

	return { lines, words, bytes, chars };
}

function padNum(n: number, width: number): string {
	const s = String(n);
	let pad = '';
	for (let i = s.length; i < width; i++) pad += ' ';
	return pad + s;
}

export const wc: Command = {
	name: 'wc',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let showLines = false;
		let showWords = false;
		let showBytes = false;
		let showChars = false;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) files.push(args[j]);
				break;
			}
			if (arg.startsWith('-') && arg.length > 1 && arg !== '-') {
				for (let c = 1; c < arg.length; c++) {
					switch (arg[c]) {
						case 'l':
							showLines = true;
							break;
						case 'w':
							showWords = true;
							break;
						case 'c':
							showBytes = true;
							break;
						case 'm':
							showChars = true;
							break;
						default:
							return {
								exitCode: 1,
								stdout: '',
								stderr: `wc: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
			} else {
				files.push(arg);
			}
		}

		// Default: show all three
		const showAll = !showLines && !showWords && !showBytes && !showChars;
		if (showAll) {
			showLines = true;
			showWords = true;
			showBytes = true;
		}

		const inputs: Array<{ name: string; content: string }> = [];
		let stderr = '';

		if (files.length === 0) {
			inputs.push({ name: '', content: ctx.stdin });
		} else {
			for (let i = 0; i < files.length; i++) {
				if (files[i] === '-') {
					inputs.push({ name: '', content: ctx.stdin });
				} else {
					const path = resolvePath(files[i], ctx.cwd);
					try {
						const data = ctx.fs.readFile(path);
						const text = typeof data === 'string' ? data : await data;
						inputs.push({ name: files[i], content: text });
					} catch {
						stderr += `wc: ${files[i]}: No such file or directory\n`;
					}
				}
			}
		}

		let stdout = '';
		let totalLines = 0;
		let totalWords = 0;
		let totalBytes = 0;
		let totalChars = 0;

		for (let i = 0; i < inputs.length; i++) {
			const counts = countContent(inputs[i].content);
			totalLines += counts.lines;
			totalWords += counts.words;
			totalBytes += counts.bytes;
			totalChars += counts.chars;

			let line = '';
			if (showLines) line += padNum(counts.lines, 8);
			if (showWords) line += padNum(counts.words, 8);
			if (showBytes) line += padNum(counts.bytes, 8);
			if (showChars && !showBytes) line += padNum(counts.chars, 8);
			if (inputs[i].name) line += ` ${inputs[i].name}`;
			stdout += `${line}\n`;
		}

		if (inputs.length > 1) {
			let line = '';
			if (showLines) line += padNum(totalLines, 8);
			if (showWords) line += padNum(totalWords, 8);
			if (showBytes) line += padNum(totalBytes, 8);
			if (showChars && !showBytes) line += padNum(totalChars, 8);
			line += ' total';
			stdout += `${line}\n`;
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
