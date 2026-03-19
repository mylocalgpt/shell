import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const unexpand: Command = {
  name: 'unexpand',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let tabStop = 8;
    let firstOnly = true; // Default: only leading whitespace
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-t' && i + 1 < args.length) {
        i++;
        tabStop = Number.parseInt(args[i], 10);
        firstOnly = false; // -t implies converting all
        continue;
      }
      if (arg === '--first-only') {
        firstOnly = true;
        continue;
      }
      if (arg === '-a') {
        firstOnly = false;
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
          stderr += `unexpand: ${files[i]}: No such file or directory\n`;
        }
      }
    }

    const lines = content.split('\n');
    let stdout = '';

    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      if (firstOnly) {
        // Only convert leading spaces
        let spaceCount = 0;
        let pos = 0;
        while (pos < line.length && line[pos] === ' ') {
          spaceCount++;
          pos++;
        }
        const tabs = Math.floor(spaceCount / tabStop);
        const remainingSpaces = spaceCount % tabStop;
        let result = '';
        for (let t = 0; t < tabs; t++) result += '\t';
        for (let s = 0; s < remainingSpaces; s++) result += ' ';
        result += line.slice(pos);
        stdout += result;
      } else {
        // Convert all sequences of spaces at tab stops
        let result = '';
        let col = 0;
        let spaceRun = 0;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === ' ') {
            spaceRun++;
            col++;
            if (col % tabStop === 0 && spaceRun > 0) {
              result += '\t';
              spaceRun = 0;
            }
          } else {
            for (let s = 0; s < spaceRun; s++) result += ' ';
            spaceRun = 0;
            result += line[i];
            col++;
          }
        }
        for (let s = 0; s < spaceRun; s++) result += ' ';
        stdout += result;
      }
      if (l < lines.length - 1) stdout += '\n';
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};
