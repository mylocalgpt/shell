import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function detectType(content: string): string {
	if (content.length === 0) return 'empty';

	const trimmed = content.trimStart();

	// Shell script
	if (trimmed.startsWith('#!')) return 'text/x-shellscript';

	// JSON
	if (trimmed[0] === '{' || trimmed[0] === '[') {
		try {
			JSON.parse(content);
			return 'application/json';
		} catch {
			// Not valid JSON
		}
	}

	// XML/HTML
	if (
		trimmed.startsWith('<?xml') ||
		trimmed.startsWith('<!DOCTYPE') ||
		trimmed.startsWith('<!doctype')
	) {
		return 'text/xml';
	}
	if (
		trimmed.startsWith('<html') ||
		trimmed.startsWith('<HTML') ||
		trimmed.startsWith('<!DOCTYPE html')
	) {
		return 'text/html';
	}

	// Check for binary content (non-printable characters)
	let nonPrintable = 0;
	const checkLen = content.length < 8192 ? content.length : 8192;
	for (let i = 0; i < checkLen; i++) {
		const code = content.charCodeAt(i);
		if (
			code < 32 &&
			code !== 9 &&
			code !== 10 &&
			code !== 13 // tab, LF, CR are fine
		) {
			nonPrintable++;
		}
	}

	if (nonPrintable > checkLen * 0.1) {
		return 'application/octet-stream';
	}

	// Check if pure ASCII
	let allAscii = true;
	for (let i = 0; i < checkLen; i++) {
		if (content.charCodeAt(i) > 127) {
			allAscii = false;
			break;
		}
	}

	return allAscii ? 'text/plain; charset=us-ascii' : 'text/plain; charset=utf-8';
}

export const file: Command = {
	name: 'file',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		const paths: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) paths.push(args[j]);
				break;
			}
			// Skip common flags for compatibility
			if (arg.startsWith('-') && arg.length > 1) continue;
			paths.push(arg);
		}

		if (paths.length === 0) {
			return { exitCode: 1, stdout: '', stderr: 'file: missing file operand\n' };
		}

		let stdout = '';
		let stderr = '';
		let exitCode = 0;

		for (let i = 0; i < paths.length; i++) {
			const resolved = resolvePath(paths[i], ctx.cwd);
			try {
				const st = ctx.fs.stat(resolved);
				if (st.isDirectory()) {
					stdout += `${paths[i]}: directory\n`;
				} else {
					const content = ctx.fs.readFile(resolved);
					const text = typeof content === 'string' ? content : await content;
					const type = detectType(text);
					stdout += `${paths[i]}: ${type}\n`;
				}
			} catch {
				stderr += `file: cannot open '${paths[i]}' (No such file or directory)\n`;
				exitCode = 1;
			}
		}

		return { exitCode, stdout, stderr };
	},
};
