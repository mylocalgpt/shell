import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function formatPermissions(mode: number): string {
  const types = [
    [mode & 0o400, 'r'],
    [mode & 0o200, 'w'],
    [mode & 0o100, 'x'],
    [mode & 0o040, 'r'],
    [mode & 0o020, 'w'],
    [mode & 0o010, 'x'],
    [mode & 0o004, 'r'],
    [mode & 0o002, 'w'],
    [mode & 0o001, 'x'],
  ] as const;
  let result = '';
  for (let i = 0; i < types.length; i++) {
    result += types[i][0] ? types[i][1] : '-';
  }
  return result;
}

function formatOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

function applyFormat(
  format: string,
  name: string,
  size: number,
  mode: number,
  isDir: boolean,
  mtime: Date,
): string {
  let result = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '%' && i + 1 < format.length) {
      i++;
      switch (format[i]) {
        case 'n':
          result += name;
          break;
        case 's':
          result += String(size);
          break;
        case 'a':
          result += formatOctal(mode);
          break;
        case 'A':
          result += (isDir ? 'd' : '-') + formatPermissions(mode);
          break;
        case 'F':
          result += isDir ? 'directory' : 'regular file';
          break;
        case 'Y':
          result += String(Math.floor(mtime.getTime() / 1000));
          break;
        case 'y':
          result += formatDate(mtime);
          break;
        default:
          result += `%${format[i]}`;
          break;
      }
      i++;
    } else if (format[i] === '\\' && i + 1 < format.length) {
      i++;
      if (format[i] === 'n') result += '\n';
      else if (format[i] === 't') result += '\t';
      else result += format[i];
      i++;
    } else {
      result += format[i];
      i++;
    }
  }
  return result;
}

export const stat: Command = {
  name: 'stat',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let format = '';
    const paths: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-c' || arg === '--format') {
        i++;
        if (i < args.length) format = args[i];
        continue;
      }
      if (arg.startsWith('-c') && arg.length > 2) {
        format = arg.slice(2);
        continue;
      }
      if (arg.startsWith('--format=')) {
        format = arg.slice(9);
        continue;
      }
      paths.push(arg);
    }

    if (paths.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'stat: missing operand\n' };
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < paths.length; i++) {
      const resolved = resolvePath(paths[i], ctx.cwd);
      try {
        const st = ctx.fs.stat(resolved);
        const isDir = st.isDirectory();

        if (format) {
          stdout += `${applyFormat(format, paths[i], st.size, st.mode, isDir, st.mtime)}\n`;
        } else {
          const typeStr = isDir ? 'directory' : 'regular file';
          stdout += `  File: ${paths[i]}\n`;
          stdout += `  Size: ${st.size}\tBlocks: 0\tIO Block: 4096\t${typeStr}\n`;
          stdout += `Access: (${formatOctal(st.mode)}/${isDir ? 'd' : '-'}${formatPermissions(st.mode)})\n`;
          stdout += `Modify: ${formatDate(st.mtime)}\n`;
          stdout += `Change: ${formatDate(st.ctime)}\n`;
        }
      } catch {
        stderr += `stat: cannot stat '${paths[i]}': No such file or directory\n`;
        exitCode = 1;
      }
    }

    return { exitCode, stdout, stderr };
  },
};
