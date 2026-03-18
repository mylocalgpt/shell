import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(input: string): string {
	// Convert string to bytes (UTF-8)
	const bytes: number[] = [];
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
			const next = input.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				const cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
				bytes.push(
					0xf0 | (cp >> 18),
					0x80 | ((cp >> 12) & 0x3f),
					0x80 | ((cp >> 6) & 0x3f),
					0x80 | (cp & 0x3f),
				);
				i++;
			}
		} else {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}

	let result = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;

		result += CHARS[b0 >> 2];
		result += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
		result += i + 1 < bytes.length ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
		result += i + 2 < bytes.length ? CHARS[b2 & 63] : '=';
	}
	return result;
}

function decodeBase64(input: string): string {
	const lookup = new Map<string, number>();
	for (let i = 0; i < CHARS.length; i++) lookup.set(CHARS[i], i);

	const clean = input.replace(/[\s\n\r]/g, '');
	const bytes: number[] = [];

	for (let i = 0; i < clean.length; i += 4) {
		const a = lookup.get(clean[i]) ?? 0;
		const b = lookup.get(clean[i + 1]) ?? 0;
		const c = lookup.get(clean[i + 2]) ?? 0;
		const d = lookup.get(clean[i + 3]) ?? 0;

		bytes.push((a << 2) | (b >> 4));
		if (clean[i + 2] !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
		if (clean[i + 3] !== '=') bytes.push(((c & 3) << 6) | d);
	}

	// Decode UTF-8 bytes to string
	let result = '';
	let j = 0;
	while (j < bytes.length) {
		const b = bytes[j];
		if (b < 0x80) {
			result += String.fromCharCode(b);
			j++;
		} else if (b < 0xe0) {
			result += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f));
			j += 2;
		} else if (b < 0xf0) {
			result += String.fromCharCode(
				((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f),
			);
			j += 3;
		} else {
			const cp =
				((b & 0x07) << 18) |
				((bytes[j + 1] & 0x3f) << 12) |
				((bytes[j + 2] & 0x3f) << 6) |
				(bytes[j + 3] & 0x3f);
			result += String.fromCodePoint(cp);
			j += 4;
		}
	}
	return result;
}

function wrapOutput(s: string, width: number): string {
	if (width <= 0) return s;
	let result = '';
	for (let i = 0; i < s.length; i += width) {
		result += s.slice(i, i + width);
		if (i + width < s.length) result += '\n';
	}
	return result;
}

export const base64: Command = {
	name: 'base64',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let decode = false;
		let wrapWidth = 76;
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-d' || arg === '--decode') {
				decode = true;
				continue;
			}
			if (arg === '-w' && i + 1 < args.length) {
				i++;
				wrapWidth = Number.parseInt(args[i], 10);
				continue;
			}
			files.push(arg);
		}

		let content = '';
		if (files.length === 0) {
			content = ctx.stdin;
		} else {
			const path = resolvePath(files[0], ctx.cwd);
			try {
				const data = ctx.fs.readFile(path);
				content = typeof data === 'string' ? data : await data;
			} catch {
				return {
					exitCode: 1,
					stdout: '',
					stderr: `base64: ${files[0]}: No such file or directory\n`,
				};
			}
		}

		if (decode) {
			const decoded = decodeBase64(content);
			return { exitCode: 0, stdout: decoded, stderr: '' };
		}

		let encoded = encodeBase64(content);
		encoded = wrapOutput(encoded, wrapWidth);
		return { exitCode: 0, stdout: `${encoded}\n`, stderr: '' };
	},
};
