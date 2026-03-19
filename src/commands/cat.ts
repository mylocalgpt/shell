import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

async function readInput(
  files: string[],
  ctx: CommandContext,
): Promise<{ content: string; error: string }> {
  let content = '';
  let error = '';

  if (files.length === 0) {
    content = ctx.stdin;
  } else {
    for (let i = 0; i < files.length; i++) {
      if (files[i] === '-') {
        content += ctx.stdin;
      } else {
        const path = resolvePath(files[i], ctx.cwd);
        try {
          const data = ctx.fs.readFile(path);
          content += typeof data === 'string' ? data : await data;
        } catch {
          error += `cat: ${files[i]}: No such file or directory\n`;
        }
      }
    }
  }

  return { content, error };
}

export const cat: Command = {
  name: 'cat',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let numberLines = false;
    let numberNonBlank = false;
    let squeezeBlank = false;
    let showEnds = false;
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        for (let j = i + 1; j < args.length; j++) files.push(args[j]);
        break;
      }
      if (arg.startsWith('-') && arg.length > 1 && arg !== '-') {
        for (let c = 1; c < arg.length; c++) {
          switch (arg[c]) {
            case 'n':
              numberLines = true;
              break;
            case 'b':
              numberNonBlank = true;
              break;
            case 's':
              squeezeBlank = true;
              break;
            case 'E':
              showEnds = true;
              break;
            default:
              return {
                exitCode: 1,
                stdout: '',
                stderr: `cat: invalid option -- '${arg[c]}'\n`,
              };
          }
        }
      } else {
        files.push(arg);
      }
    }

    // -b overrides -n
    if (numberNonBlank) numberLines = false;

    const { content, error } = await readInput(files, ctx);

    if (content.length === 0 && error.length > 0) {
      return { exitCode: 1, stdout: '', stderr: error };
    }

    let lines = content.split('\n');
    // Preserve trailing newline behavior
    const hadTrailingNewline = content.length > 0 && content[content.length - 1] === '\n';
    if (hadTrailingNewline && lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (squeezeBlank) {
      const squeezed: string[] = [];
      let prevBlank = false;
      for (let i = 0; i < lines.length; i++) {
        const isBlank = lines[i].length === 0;
        if (isBlank && prevBlank) continue;
        squeezed.push(lines[i]);
        prevBlank = isBlank;
      }
      lines = squeezed;
    }

    let output = '';
    let lineNum = 1;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (numberNonBlank) {
        if (line.length > 0) {
          const numStr = String(lineNum);
          let pad = '';
          for (let p = numStr.length; p < 6; p++) pad += ' ';
          line = `${pad}${numStr}\t${line}`;
          lineNum++;
        }
      } else if (numberLines) {
        const numStr = String(lineNum);
        let pad = '';
        for (let p = numStr.length; p < 6; p++) pad += ' ';
        line = `${pad}${numStr}\t${line}`;
        lineNum++;
      }

      if (showEnds) {
        line = `${line}$`;
      }

      output += line;
      if (i < lines.length - 1 || hadTrailingNewline) {
        output += '\n';
      }
    }

    return { exitCode: error.length > 0 ? 1 : 0, stdout: output, stderr: error };
  },
};
