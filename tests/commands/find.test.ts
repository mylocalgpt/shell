import { describe, expect, it } from 'vitest';
import { find } from '../../src/commands/find.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>): CommandContext {
  return {
    fs: new InMemoryFs(files),
    cwd: '/',
    env: new Map(),
    stdin: '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('find', () => {
  it('lists all files in directory', async () => {
    const ctx = makeCtx({ '/dir/a.txt': '', '/dir/b.txt': '' });
    const r = await find.execute(['/dir'], ctx);
    expect(r.stdout).toContain('/dir');
    expect(r.stdout).toContain('/dir/a.txt');
    expect(r.stdout).toContain('/dir/b.txt');
  });

  it('supports -name glob', async () => {
    const ctx = makeCtx({ '/dir/a.txt': '', '/dir/b.md': '' });
    const r = await find.execute(['/dir', '-name', '*.txt'], ctx);
    expect(r.stdout).toContain('a.txt');
    expect(r.stdout).not.toContain('b.md');
  });

  it('supports -type f', async () => {
    const ctx = makeCtx({ '/dir/a.txt': '' });
    const r = await find.execute(['/dir', '-type', 'f'], ctx);
    expect(r.stdout).toContain('a.txt');
    expect(r.stdout).not.toContain('/dir\n');
  });

  it('supports -type d', async () => {
    const ctx = makeCtx({ '/dir/sub/a.txt': '' });
    const r = await find.execute(['/dir', '-type', 'd'], ctx);
    expect(r.stdout).toContain('/dir');
    expect(r.stdout).toContain('sub');
    expect(r.stdout).not.toContain('a.txt');
  });

  it('supports -maxdepth', async () => {
    const ctx = makeCtx({ '/dir/sub/a.txt': '' });
    const r = await find.execute(['/dir', '-maxdepth', '1'], ctx);
    expect(r.stdout).toContain('/dir');
    expect(r.stdout).toContain('sub');
    expect(r.stdout).not.toContain('a.txt');
  });

  it('supports ! (negation)', async () => {
    const ctx = makeCtx({ '/dir/a.txt': '', '/dir/b.md': '' });
    const r = await find.execute(['/dir', '!', '-name', '*.txt', '-type', 'f'], ctx);
    expect(r.stdout).toContain('b.md');
    expect(r.stdout).not.toContain('a.txt');
  });

  it('uses . as default root', async () => {
    const ctx = makeCtx({ '/a.txt': '' });
    ctx.cwd = '/';
    const r = await find.execute(['-name', '*.txt'], ctx);
    expect(r.stdout).toContain('a.txt');
  });

  it('handles nested directories', async () => {
    const ctx = makeCtx({
      '/root/a/b/c/file.txt': '',
      '/root/a/file2.txt': '',
    });
    const r = await find.execute(['/root', '-name', '*.txt'], ctx);
    expect(r.stdout).toContain('file.txt');
    expect(r.stdout).toContain('file2.txt');
  });

  it('reports missing directory', async () => {
    const ctx = makeCtx();
    const r = await find.execute(['/nope'], ctx);
    expect(r.exitCode).toBe(1);
  });
});
