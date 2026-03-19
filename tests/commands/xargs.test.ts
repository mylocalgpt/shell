import { describe, expect, it } from 'vitest';
import type { CommandContext, CommandResult } from '../../src/commands/types.js';
import { xargs } from '../../src/commands/xargs.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(stdin: string, execFn?: (cmd: string) => Promise<CommandResult>): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: '/',
    env: new Map(),
    stdin,
    exec:
      execFn ?? (async (cmd: string) => ({ exitCode: 0, stdout: `exec: ${cmd}\n`, stderr: '' })),
  };
}

describe('xargs', () => {
  it('passes stdin as args to command', async () => {
    const r = await xargs.execute(['echo'], makeCtx('a b c'));
    expect(r.stdout).toContain('echo');
    expect(r.stdout).toContain('a');
  });

  it('supports -I replace mode', async () => {
    const cmds: string[] = [];
    const ctx = makeCtx('file1\nfile2\n', async (cmd) => {
      cmds.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await xargs.execute(['-I', '{}', 'echo', '{}'], ctx);
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain('file1');
    expect(cmds[1]).toContain('file2');
  });

  it('supports -n max args', async () => {
    const cmds: string[] = [];
    const ctx = makeCtx('a b c d', async (cmd) => {
      cmds.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await xargs.execute(['-n', '2', 'echo'], ctx);
    expect(cmds).toHaveLength(2);
  });

  it('supports -d delimiter', async () => {
    const r = await xargs.execute(['-d', ',', 'echo'], makeCtx('a,b,c'));
    expect(r.stdout).toContain('a');
  });

  it('supports -0 null delimiter', async () => {
    const r = await xargs.execute(['-0', 'echo'], makeCtx('a\0b\0c'));
    expect(r.stdout).toContain('a');
  });

  it('handles empty input', async () => {
    const cmds: string[] = [];
    const ctx = makeCtx('', async (cmd) => {
      cmds.push(cmd);
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await xargs.execute(['echo'], ctx);
    expect(cmds).toHaveLength(0);
  });
});
