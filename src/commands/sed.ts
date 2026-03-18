import { checkRegexSafety } from '../security/regex.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

interface SedCmd {
	addr1: SedAddr | null;
	addr2: SedAddr | null;
	command: string;
	args: string; // for substitution: rest of the s command
}

interface SedAddr {
	type: 'line' | 'last' | 'regex';
	line?: number;
	regex?: RegExp;
}

/**
 * Parse a sed expression string into commands.
 */
function parseSedExpr(expr: string): SedCmd[] {
	const cmds: SedCmd[] = [];
	// Split on semicolons or newlines (respecting delimiters in s commands)
	const parts = splitSedCommands(expr);

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i].trim();
		if (part.length === 0) continue;

		// Check for unsupported hold-space commands
		if (/^[hHgGx]$/.test(part) || /^\d*[hHgGx]/.test(part)) {
			throw new Error(
				'@mylocalgpt/shell: sed hold-space commands (h/H/g/G/x) not supported. Alternative: use awk or process in multiple passes.',
			);
		}

		const parsed = parseSingleCommand(part);
		if (parsed) cmds.push(parsed);
	}

	return cmds;
}

function splitSedCommands(expr: string): string[] {
	const parts: string[] = [];
	let current = '';
	let i = 0;
	let inSubst = false;
	let substDelim = '/';
	let substCount = 0;

	while (i < expr.length) {
		const ch = expr[i];

		if (inSubst) {
			current += ch;
			if (ch === '\\' && i + 1 < expr.length) {
				i++;
				current += expr[i];
				i++;
				continue;
			}
			if (ch === substDelim) {
				substCount++;
				if (substCount >= 3) {
					// Consume remaining flags
					i++;
					while (i < expr.length && expr[i] !== ';' && expr[i] !== '\n') {
						current += expr[i];
						i++;
					}
					inSubst = false;
					continue;
				}
			}
			i++;
			continue;
		}

		if (ch === ';' || ch === '\n') {
			if (current.trim().length > 0) parts.push(current);
			current = '';
			i++;
			continue;
		}

		if (ch === 's' && (current.trim().length === 0 || /^[\d,$\/]*$/.test(current.trim()))) {
			current += ch;
			i++;
			if (i < expr.length) {
				substDelim = expr[i];
				current += expr[i];
				i++;
				inSubst = true;
				substCount = 1;
			}
			continue;
		}

		current += ch;
		i++;
	}

	if (current.trim().length > 0) parts.push(current);
	return parts;
}

function parseAddress(s: string, pos: number): { addr: SedAddr | null; end: number } {
	if (pos >= s.length) return { addr: null, end: pos };

	if (s[pos] === '$') {
		return { addr: { type: 'last' }, end: pos + 1 };
	}

	if (s[pos] >= '0' && s[pos] <= '9') {
		let num = '';
		let p = pos;
		while (p < s.length && s[p] >= '0' && s[p] <= '9') {
			num += s[p];
			p++;
		}
		return { addr: { type: 'line', line: Number.parseInt(num, 10) }, end: p };
	}

	if (s[pos] === '/') {
		let p = pos + 1;
		let pattern = '';
		while (p < s.length && s[p] !== '/') {
			if (s[p] === '\\' && p + 1 < s.length) {
				pattern += s[p + 1];
				p += 2;
			} else {
				pattern += s[p];
				p++;
			}
		}
		if (p < s.length) p++; // skip closing /
		const safety = checkRegexSafety(pattern);
		if (safety) {
			return { addr: null, end: p };
		}
		try {
			return { addr: { type: 'regex', regex: new RegExp(pattern) }, end: p };
		} catch {
			return { addr: null, end: p };
		}
	}

	return { addr: null, end: pos };
}

function parseSingleCommand(part: string): SedCmd | null {
	let pos = 0;
	const s = part.trim();

	// Parse optional address(es)
	const a1 = parseAddress(s, pos);
	const addr1 = a1.addr;
	pos = a1.end;
	let addr2: SedAddr | null = null;

	if (pos < s.length && s[pos] === ',') {
		pos++;
		const a2 = parseAddress(s, pos);
		addr2 = a2.addr;
		pos = a2.end;
	}

	// Skip whitespace
	while (pos < s.length && s[pos] === ' ') pos++;

	if (pos >= s.length) return null;

	const command = s[pos];
	const rest = s.slice(pos + 1);

	return { addr1: addr1, addr2, command, args: rest };
}

function matchesAddr(addr: SedAddr, lineNum: number, line: string, totalLines: number): boolean {
	switch (addr.type) {
		case 'line':
			return lineNum === (addr.line ?? 0);
		case 'last':
			return lineNum === totalLines;
		case 'regex':
			return addr.regex ? addr.regex.test(line) : false;
	}
}

function executeSubstitution(line: string, argsStr: string): string | null {
	if (argsStr.length === 0) return null;
	const delim = argsStr[0];

	// Parse s/pattern/replacement/flags
	let i = 1;
	let pattern = '';
	while (i < argsStr.length && argsStr[i] !== delim) {
		if (argsStr[i] === '\\' && i + 1 < argsStr.length) {
			pattern += argsStr[i] + argsStr[i + 1];
			i += 2;
		} else {
			pattern += argsStr[i];
			i++;
		}
	}
	i++; // skip delimiter

	let replacement = '';
	while (i < argsStr.length && argsStr[i] !== delim) {
		if (argsStr[i] === '\\' && i + 1 < argsStr.length) {
			replacement += argsStr[i] + argsStr[i + 1];
			i += 2;
		} else {
			replacement += argsStr[i];
			i++;
		}
	}
	i++; // skip delimiter

	const flagStr = argsStr.slice(i);
	let globalFlag = false;
	let caseFlag = false;
	let nthMatch = 0;

	for (let f = 0; f < flagStr.length; f++) {
		if (flagStr[f] === 'g') globalFlag = true;
		else if (flagStr[f] === 'i' || flagStr[f] === 'I') caseFlag = true;
		else if (flagStr[f] >= '1' && flagStr[f] <= '9') {
			nthMatch = Number.parseInt(flagStr[f], 10);
		}
	}

	// Security check
	const safety = checkRegexSafety(pattern);
	if (safety) return null;

	let flags = caseFlag ? 'i' : '';
	if (globalFlag) flags += 'g';

	let regex: RegExp;
	try {
		regex = new RegExp(pattern, flags);
	} catch {
		return null;
	}

	// Process replacement: convert \1-\9 to $1-$9, & to $&
	let jsReplacement = '';
	for (let r = 0; r < replacement.length; r++) {
		if (replacement[r] === '\\' && r + 1 < replacement.length) {
			const next = replacement[r + 1];
			if (next >= '1' && next <= '9') {
				jsReplacement += `$${next}`;
				r++;
			} else if (next === 'n') {
				jsReplacement += '\n';
				r++;
			} else if (next === 't') {
				jsReplacement += '\t';
				r++;
			} else {
				jsReplacement += next;
				r++;
			}
		} else if (replacement[r] === '&') {
			jsReplacement += '$&';
		} else {
			jsReplacement += replacement[r];
		}
	}

	if (nthMatch > 0) {
		// Replace only the Nth match
		let count = 0;
		const matchRegex = new RegExp(pattern, caseFlag ? 'ig' : 'g');
		let result = '';
		let lastIdx = 0;
		let m: RegExpExecArray | null;
		while (true) {
			m = matchRegex.exec(line);
			if (m === null) break;
			count++;
			if (count === nthMatch) {
				result += line.slice(lastIdx, m.index);
				result += line.slice(m.index, m.index + m[0].length).replace(regex, jsReplacement);
				lastIdx = m.index + m[0].length;
				break;
			}
		}
		if (count >= nthMatch) {
			result += line.slice(lastIdx);
			return result;
		}
		return line;
	}

	return line.replace(regex, jsReplacement);
}

export const sed: Command = {
	name: 'sed',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let inPlace = false;
		let suppressOutput = false;
		const expressions: string[] = [];
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-i') {
				inPlace = true;
				continue;
			}
			if (arg === '-n') {
				suppressOutput = true;
				continue;
			}
			if (arg === '-e' && i + 1 < args.length) {
				i++;
				expressions.push(args[i]);
				continue;
			}
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) files.push(args[j]);
				break;
			}
			if (expressions.length === 0 && files.length === 0) {
				expressions.push(arg);
			} else {
				files.push(arg);
			}
		}

		if (expressions.length === 0) {
			return { exitCode: 1, stdout: '', stderr: 'sed: no expression given\n' };
		}

		let cmds: SedCmd[];
		try {
			cmds = [];
			for (let i = 0; i < expressions.length; i++) {
				const parsed = parseSedExpr(expressions[i]);
				for (let j = 0; j < parsed.length; j++) {
					cmds.push(parsed[j]);
				}
			}
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exitCode: 1, stdout: '', stderr: `${msg}\n` };
		}

		let content = '';
		let stderr = '';

		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			const path = resolvePath(files[0], ctx.cwd);
			try {
				const data = ctx.fs.readFile(path);
				content = typeof data === 'string' ? data : await data;
			} catch {
				stderr = `sed: can't read ${files[0]}: No such file or directory\n`;
				return { exitCode: 2, stdout: '', stderr };
			}
		}

		const hasTrailingNewline = content.length > 0 && content[content.length - 1] === '\n';
		const lines = content.split('\n');
		if (hasTrailingNewline && lines[lines.length - 1] === '') {
			lines.pop();
		}

		const totalLines = lines.length;
		let stdout = '';
		const inRange = new Array<boolean>(cmds.length).fill(false);
		const rangeStartLine = new Array<number>(cmds.length).fill(0);

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];
			let deleted = false;
			let printed = false;
			const lineNum = i + 1;

			for (let c = 0; c < cmds.length; c++) {
				const cmd = cmds[c];
				let applies = true;

				if (cmd.addr1 !== null) {
					if (cmd.addr2 !== null) {
						// Range address
						if (!inRange[c]) {
							if (matchesAddr(cmd.addr1, lineNum, line, totalLines)) {
								inRange[c] = true;
								rangeStartLine[c] = lineNum;
							} else {
								applies = false;
							}
						}
						if (
							inRange[c] &&
							lineNum > rangeStartLine[c] &&
							matchesAddr(cmd.addr2, lineNum, line, totalLines)
						) {
							inRange[c] = false;
						}
					} else {
						applies = matchesAddr(cmd.addr1, lineNum, line, totalLines);
					}
				}

				if (!applies) continue;

				switch (cmd.command) {
					case 's': {
						const result = executeSubstitution(line, cmd.args);
						if (result !== null) line = result;
						break;
					}
					case 'd':
						deleted = true;
						break;
					case 'p':
						if (!deleted) {
							stdout += `${line}\n`;
							printed = true;
						}
						break;
				}

				if (deleted) break;
			}

			if (!deleted && !suppressOutput) {
				stdout += `${line}\n`;
			}
		}

		if (inPlace && files.length > 0) {
			const path = resolvePath(files[0], ctx.cwd);
			ctx.fs.writeFile(path, stdout);
			return { exitCode: 0, stdout: '', stderr };
		}

		return { exitCode: stderr.length > 0 ? 2 : 0, stdout, stderr };
	},
};
