import { describe, expect, it } from 'vitest';
import { expand } from '../../src/commands/expand.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(stdin?: string): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: '/',
    env: new Map(),
    stdin: stdin ?? '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('expand', () => {
  it('converts tabs to 8 spaces by default', async () => {
    const r = await expand.execute([], makeCtx('\thello\n'));
    expect(r.stdout).toBe('        hello\n');
  });
  it('uses custom tab stop', async () => {
    const r = await expand.execute(['-t', '4'], makeCtx('\thello\n'));
    expect(r.stdout).toBe('    hello\n');
  });
  it('handles mid-line tabs', async () => {
    const r = await expand.execute(['-t', '4'], makeCtx('ab\tc\n'));
    expect(r.stdout).toBe('ab  c\n');
  });
});
