import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

/**
 * Parse a range specification like "1-3", "2,5", "3-", "-4".
 * Returns a sorted array of 1-based indices to include.
 */
function parseRanges(spec: string, maxLen: number): Set<number> {
  const result = new Set<number>();
  const parts = spec.split(',');

  for (let p = 0; p < parts.length; p++) {
    const part = parts[p].trim();
    const dashIdx = part.indexOf('-');

    if (dashIdx === -1) {
      const n = Number.parseInt(part, 10);
      if (!Number.isNaN(n) && n > 0) result.add(n);
    } else if (dashIdx === 0) {
      // -N: from 1 to N
      const end = Number.parseInt(part.slice(1), 10);
      if (!Number.isNaN(end)) {
        for (let i = 1; i <= end; i++) result.add(i);
      }
    } else if (dashIdx === part.length - 1) {
      // N-: from N to end
      const start = Number.parseInt(part.slice(0, -1), 10);
      if (!Number.isNaN(start)) {
        for (let i = start; i <= maxLen; i++) result.add(i);
      }
    } else {
      const start = Number.parseInt(part.slice(0, dashIdx), 10);
      const end = Number.parseInt(part.slice(dashIdx + 1), 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        for (let i = start; i <= end; i++) result.add(i);
      }
    }
  }

  return result;
}

export const cut: Command = {
  name: 'cut',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let delimiter = '\t';
    let fieldSpec = '';
    let charSpec = '';
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-d' && i + 1 < args.length) {
        i++;
        delimiter = args[i];
        continue;
      }
      if (arg.startsWith('-d') && arg.length > 2) {
        delimiter = arg.slice(2);
        continue;
      }
      if (arg === '-f' && i + 1 < args.length) {
        i++;
        fieldSpec = args[i];
        continue;
      }
      if (arg.startsWith('-f') && arg.length > 2) {
        fieldSpec = arg.slice(2);
        continue;
      }
      if (arg === '-c' && i + 1 < args.length) {
        i++;
        charSpec = args[i];
        continue;
      }
      if (arg.startsWith('-c') && arg.length > 2) {
        charSpec = arg.slice(2);
        continue;
      }
      if (arg === '--') {
        for (let j = i + 1; j < args.length; j++) files.push(args[j]);
        break;
      }
      files.push(arg);
    }

    if (fieldSpec === '' && charSpec === '') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'cut: you must specify a list of bytes, characters, or fields\n',
      };
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
          stderr += `cut: ${files[i]}: No such file or directory\n`;
        }
      }
    }

    if (content.length === 0) {
      return { exitCode: stderr.length > 0 ? 1 : 0, stdout: '', stderr };
    }

    const hasTrailingNewline = content[content.length - 1] === '\n';
    const lines = content.split('\n');
    if (hasTrailingNewline && lines[lines.length - 1] === '') {
      lines.pop();
    }

    let stdout = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (charSpec) {
        const indices = parseRanges(charSpec, line.length);
        let result = '';
        for (let c = 1; c <= line.length; c++) {
          if (indices.has(c)) result += line[c - 1];
        }
        stdout += `${result}\n`;
      } else if (fieldSpec) {
        const fields = line.split(delimiter);
        const indices = parseRanges(fieldSpec, fields.length);
        const selected: string[] = [];
        for (let f = 1; f <= fields.length; f++) {
          if (indices.has(f)) selected.push(fields[f - 1]);
        }
        stdout += `${selected.join(delimiter)}\n`;
      }
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};
