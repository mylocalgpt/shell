import type { Command, CommandContext, CommandResult } from './types.js';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export const xargs: Command = {
  name: 'xargs',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let replaceStr = '';
    let maxArgs = 0;
    let delimiter = '';
    let nullDelim = false;
    const cmdParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-I' && i + 1 < args.length) {
        i++;
        replaceStr = args[i];
        continue;
      }
      if (arg.startsWith('-I') && arg.length > 2) {
        replaceStr = arg.slice(2);
        continue;
      }
      if (arg === '-n' && i + 1 < args.length) {
        i++;
        maxArgs = Number.parseInt(args[i], 10);
        continue;
      }
      if (arg === '-d' && i + 1 < args.length) {
        i++;
        delimiter = args[i];
        continue;
      }
      if (arg === '-0') {
        nullDelim = true;
        continue;
      }
      cmdParts.push(arg);
    }

    const baseCmd = cmdParts.length > 0 ? cmdParts.join(' ') : 'echo';

    // Parse input lines
    let items: string[];
    if (nullDelim) {
      items = ctx.stdin.split('\0').filter((s) => s.length > 0);
    } else if (delimiter) {
      items = ctx.stdin.split(delimiter).filter((s) => s.length > 0);
    } else {
      // Split on whitespace
      items = ctx.stdin.split(/\s+/).filter((s) => s.length > 0);
    }

    let stdout = '';
    let stderr = '';

    if (replaceStr) {
      // Replace mode: one command per item
      for (let i = 0; i < items.length; i++) {
        const quoted = shellQuote(items[i]);
        const cmd = baseCmd.split(replaceStr).join(quoted);
        const result = await ctx.exec(cmd);
        stdout += result.stdout;
        stderr += result.stderr;
      }
    } else if (maxArgs > 0) {
      // Batch mode: N args per command
      for (let i = 0; i < items.length; i += maxArgs) {
        const batch = items.slice(i, i + maxArgs);
        const quotedArgs = batch.map(shellQuote).join(' ');
        const cmd = `${baseCmd} ${quotedArgs}`;
        const result = await ctx.exec(cmd);
        stdout += result.stdout;
        stderr += result.stderr;
      }
    } else {
      // Default: all args in one command
      if (items.length > 0) {
        const quotedArgs = items.map(shellQuote).join(' ');
        const cmd = `${baseCmd} ${quotedArgs}`;
        const result = await ctx.exec(cmd);
        stdout += result.stdout;
        stderr += result.stderr;
      }
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};
