import { describe, expect, it } from 'vitest';
import { chmod } from '../../src/commands/chmod.js';
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

describe('chmod', () => {
  it('sets octal mode', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['755', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode).toBe(0o755);
  });

  it('sets octal mode 644', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['644', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode).toBe(0o644);
  });

  it('adds user execute with u+x', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    // Default file mode is 0o644
    await chmod.execute(['u+x', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode & 0o100).toBe(0o100);
  });

  it('removes write with a-w', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['755', '/f.txt'], ctx);
    await chmod.execute(['a-w', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode & 0o222).toBe(0);
  });

  it('sets exact permissions with =', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['a=r', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode).toBe(0o444);
  });

  it('handles compound symbolic: u+x,g-w', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['755', '/f.txt'], ctx);
    await chmod.execute(['u+x,g-w', '/f.txt'], ctx);
    const mode = ctx.fs.stat('/f.txt').mode;
    expect(mode & 0o100).toBe(0o100); // u has x
    expect(mode & 0o020).toBe(0); // g lost w
  });

  it('handles multiple files', async () => {
    const ctx = makeCtx({ '/a.txt': '', '/b.txt': '' });
    await chmod.execute(['755', '/a.txt', '/b.txt'], ctx);
    expect(ctx.fs.stat('/a.txt').mode).toBe(0o755);
    expect(ctx.fs.stat('/b.txt').mode).toBe(0o755);
  });

  it('reports missing file', async () => {
    const ctx = makeCtx();
    const r = await chmod.execute(['755', '/nope'], ctx);
    expect(r.exitCode).toBe(1);
  });

  it('reports missing operand', async () => {
    const ctx = makeCtx();
    const r = await chmod.execute([], ctx);
    expect(r.exitCode).toBe(1);
  });

  it('group permissions with g+x', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['644', '/f.txt'], ctx);
    await chmod.execute(['g+x', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode & 0o010).toBe(0o010);
  });

  it('other permissions with o+w', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    await chmod.execute(['644', '/f.txt'], ctx);
    await chmod.execute(['o+w', '/f.txt'], ctx);
    expect(ctx.fs.stat('/f.txt').mode & 0o002).toBe(0o002);
  });
});
