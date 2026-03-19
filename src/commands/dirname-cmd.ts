import type { Command, CommandContext, CommandResult } from './types.js';

export const dirname: Command = {
  name: 'dirname',
  async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
    if (args.length === 0) return { exitCode: 1, stdout: '', stderr: 'dirname: missing operand\n' };
    const path = args[0];
    const idx = path.lastIndexOf('/');
    if (idx <= 0) return { exitCode: 0, stdout: `${idx === 0 ? '/' : '.'}\n`, stderr: '' };
    return { exitCode: 0, stdout: `${path.slice(0, idx)}\n`, stderr: '' };
  },
};
