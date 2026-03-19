import { describe, expect, it } from 'vitest';
import { tac } from '../../src/commands/tac.js';
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

describe('tac', () => {
  it('reverses line order', async () => {
    const r = await tac.execute([], makeCtx({}, 'a\nb\nc\n'));
    expect(r.stdout).toBe('c\nb\na\n');
  });
  it('reads from file', async () => {
    const r = await tac.execute(['/f.txt'], makeCtx({ '/f.txt': '1\n2\n3\n' }));
    expect(r.stdout).toBe('3\n2\n1\n');
  });
});
