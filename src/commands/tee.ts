import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const tee: Command = {
  name: 'tee',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let appendMode = false;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-a') {
        appendMode = true;
        continue;
      }
      files.push(args[i]);
    }
    const content = ctx.stdin;
    for (let i = 0; i < files.length; i++) {
      const path = resolvePath(files[i], ctx.cwd);
      if (appendMode) {
        ctx.fs.appendFile(path, content);
      } else {
        ctx.fs.writeFile(path, content);
      }
    }
    return { exitCode: 0, stdout: content, stderr: '' };
  },
};
