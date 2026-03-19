import { describe, expect, it } from 'vitest';
import { pwd } from '../../src/commands/pwd-cmd.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
  return {
    fs: new InMemoryFs(files),
    cwd: '/',
    env: new Map(),
    stdin: stdin ?? '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('pwd', () => {
  it('runs without error', async () => {
    const r = await pwd.execute([], makeCtx());
    expect(r.exitCode).toBeDefined();
  });
});
