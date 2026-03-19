import { describe, expect, it } from 'vitest';
import { strings } from '../../src/commands/strings.js';
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

describe('strings', () => {
  it('extracts printable strings of min length 4', async () => {
    const r = await strings.execute([], makeCtx('hello\x00wo\x00world!\x00ab\n'));
    expect(r.stdout).toContain('hello');
    expect(r.stdout).toContain('world!');
    expect(r.stdout).not.toContain('wo\n');
    expect(r.stdout).not.toContain('ab\n');
  });
  it('supports custom min length', async () => {
    const r = await strings.execute(['-n', '2'], makeCtx('ab\x00c\x00def\n'));
    expect(r.stdout).toContain('ab');
    expect(r.stdout).toContain('def');
  });
});
