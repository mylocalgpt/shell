import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function copyDir(src: string, dest: string, ctx: CommandContext): void {
  ctx.fs.mkdir(dest, { recursive: true });

  const entries = ctx.fs.readdir(src);
  for (let i = 0; i < entries.length; i++) {
    const srcChild = src === '/' ? `/${entries[i]}` : `${src}/${entries[i]}`;
    const destChild = dest === '/' ? `/${entries[i]}` : `${dest}/${entries[i]}`;
    const st = ctx.fs.stat(srcChild);
    if (st.isDirectory()) {
      copyDir(srcChild, destChild, ctx);
    } else {
      ctx.fs.copyFile(srcChild, destChild);
    }
  }
}

export const cp: Command = {
  name: 'cp',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let recursive = false;
    let noClobber = false;
    const paths: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        for (let j = i + 1; j < args.length; j++) paths.push(args[j]);
        break;
      }
      if (arg.startsWith('-') && arg.length > 1) {
        for (let c = 1; c < arg.length; c++) {
          switch (arg[c]) {
            case 'r':
            case 'R':
              recursive = true;
              break;
            case 'f':
              noClobber = false;
              break;
            case 'n':
              noClobber = true;
              break;
            default:
              return {
                exitCode: 1,
                stdout: '',
                stderr: `cp: invalid option -- '${arg[c]}'\n`,
              };
          }
        }
      } else {
        paths.push(arg);
      }
    }

    if (paths.length < 2) {
      return { exitCode: 1, stdout: '', stderr: 'cp: missing file operand\n' };
    }

    const destRaw = paths[paths.length - 1];
    const sources = paths.slice(0, paths.length - 1);
    const destPath = resolvePath(destRaw, ctx.cwd);

    let destIsDir = false;
    try {
      const st = ctx.fs.stat(destPath);
      destIsDir = st.isDirectory();
    } catch {
      // dest doesn't exist
    }

    if (sources.length > 1 && !destIsDir) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `cp: target '${destRaw}' is not a directory\n`,
      };
    }

    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < sources.length; i++) {
      const srcPath = resolvePath(sources[i], ctx.cwd);
      let target = destIsDir ? `${destPath}/${basename(srcPath)}` : destPath;
      if (destPath === '/') target = `/${basename(srcPath)}`;

      try {
        const st = ctx.fs.stat(srcPath);
        if (st.isDirectory()) {
          if (!recursive) {
            stderr += `cp: -r not specified; omitting directory '${sources[i]}'\n`;
            exitCode = 1;
            continue;
          }
          copyDir(srcPath, target, ctx);
        } else {
          if (noClobber && ctx.fs.exists(target)) continue;
          ctx.fs.copyFile(srcPath, target);
        }
      } catch {
        stderr += `cp: cannot stat '${sources[i]}': No such file or directory\n`;
        exitCode = 1;
      }
    }

    return { exitCode, stdout: '', stderr };
  },
};
