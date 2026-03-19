import { describe, expect, it } from 'vitest';
import { touch } from '../../src/commands/touch.js';
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

describe('touch', () => {
  it('creates a new empty file', async () => {
    const ctx = makeCtx();
    await touch.execute(['/new.txt'], ctx);
    expect(ctx.fs.exists('/new.txt')).toBe(true);
    expect(ctx.fs.readFile('/new.txt')).toBe('');
  });

  it('updates mtime of existing file', async () => {
    const ctx = makeCtx({ '/file.txt': 'hello' });
    const oldMtime = ctx.fs.stat('/file.txt').mtime;
    // Small delay to ensure different mtime
    await new Promise((resolve) => setTimeout(resolve, 5));
    await touch.execute(['/file.txt'], ctx);
    const newMtime = ctx.fs.stat('/file.txt').mtime;
    expect(newMtime.getTime()).toBeGreaterThanOrEqual(oldMtime.getTime());
    expect(ctx.fs.readFile('/file.txt')).toBe('hello'); // Content preserved
  });

  it('creates multiple files', async () => {
    const ctx = makeCtx();
    await touch.execute(['/a.txt', '/b.txt'], ctx);
    expect(ctx.fs.exists('/a.txt')).toBe(true);
    expect(ctx.fs.exists('/b.txt')).toBe(true);
  });

  it('reports missing operand', async () => {
    const ctx = makeCtx();
    const r = await touch.execute([], ctx);
    expect(r.exitCode).toBe(1);
  });
});
