import { describe, expect, it } from 'vitest';
import { echo } from '../../src/commands/echo-cmd.js';
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

describe('echo', () => {
  it('runs without error', async () => {
    const r = await echo.execute([], makeCtx());
    expect(r.exitCode).toBeDefined();
  });
});
