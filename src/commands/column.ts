import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const column: Command = {
  name: 'column',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let tableMode = false;
    let separator = ' \t';
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-t') {
        tableMode = true;
        continue;
      }
      if (arg === '-s' && i + 1 < args.length) {
        i++;
        separator = args[i];
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
          stderr += `column: ${files[i]}: No such file or directory\n`;
        }
      }
    }

    if (content.length === 0) return { exitCode: 0, stdout: '', stderr };

    const hasTrailingNewline = content[content.length - 1] === '\n';
    const lines = content.split('\n');
    if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop();

    if (!tableMode) {
      // Simple output, no formatting
      let stdout = '';
      for (let i = 0; i < lines.length; i++) {
        stdout += `${lines[i]}\n`;
      }
      return { exitCode: 0, stdout, stderr };
    }

    // Table mode: split each line by separator, compute column widths, pad
    const sepRegex = new RegExp(`[${escapeRegex(separator)}]+`);
    const rows: string[][] = [];
    let maxCols = 0;

    for (let i = 0; i < lines.length; i++) {
      const fields = lines[i].split(sepRegex).filter((f) => f.length > 0);
      rows.push(fields);
      if (fields.length > maxCols) maxCols = fields.length;
    }

    // Compute column widths
    const widths: number[] = [];
    for (let c = 0; c < maxCols; c++) widths.push(0);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c].length > widths[c]) {
          widths[c] = rows[r][c].length;
        }
      }
    }

    let stdout = '';
    for (let r = 0; r < rows.length; r++) {
      let line = '';
      for (let c = 0; c < rows[r].length; c++) {
        if (c > 0) line += '  '; // 2-space gap
        const field = rows[r][c];
        if (c < rows[r].length - 1) {
          // Pad all but last column
          line += field;
          const pad = widths[c] - field.length;
          for (let p = 0; p < pad; p++) line += ' ';
        } else {
          line += field;
        }
      }
      stdout += `${line}\n`;
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};

function escapeRegex(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('-]\\^$*+?.()|{}'.includes(c)) {
      result += `\\${c}`;
    } else {
      result += c;
    }
  }
  return result;
}
