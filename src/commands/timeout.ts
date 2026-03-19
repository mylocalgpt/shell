import type { Command, CommandContext, CommandResult } from './types.js';

export const timeout: Command = {
  name: 'timeout',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    if (args.length < 2) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'timeout: missing operand\nUsage: timeout DURATION COMMAND [ARG]...\n',
      };
    }

    const durationStr = args[0];
    const seconds = Number.parseFloat(durationStr);
    if (Number.isNaN(seconds) || seconds < 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `timeout: invalid time interval '${durationStr}'\n`,
      };
    }

    const cmd = args.slice(1).join(' ');

    // Duration of 0 means no timeout
    if (seconds === 0) {
      return ctx.exec(cmd);
    }

    const ms = seconds * 1000;
    const TIMEOUT_RESULT: CommandResult = { exitCode: 124, stdout: '', stderr: '' };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const execPromise = ctx.exec(cmd);
    execPromise.catch(() => {}); // prevent unhandled rejection if timer wins
    const result = await Promise.race([
      execPromise,
      new Promise<CommandResult>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT_RESULT), ms);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);

    return result;
  },
};
