import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const tail: Command = {
  name: 'tail',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let lineCount = 10;
    let byteCount = -1;
    let fromLine = false; // +N syntax
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-n' && i + 1 < args.length) {
        i++;
        const val = args[i];
        if (val.startsWith('+')) {
          fromLine = true;
          lineCount = Number.parseInt(val.slice(1), 10);
        } else {
          lineCount = Math.abs(Number.parseInt(val, 10));
        }
        continue;
      }
      if (arg.startsWith('-n') && arg.length > 2) {
        const val = arg.slice(2);
        if (val.startsWith('+')) {
          fromLine = true;
          lineCount = Number.parseInt(val.slice(1), 10);
        } else {
          lineCount = Math.abs(Number.parseInt(val, 10));
        }
        continue;
      }
      if (arg === '-c' && i + 1 < args.length) {
        i++;
        byteCount = Number.parseInt(args[i], 10);
        continue;
      }
      if (arg === '-f') continue; // Accept but no-op
      if (arg.startsWith('-') && arg.length > 1 && /^-\d+$/.test(arg)) {
        lineCount = Math.abs(Number.parseInt(arg, 10));
        continue;
      }
      files.push(arg);
    }

    const inputs: Array<{ name: string; content: string }> = [];
    let stderr = '';

    if (files.length === 0) {
      inputs.push({ name: '', content: ctx.stdin });
    } else {
      for (let i = 0; i < files.length; i++) {
        if (files[i] === '-') {
          inputs.push({ name: 'standard input', content: ctx.stdin });
        } else {
          const path = resolvePath(files[i], ctx.cwd);
          try {
            const data = ctx.fs.readFile(path);
            const text = typeof data === 'string' ? data : await data;
            inputs.push({ name: files[i], content: text });
          } catch {
            stderr += `tail: cannot open '${files[i]}' for reading: No such file or directory\n`;
          }
        }
      }
    }

    let stdout = '';
    const showHeaders = inputs.length > 1;

    for (let i = 0; i < inputs.length; i++) {
      if (showHeaders) {
        if (i > 0) stdout += '\n';
        stdout += `==> ${inputs[i].name} <==\n`;
      }

      const content = inputs[i].content;
      if (byteCount >= 0) {
        stdout += content.slice(-byteCount);
      } else {
        const lines = content.split('\n');
        // Remove trailing empty element from trailing newline
        if (lines.length > 0 && lines[lines.length - 1] === '' && content.endsWith('\n')) {
          lines.pop();
        }

        if (fromLine) {
          // +N means starting from line N (1-based)
          const start = Math.max(0, lineCount - 1);
          for (let j = start; j < lines.length; j++) {
            stdout += `${lines[j]}\n`;
          }
        } else {
          const start = Math.max(0, lines.length - lineCount);
          for (let j = start; j < lines.length; j++) {
            stdout += `${lines[j]}\n`;
          }
        }
      }
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};
