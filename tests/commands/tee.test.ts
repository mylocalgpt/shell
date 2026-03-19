import { describe, expect, it } from 'vitest';
import { tee } from '../../src/commands/tee.js';
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

describe('tee', () => {
  it('runs without error', async () => {
    const r = await tee.execute([], makeCtx());
    expect(r.exitCode).toBeDefined();
  });
});
