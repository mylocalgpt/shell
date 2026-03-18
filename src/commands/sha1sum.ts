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

function rotl(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function sha1(input: string): string {
	const bytes = toBytes(input);
	const len = bytes.length;

	bytes.push(0x80);
	while (bytes.length % 64 !== 56) bytes.push(0);

	const bitLen = len * 8;
	bytes.push(0, 0, 0, 0);
	bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;

	for (let offset = 0; offset < bytes.length; offset += 64) {
		const W: number[] = [];
		for (let t = 0; t < 16; t++) {
			const idx = offset + t * 4;
			W.push(
				((bytes[idx] << 24) | (bytes[idx + 1] << 16) | (bytes[idx + 2] << 8) | bytes[idx + 3]) >>>
					0,
			);
		}
		for (let t = 16; t < 80; t++) {
			W.push(rotl(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1));
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;

		for (let t = 0; t < 80; t++) {
			let f: number;
			let k: number;
			if (t < 20) {
				f = (b & c) | (~b & d);
				k = 0x5a827999;
			} else if (t < 40) {
				f = b ^ c ^ d;
				k = 0x6ed9eba1;
			} else if (t < 60) {
				f = (b & c) | (b & d) | (c & d);
				k = 0x8f1bbcdc;
			} else {
				f = b ^ c ^ d;
				k = 0xca62c1d6;
			}

			const temp = (rotl(a, 5) + f + e + k + W[t]) >>> 0;
			e = d;
			d = c;
			c = rotl(b, 30);
			b = a;
			a = temp;
		}

		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}

	return toBEHex(h0) + toBEHex(h1) + toBEHex(h2) + toBEHex(h3) + toBEHex(h4);
}

function toBEHex(n: number): string {
	let result = '';
	for (let i = 3; i >= 0; i--) {
		const byte = (n >> (i * 8)) & 0xff;
		result += byte < 16 ? `0${byte.toString(16)}` : byte.toString(16);
	}
	return result;
}

export const sha1sum: Command = {
	name: 'sha1sum',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		const files: string[] = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i].startsWith('-')) continue;
			files.push(args[i]);
		}

		let stdout = '';
		let stderr = '';

		if (files.length === 0) {
			const hash = sha1(ctx.stdin);
			stdout = `${hash}  -\n`;
		} else {
			for (let i = 0; i < files.length; i++) {
				const path = resolvePath(files[i], ctx.cwd);
				try {
					const data = ctx.fs.readFile(path);
					const text = typeof data === 'string' ? data : await data;
					const hash = sha1(text);
					stdout += `${hash}  ${files[i]}\n`;
				} catch {
					stderr += `sha1sum: ${files[i]}: No such file or directory\n`;
				}
			}
		}

		return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
	},
};
