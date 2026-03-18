import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const od: Command = {
	name: 'od',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let addressRadix = 'o'; // o=octal, d=decimal, x=hex, n=none
		let outputType = 'o'; // o=octal, x=hex, d=decimal, c=char
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-A' && i + 1 < args.length) {
				i++;
				addressRadix = args[i];
				continue;
			}
			if (arg === '-t' && i + 1 < args.length) {
				i++;
				outputType = args[i][0];
				continue;
			}
			if (arg === '-x') {
				outputType = 'x';
				continue;
			}
			if (arg === '-c') {
				outputType = 'c';
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
				return { exitCode: 1, stdout: '', stderr: `od: ${files[0]}: No such file or directory\n` };
			}
		}

		let stdout = '';
		const bytesPerLine = 16;

		for (let offset = 0; offset < content.length; offset += bytesPerLine) {
			// Address
			if (addressRadix !== 'n') {
				stdout += formatAddr(offset, addressRadix);
			}

			// Data
			const end = Math.min(offset + bytesPerLine, content.length);
			for (let i = offset; i < end; i++) {
				const byte = content.charCodeAt(i);
				stdout += ` ${formatByte(byte, outputType)}`;
			}

			stdout += '\n';
		}

		// Final address
		if (addressRadix !== 'n') {
			stdout += `${formatAddr(content.length, addressRadix)}\n`;
		}

		return { exitCode: 0, stdout, stderr: '' };
	},
};

function formatAddr(offset: number, radix: string): string {
	switch (radix) {
		case 'o':
			return offset.toString(8).padStart(7, '0');
		case 'd':
			return offset.toString(10).padStart(7, '0');
		case 'x':
			return offset.toString(16).padStart(7, '0');
		default:
			return '';
	}
}

function formatByte(byte: number, type: string): string {
	switch (type) {
		case 'o':
			return byte.toString(8).padStart(3, '0');
		case 'x':
			return byte.toString(16).padStart(2, '0');
		case 'd':
			return byte.toString(10).padStart(3, ' ');
		case 'c': {
			if (byte === 0) return '\\0';
			if (byte === 9) return '\\t';
			if (byte === 10) return '\\n';
			if (byte === 13) return '\\r';
			if (byte >= 32 && byte <= 126) return ` ${String.fromCharCode(byte)}`;
			return byte.toString(8).padStart(3, '0');
		}
		default:
			return byte.toString(8).padStart(3, '0');
	}
}
