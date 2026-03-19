import type { Command, CommandContext, CommandResult } from './types.js';

export const printenv: Command = {
  name: 'printenv',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      const keys: string[] = [];
      for (const key of ctx.env.keys()) keys.push(key);
      keys.sort();
      let stdout = '';
      for (let i = 0; i < keys.length; i++) {
        stdout += `${ctx.env.get(keys[i])}\n`;
      }
      return { exitCode: 0, stdout, stderr: '' };
    }

    const val = ctx.env.get(args[0]);
    if (val === undefined) {
      return { exitCode: 1, stdout: '', stderr: '' };
    }
    return { exitCode: 0, stdout: `${val}\n`, stderr: '' };
  },
};
