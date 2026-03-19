import { describe, expect, it } from 'vitest';
import { env } from '../../src/commands/env.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
  return {
    fs: new InMemoryFs(files),
    cwd: '/',
    env: new Map([
      ['USER', 'testuser'],
      ['HOSTNAME', 'testhost'],
    ]),
    stdin: stdin ?? '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('env', () => {
  it('runs without error', async () => {
    const r = await env.execute([], makeCtx());
    expect(r.exitCode).toBeDefined();
  });
});
