import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const nl: Command = {
  name: 'nl',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let bodyNumbering = 't'; // t=non-empty (default), a=all, n=none
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-b' && i + 1 < args.length) {
        i++;
        bodyNumbering = args[i];
        continue;
      }
      if (arg.startsWith('-b') && arg.length > 2) {
        bodyNumbering = arg.slice(2);
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
          stderr += `nl: ${files[i]}: No such file or directory\n`;
        }
      }
    }

    const hasTrailingNewline = content.length > 0 && content[content.length - 1] === '\n';
    const lines = content.split('\n');
    if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop();

    let stdout = '';
    let lineNum = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let shouldNumber = false;

      if (bodyNumbering === 'a') {
        shouldNumber = true;
      } else if (bodyNumbering === 't') {
        shouldNumber = line.length > 0;
      }

      if (shouldNumber) {
        const numStr = String(lineNum);
        let pad = '';
        for (let p = numStr.length; p < 6; p++) pad += ' ';
        stdout += `${pad}${numStr}\t${line}\n`;
        lineNum++;
      } else {
        stdout += `\t${line}\n`;
      }
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};
