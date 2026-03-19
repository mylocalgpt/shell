import type { Command, CommandContext, CommandResult } from './types.js';

export const yes: Command = {
  name: 'yes',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    const line = args.length > 0 ? args.join(' ') : 'y';
    const maxOutputStr = ctx.env.get('SHELL_MAX_OUTPUT');
    const maxOutput = maxOutputStr ? Number.parseInt(maxOutputStr, 10) : 10_000_000;
    const lineLen = line.length + 1; // +1 for newline

    const parts: string[] = [];
    let len = 0;
    while (len < maxOutput) {
      parts.push(line);
      len += lineLen;
    }
    return { exitCode: 0, stdout: `${parts.join('\n')}\n`, stderr: '' };
  },
};
