import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function toHex(n: number, width: number): string {
  const h = n.toString(16);
  let pad = '';
  for (let i = h.length; i < width; i++) pad += '0';
  return pad + h;
}

export const xxd: Command = {
  name: 'xxd',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let limitBytes = -1;
    let offset = 0;
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-l' && i + 1 < args.length) {
        limitBytes = Number.parseInt(args[++i], 10);
      } else if (arg === '-s' && i + 1 < args.length) {
        offset = Number.parseInt(args[++i], 10);
      } else if (!arg.startsWith('-')) {
        files.push(arg);
      }
    }

    let input: string;
    if (files.length > 0) {
      const path = resolvePath(files[0], ctx.cwd);
      try {
        const data = ctx.fs.readFile(path);
        input = typeof data === 'string' ? data : await data;
      } catch {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `xxd: ${files[0]}: No such file or directory\n`,
        };
      }
    } else {
      input = ctx.stdin;
    }

    // Apply offset
    if (offset > 0) {
      input = input.slice(offset);
    }

    // Apply length limit
    if (limitBytes >= 0) {
      input = input.slice(0, limitBytes);
    }

    if (input.length === 0) {
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    let stdout = '';
    const bytesPerLine = 16;

    for (let pos = 0; pos < input.length; pos += bytesPerLine) {
      const lineAddr = offset + pos;
      let hexPart = '';
      let asciiPart = '';
      const end = pos + bytesPerLine < input.length ? pos + bytesPerLine : input.length;
      const count = end - pos;

      for (let j = 0; j < count; j++) {
        const code = input.charCodeAt(pos + j) & 0xff;
        hexPart += toHex(code, 2);
        // Group bytes in pairs: add space after every 2nd byte within pair
        if (j % 2 === 1 && j < count - 1) {
          hexPart += ' ';
        }
        asciiPart += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '.';
      }

      // Pad hex part to fixed width: 16 bytes = 8 groups of 4 hex chars + 7 spaces = 39 chars
      while (hexPart.length < 39) hexPart += ' ';

      stdout += `${toHex(lineAddr, 8)}: ${hexPart}  ${asciiPart}\n`;
    }

    return { exitCode: 0, stdout, stderr: '' };
  },
};
