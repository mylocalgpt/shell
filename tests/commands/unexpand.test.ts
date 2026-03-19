import { describe, expect, it } from 'vitest';
import type { CommandContext } from '../../src/commands/types.js';
import { unexpand } from '../../src/commands/unexpand.js';
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

describe('unexpand', () => {
  it('converts leading spaces to tabs', async () => {
    const r = await unexpand.execute([], makeCtx('        hello\n'));
    expect(r.stdout).toBe('\thello\n');
  });
  it('uses custom tab stop', async () => {
    const r = await unexpand.execute(['-t', '4'], makeCtx('    hello\n'));
    expect(r.stdout).toBe('\thello\n');
  });
});
