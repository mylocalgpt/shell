import { describe, expect, it } from 'vitest';
import { stat } from '../../src/commands/stat.js';
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

describe('stat', () => {
  it('shows file info', async () => {
    const ctx = makeCtx({ '/hello.txt': 'world' });
    const r = await stat.execute(['/hello.txt'], ctx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('hello.txt');
    expect(r.stdout).toContain('regular file');
  });

  it('shows directory info', async () => {
    const ctx = makeCtx();
    ctx.fs.mkdir('/mydir');
    const r = await stat.execute(['/mydir'], ctx);
    expect(r.stdout).toContain('directory');
  });

  it('uses -c format for name', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    const r = await stat.execute(['-c', '%n', '/f.txt'], ctx);
    expect(r.stdout.trim()).toBe('/f.txt');
  });

  it('uses -c format for size', async () => {
    const ctx = makeCtx({ '/f.txt': 'hello' });
    const r = await stat.execute(['-c', '%s', '/f.txt'], ctx);
    expect(r.stdout.trim()).toBe('5');
  });

  it('uses -c format for octal permissions', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    const r = await stat.execute(['-c', '%a', '/f.txt'], ctx);
    expect(r.stdout.trim()).toBe('0644');
  });

  it('uses -c format for human permissions', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    const r = await stat.execute(['-c', '%A', '/f.txt'], ctx);
    expect(r.stdout.trim()).toBe('-rw-r--r--');
  });

  it('uses -c format for file type', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    const r = await stat.execute(['-c', '%F', '/f.txt'], ctx);
    expect(r.stdout.trim()).toBe('regular file');
  });

  it('uses -c format for mtime epoch', async () => {
    const ctx = makeCtx({ '/f.txt': '' });
    const r = await stat.execute(['-c', '%Y', '/f.txt'], ctx);
    const epoch = Number.parseInt(r.stdout.trim(), 10);
    expect(epoch).toBeGreaterThan(0);
  });

  it('reports missing file', async () => {
    const ctx = makeCtx();
    const r = await stat.execute(['/nope'], ctx);
    expect(r.exitCode).toBe(1);
  });

  it('reports missing operand', async () => {
    const ctx = makeCtx();
    const r = await stat.execute([], ctx);
    expect(r.exitCode).toBe(1);
  });

  it('handles multiple files', async () => {
    const ctx = makeCtx({ '/a.txt': '', '/b.txt': '' });
    const r = await stat.execute(['-c', '%n', '/a.txt', '/b.txt'], ctx);
    expect(r.stdout).toContain('/a.txt');
    expect(r.stdout).toContain('/b.txt');
  });
});
