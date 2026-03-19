import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

export const touch: Command = {
  name: 'touch',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    const paths: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        for (let j = i + 1; j < args.length; j++) paths.push(args[j]);
        break;
      }
      if (arg.startsWith('-') && arg.length > 1) {
        // touch flags like -a, -m, -t are not commonly used by agents
        // Accept and ignore them for compatibility
        continue;
      }
      paths.push(arg);
    }

    if (paths.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'touch: missing file operand\n' };
    }

    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < paths.length; i++) {
      const resolved = resolvePath(paths[i], ctx.cwd);
      try {
        if (ctx.fs.exists(resolved)) {
          // Update mtime by writing same content
          const content = ctx.fs.readFile(resolved);
          const text = typeof content === 'string' ? content : await content;
          ctx.fs.writeFile(resolved, text);
        } else {
          ctx.fs.writeFile(resolved, '');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stderr += `touch: cannot touch '${paths[i]}': ${msg}\n`;
        exitCode = 1;
      }
    }

    return { exitCode, stdout: '', stderr };
  },
};
