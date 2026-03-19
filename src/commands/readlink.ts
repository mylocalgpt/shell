import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const readlink: Command = {
  name: 'readlink',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let canonicalize = false;
    const paths: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-f' || arg === '-e' || arg === '-m') {
        canonicalize = true;
        continue;
      }
      paths.push(arg);
    }

    if (paths.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'readlink: missing operand\n' };
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < paths.length; i++) {
      const resolved = resolvePath(paths[i], ctx.cwd);
      if (canonicalize) {
        try {
          const real = ctx.fs.realpath(resolved);
          stdout += `${real}\n`;
        } catch {
          stderr += `readlink: ${paths[i]}: No such file or directory\n`;
          exitCode = 1;
        }
      } else {
        try {
          const target = ctx.fs.readlink(resolved);
          stdout += `${target}\n`;
        } catch {
          stderr += `readlink: ${paths[i]}: Invalid argument\n`;
          exitCode = 1;
        }
      }
    }

    return { exitCode, stdout, stderr };
  },
};
