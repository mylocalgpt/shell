import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

interface SortKey {
	field: number; // 1-based
	endField: number; // 1-based, -1 means same as field
	numeric: boolean;
}

function parseHumanNumeric(s: string): number {
	const trimmed = s.trim();
	if (trimmed.length === 0) return 0;
	const last = trimmed[trimmed.length - 1];
	const multipliers: Record<string, number> = {
		K: 1024,
		M: 1024 * 1024,
		G: 1024 * 1024 * 1024,
		T: 1024 * 1024 * 1024 * 1024,
	};
	const mult = multipliers[last.toUpperCase()];
	if (mult) {
		const num = Number.parseFloat(trimmed.slice(0, -1));
		return Number.isNaN(num) ? 0 : num * mult;
	}
	const num = Number.parseFloat(trimmed);
	return Number.isNaN(num) ? 0 : num;
}

function getField(line: string, fieldNum: number, delimiter: string | null): string {
	const fields = delimiter !== null ? line.split(delimiter) : line.trim().split(/\s+/);
	if (fieldNum <= 0 || fieldNum > fields.length) return '';
	return fields[fieldNum - 1];
}

export const sort: Command = {
	name: 'sort',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let reverse = false;
		let numeric = false;
		let unique = false;
		let ignoreCase = false;
		let humanNumeric = false;
		let delimiter = '';
		const keys: SortKey[] = [];
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '--') {
				for (let j = i + 1; j < args.length; j++) files.push(args[j]);
				break;
			}
			if (arg === '-t' && i + 1 < args.length) {
				i++;
				delimiter = args[i];
				continue;
			}
			if (arg.startsWith('-t') && arg.length > 2) {
				delimiter = arg.slice(2);
				continue;
			}
			if (arg === '-k' && i + 1 < args.length) {
				i++;
				const keySpec = args[i];
				const key = parseKeySpec(keySpec);
				if (key) keys.push(key);
				continue;
			}
			if (arg.startsWith('-k') && arg.length > 2) {
				const key = parseKeySpec(arg.slice(2));
				if (key) keys.push(key);
				continue;
			}
			if (arg.startsWith('-') && arg.length > 1) {
				for (let c = 1; c < arg.length; c++) {
					switch (arg[c]) {
						case 'r':
							reverse = true;
							break;
						case 'n':
							numeric = true;
							break;
						case 'u':
							unique = true;
							break;
						case 'f':
							ignoreCase = true;
							break;
						case 'h':
							humanNumeric = true;
							break;
						default:
							return {
								exitCode: 2,
								stdout: '',
								stderr: `sort: invalid option -- '${arg[c]}'\n`,
							};
					}
				}
				continue;
			}
			files.push(arg);
		}

		let content = '';
		let stderr = '';

		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			for (let i = 0; i < files.length; i++) {
				const path = resolvePath(files[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					content += typeof data === 'string' ? data : await data;
				} catch {
					stderr += `sort: cannot read: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		if (content.length === 0) {
			return { exitCode: stderr.length > 0 ? 2 : 0, stdout: '', stderr };
		}

		const hasTrailingNewline = content[content.length - 1] === '\n';
		let lines = content.split('\n');
		if (hasTrailingNewline && lines[lines.length - 1] === '') {
			lines.pop();
		}

		const sep = delimiter || null;

		// Build comparison function
		const compare = (a: string, b: string): number => {
			if (keys.length > 0) {
				for (let k = 0; k < keys.length; k++) {
					const key = keys[k];
					const aField = getField(a, key.field, sep);
					const bField = getField(b, key.field, sep);
					let cmp: number;
					if (key.numeric || numeric) {
						cmp = (Number.parseFloat(aField) || 0) - (Number.parseFloat(bField) || 0);
					} else if (ignoreCase) {
						cmp =
							aField.toLowerCase() < bField.toLowerCase()
								? -1
								: aField.toLowerCase() > bField.toLowerCase()
									? 1
									: 0;
					} else {
						cmp = aField < bField ? -1 : aField > bField ? 1 : 0;
					}
					if (cmp !== 0) return reverse ? -cmp : cmp;
				}
				return 0;
			}

			if (humanNumeric) {
				const diff = parseHumanNumeric(a) - parseHumanNumeric(b);
				return reverse ? -diff : diff;
			}
			if (numeric) {
				const diff = (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0);
				return reverse ? -diff : diff;
			}
			let aVal = a;
			let bVal = b;
			if (ignoreCase) {
				aVal = a.toLowerCase();
				bVal = b.toLowerCase();
			}
			const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
			return reverse ? -cmp : cmp;
		};

		lines.sort(compare);

		if (unique) {
			const deduped: string[] = [lines[0]];
			for (let i = 1; i < lines.length; i++) {
				if (compare(lines[i], lines[i - 1]) !== 0) {
					deduped.push(lines[i]);
				}
			}
			lines = deduped;
		}

		let stdout = lines.join('\n');
		if (hasTrailingNewline || stdout.length > 0) stdout += '\n';

		return { exitCode: stderr.length > 0 ? 2 : 0, stdout, stderr };
	},
};

function parseKeySpec(spec: string): SortKey | null {
	// Parse "2,2" or "2,2n" or "2"
	const parts = spec.split(',');
	const field = Number.parseInt(parts[0], 10);
	if (Number.isNaN(field)) return null;

	let endField = field;
	let numericKey = false;

	if (parts.length > 1) {
		const endPart = parts[1];
		// Check for trailing modifiers
		let endStr = '';
		for (let i = 0; i < endPart.length; i++) {
			if (endPart[i] >= '0' && endPart[i] <= '9') {
				endStr += endPart[i];
			} else if (endPart[i] === 'n') {
				numericKey = true;
			}
		}
		if (endStr.length > 0) {
			endField = Number.parseInt(endStr, 10);
		}
	}

	return { field, endField, numeric: numericKey };
}
