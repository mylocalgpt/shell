import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const join: Command = {
  name: 'join',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let delimiter = ' ';
    let field1 = 1;
    let field2 = 1;
    let unpaired = 0; // 0=none, 1=file1, 2=file2
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-t' && i + 1 < args.length) {
        i++;
        delimiter = args[i];
        continue;
      }
      if (arg === '-1' && i + 1 < args.length) {
        i++;
        field1 = Number.parseInt(args[i], 10);
        continue;
      }
      if (arg === '-2' && i + 1 < args.length) {
        i++;
        field2 = Number.parseInt(args[i], 10);
        continue;
      }
      if (arg === '-a' && i + 1 < args.length) {
        i++;
        unpaired = Number.parseInt(args[i], 10);
        continue;
      }
      files.push(arg);
    }

    if (files.length < 2) {
      return { exitCode: 1, stdout: '', stderr: 'join: requires two files\n' };
    }

    const readLines = async (name: string): Promise<string[]> => {
      const path = resolvePath(name, ctx.cwd);
      const data = ctx.fs.readFile(path);
      const text = typeof data === 'string' ? data : await data;
      const lines = text.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) {
        lines.pop();
      }
      return lines;
    };

    let lines1: string[];
    let lines2: string[];
    try {
      lines1 = await readLines(files[0]);
      lines2 = await readLines(files[1]);
    } catch {
      return { exitCode: 1, stdout: '', stderr: 'join: cannot read input files\n' };
    }

    const getKey = (line: string, fieldNum: number): string => {
      const fields = line.split(delimiter);
      return fieldNum <= fields.length ? fields[fieldNum - 1] : '';
    };

    // Build index for file2
    const index2 = new Map<string, string[]>();
    const matched2 = new Set<number>();
    for (let i = 0; i < lines2.length; i++) {
      const key = getKey(lines2[i], field2);
      let arr = index2.get(key);
      if (!arr) {
        arr = [];
        index2.set(key, arr);
      }
      arr.push(lines2[i]);
    }

    let stdout = '';

    for (let i = 0; i < lines1.length; i++) {
      const key = getKey(lines1[i], field1);
      const matches = index2.get(key);
      if (matches && matches.length > 0) {
        for (let j = 0; j < matches.length; j++) {
          stdout += `${key}${delimiter}${lines1[i]
            .split(delimiter)
            .filter((_, k) => k !== field1 - 1)
            .join(delimiter)}`;
          const f2fields = matches[j].split(delimiter).filter((_, k) => k !== field2 - 1);
          if (f2fields.length > 0) {
            stdout += `${delimiter}${f2fields.join(delimiter)}`;
          }
          stdout += '\n';
        }
        // Mark matched lines2
        for (let j = 0; j < lines2.length; j++) {
          if (getKey(lines2[j], field2) === key) matched2.add(j);
        }
      } else if (unpaired === 1) {
        stdout += `${lines1[i]}\n`;
      }
    }

    if (unpaired === 2) {
      for (let j = 0; j < lines2.length; j++) {
        if (!matched2.has(j)) {
          stdout += `${lines2[j]}\n`;
        }
      }
    }

    return { exitCode: 0, stdout, stderr: '' };
  },
};
