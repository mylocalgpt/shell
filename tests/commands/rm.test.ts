import { describe, expect, it } from 'vitest';
import { rm } from '../../src/commands/rm.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>): CommandContext {
  const fs = new InMemoryFs(files);
  return {
    fs,
    cwd: '/',
    env: new Map(),
    stdin: '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('rm', () => {
  it('removes a file', async () => {
    const ctx = makeCtx({ '/a.txt': 'hello' });
    await rm.execute(['/a.txt'], ctx);
    expect(ctx.fs.exists('/a.txt')).toBe(false);
  });

  it('removes multiple files', async () => {
    const ctx = makeCtx({ '/a.txt': '', '/b.txt': '' });
    await rm.execute(['/a.txt', '/b.txt'], ctx);
    expect(ctx.fs.exists('/a.txt')).toBe(false);
    expect(ctx.fs.exists('/b.txt')).toBe(false);
  });

  it('removes directory with -r', async () => {
    const ctx = makeCtx({ '/dir/a.txt': 'aaa' });
    await rm.execute(['-r', '/dir'], ctx);
    expect(ctx.fs.exists('/dir')).toBe(false);
  });

  it('fails on directory without -r', async () => {
    const ctx = makeCtx({ '/dir/a.txt': 'aaa' });
    const r = await rm.execute(['/dir'], ctx);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Is a directory');
  });

  it('reports missing file without -f', async () => {
    const ctx = makeCtx();
    const r = await rm.execute(['/nope'], ctx);
    expect(r.exitCode).toBe(1);
  });

  it('silences missing file with -f', async () => {
    const ctx = makeCtx();
    const r = await rm.execute(['-f', '/nope'], ctx);
    expect(r.exitCode).toBe(0);
  });

  it('handles -rf combined', async () => {
    const ctx = makeCtx({ '/dir/sub/a.txt': '' });
    const r = await rm.execute(['-rf', '/dir'], ctx);
    expect(r.exitCode).toBe(0);
    expect(ctx.fs.exists('/dir')).toBe(false);
  });

  it('reports missing operand without -f', async () => {
    const ctx = makeCtx();
    const r = await rm.execute([], ctx);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('missing operand');
  });
});
