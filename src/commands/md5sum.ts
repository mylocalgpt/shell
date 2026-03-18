import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function toBytes(s: string): number[] {
	const bytes: number[] = [];
	for (let i = 0; i < s.length; i++) {
		const code = s.charCodeAt(i);
		if (code < 0x80) bytes.push(code);
		else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else {
			bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
		}
	}
	return bytes;
}

/* MD5 implementation following RFC 1321 */
function md5(input: string): string {
	const bytes = toBytes(input);
	const len = bytes.length;

	// Padding
	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);

	// Length in bits (little-endian, 64-bit)
	const bitLen = len * 8;
	bytes.push(bitLen & 0xff, (bitLen >> 8) & 0xff, (bitLen >> 16) & 0xff, (bitLen >> 24) & 0xff);
	bytes.push(0, 0, 0, 0); // upper 32 bits (sufficient for our purposes)

	// Constants
	const S: number[][] = [
		[7, 12, 17, 22],
		[5, 9, 14, 20],
		[4, 11, 16, 23],
		[6, 10, 15, 21],
	];
	const T: number[] = [];
	for (let i = 1; i <= 64; i++) {
		T.push(Math.floor(Math.abs(Math.sin(i)) * 0x100000000) >>> 0);
	}

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;

	for (let offset = 0; offset < bytes.length; offset += 64) {
		const M: number[] = [];
		for (let j = 0; j < 16; j++) {
			const idx = offset + j * 4;
			M.push(bytes[idx] | (bytes[idx + 1] << 8) | (bytes[idx + 2] << 16) | (bytes[idx + 3] << 24));
		}

		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;

		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}

			f = (f + a + T[i] + M[g]) >>> 0;
			a = d;
			d = c;
			c = b;
			const round = Math.floor(i / 16);
			const shift = S[round][i % 4];
			b = (b + (((f << shift) | (f >>> (32 - shift))) >>> 0)) >>> 0;
		}

		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}

	// Output as little-endian hex
	return toLEHex(a0) + toLEHex(b0) + toLEHex(c0) + toLEHex(d0);
}

function toLEHex(n: number): string {
	let result = '';
	for (let i = 0; i < 4; i++) {
		const byte = (n >> (i * 8)) & 0xff;
		result += byte < 16 ? `0${byte.toString(16)}` : byte.toString(16);
	}
	return result;
}

export const md5sum: Command = {
	name: 'md5sum',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		const files: string[] = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i].startsWith('-')) continue;
			files.push(args[i]);
		}

		let stdout = '';
		let stderr = '';

		if (files.length === 0) {
			const hash = md5(ctx.stdin);
			stdout = `${hash}  -\n`;
		} else {
			for (let i = 0; i < files.length; i++) {
				const path = resolvePath(files[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					const text = typeof data === 'string' ? data : await data;
					const hash = md5(text);
					stdout += `${hash}  ${files[i]}\n`;
				} catch {
					stderr += `md5sum: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
