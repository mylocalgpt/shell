import type { Command, CommandContext, CommandResult } from './types.js';

export const whoami: Command = {
  name: 'whoami',
  async execute(_args: string[], ctx: CommandContext): Promise<CommandResult> {
    const user = ctx.env.get('USER') ?? 'root';
    return { exitCode: 0, stdout: `${user}\n`, stderr: '' };
  },
};
