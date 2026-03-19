import { describe, expect, it } from 'vitest';
import { cut } from '../../src/commands/cut.js';
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

describe('cut', () => {
  it('extracts fields with delimiter', async () => {
    const r = await cut.execute(['-d', ',', '-f', '2'], makeCtx({}, 'a,b,c\nx,y,z\n'));
    expect(r.stdout).toBe('b\ny\n');
  });

  it('extracts multiple fields', async () => {
    const r = await cut.execute(['-d', ',', '-f', '1,3'], makeCtx({}, 'a,b,c\n'));
    expect(r.stdout).toBe('a,c\n');
  });

  it('extracts field range', async () => {
    const r = await cut.execute(['-d', ',', '-f', '2-3'], makeCtx({}, 'a,b,c,d\n'));
    expect(r.stdout).toBe('b,c\n');
  });

  it('extracts characters with -c', async () => {
    const r = await cut.execute(['-c', '1-3'], makeCtx({}, 'hello\n'));
    expect(r.stdout).toBe('hel\n');
  });

  it('supports open-ended range N-', async () => {
    const r = await cut.execute(['-d', ',', '-f', '2-'], makeCtx({}, 'a,b,c,d\n'));
    expect(r.stdout).toBe('b,c,d\n');
  });

  it('supports open-ended range -N', async () => {
    const r = await cut.execute(['-c', '-3'], makeCtx({}, 'hello\n'));
    expect(r.stdout).toBe('hel\n');
  });

  it('uses tab as default delimiter', async () => {
    const r = await cut.execute(['-f', '2'], makeCtx({}, 'a\tb\tc\n'));
    expect(r.stdout).toBe('b\n');
  });

  it('reads from file', async () => {
    const ctx = makeCtx({ '/f.txt': 'a,b,c\n' });
    const r = await cut.execute(['-d', ',', '-f', '1', '/f.txt'], ctx);
    expect(r.stdout).toBe('a\n');
  });

  it('reports missing field spec', async () => {
    const r = await cut.execute([], makeCtx({}, 'hello\n'));
    expect(r.exitCode).toBe(1);
  });
});
