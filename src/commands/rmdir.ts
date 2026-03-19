import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

export const rmdir: Command = {
  name: 'rmdir',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let removeParents = false;
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
            case 'p':
              removeParents = true;
              break;
            default:
              return {
                exitCode: 1,
                stdout: '',
                stderr: `rmdir: invalid option -- '${arg[c]}'\n`,
              };
          }
        }
      } else {
        paths.push(arg);
      }
    }

    if (paths.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'rmdir: missing operand\n' };
    }

    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < paths.length; i++) {
      const resolved = resolvePath(paths[i], ctx.cwd);
      try {
        ctx.fs.rmdir(resolved);
        if (removeParents) {
          let parent = dirname(resolved);
          while (parent !== '/' && parent.length > 0) {
            try {
              ctx.fs.rmdir(parent);
              parent = dirname(parent);
            } catch {
              break;
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ENOTEMPTY')) {
          stderr += `rmdir: failed to remove '${paths[i]}': Directory not empty\n`;
        } else if (msg.includes('ENOENT')) {
          stderr += `rmdir: failed to remove '${paths[i]}': No such file or directory\n`;
        } else {
          stderr += `rmdir: failed to remove '${paths[i]}': ${msg}\n`;
        }
        exitCode = 1;
      }
    }

    return { exitCode, stdout: '', stderr };
  },
};
