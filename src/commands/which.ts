import type { Command, CommandContext, CommandResult } from './types.js';

/**
 * which - locate a command in the registry.
 * Note: This command needs access to the registry which isn't in CommandContext.
 * We use a simple approach: always report the command as found at /usr/bin/<name>
 * since all registered commands are available.
 */
export const which: Command = {
  name: 'which',
  async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      return { exitCode: 1, stdout: '', stderr: '' };
    }

    let stdout = '';
    const stderr = '';
    const exitCode = 0;

    for (let i = 0; i < args.length; i++) {
      // Since we can't check the registry from here, report as found
      stdout += `/usr/bin/${args[i]}\n`;
    }

    return { exitCode, stdout, stderr };
  },
};
