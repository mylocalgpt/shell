import { describe, expect, it } from 'vitest';
import { grep } from '../../src/commands/grep.js';
import type { CommandContext } from '../../src/commands/types.js';
import { InMemoryFs } from '../../src/fs/memory.js';

function makeCtx(files?: Record<string, string>, stdin?: string): CommandContext {
  const fs = new InMemoryFs(files);
  return {
    fs,
    cwd: '/',
    env: new Map(),
    stdin: stdin ?? '',
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

describe('grep', () => {
  it('finds matching lines', async () => {
    const r = await grep.execute(
      ['hello', '/f.txt'],
      makeCtx({ '/f.txt': 'hello world\ngoodbye\nhello again\n' }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hello world\nhello again\n');
  });

  it('returns exit 1 for no match', async () => {
    const r = await grep.execute(['nope', '/f.txt'], makeCtx({ '/f.txt': 'hello\n' }));
    expect(r.exitCode).toBe(1);
  });

  it('supports -i case-insensitive', async () => {
    const r = await grep.execute(['-i', 'HELLO', '/f.txt'], makeCtx({ '/f.txt': 'Hello World\n' }));
    expect(r.stdout).toContain('Hello World');
  });

  it('supports -v invert match', async () => {
    const r = await grep.execute(
      ['-v', 'hello', '/f.txt'],
      makeCtx({ '/f.txt': 'hello\nworld\n' }),
    );
    expect(r.stdout).toBe('world\n');
  });

  it('supports -n line numbers', async () => {
    const r = await grep.execute(['-n', 'b', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\nc\n' }));
    expect(r.stdout).toBe('2:b\n');
  });

  it('supports -c count', async () => {
    const r = await grep.execute(['-c', 'a', '/f.txt'], makeCtx({ '/f.txt': 'a\nb\na\n' }));
    expect(r.stdout.trim()).toBe('2');
  });

  it('supports -l files only', async () => {
    const r = await grep.execute(
      ['-l', 'hello', '/a.txt', '/b.txt'],
      makeCtx({ '/a.txt': 'hello\n', '/b.txt': 'world\n' }),
    );
    expect(r.stdout).toBe('/a.txt\n');
  });

  it('supports -o only matching', async () => {
    const r = await grep.execute(['-o', 'h.l', '/f.txt'], makeCtx({ '/f.txt': 'hello world\n' }));
    expect(r.stdout.trim()).toBe('hel');
  });

  it('supports -w word match', async () => {
    const r = await grep.execute(
      ['-w', 'he', '/f.txt'],
      makeCtx({ '/f.txt': 'he is here\nhello\n' }),
    );
    expect(r.stdout).toBe('he is here\n');
  });

  it('reads from stdin', async () => {
    const r = await grep.execute(['match'], makeCtx({}, 'no\nmatch here\n'));
    expect(r.stdout).toBe('match here\n');
  });

  it('supports regex patterns', async () => {
    const r = await grep.execute(
      ['^start', '/f.txt'],
      makeCtx({ '/f.txt': 'start here\nnot start\n' }),
    );
    expect(r.stdout).toBe('start here\n');
  });

  it('supports recursive search', async () => {
    const ctx = makeCtx({
      '/dir/a.txt': 'hello\n',
      '/dir/sub/b.txt': 'hello world\n',
    });
    const r = await grep.execute(['-r', 'hello', '/dir'], ctx);
    expect(r.stdout).toContain('hello');
    expect(r.exitCode).toBe(0);
  });

  it('supports --include glob', async () => {
    const ctx = makeCtx({
      '/dir/a.txt': 'hello\n',
      '/dir/b.md': 'hello\n',
    });
    // With --include, only .txt files are searched. Use -H to force filename display.
    const r = await grep.execute(['-rH', '--include=*.txt', 'hello', '/dir'], ctx);
    expect(r.stdout).toContain('a.txt');
    expect(r.stdout).not.toContain('b.md');
  });

  it('reports missing file', async () => {
    const r = await grep.execute(['pat', '/nope'], makeCtx());
    expect(r.exitCode).toBe(2);
  });

  it('rejects dangerous regex', async () => {
    const r = await grep.execute(['(a+)+b', '/f.txt'], makeCtx({ '/f.txt': 'test\n' }));
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('nested quantifiers');
  });

  it('shows filenames for multiple files', async () => {
    const ctx = makeCtx({ '/a.txt': 'hi\n', '/b.txt': 'hi\n' });
    const r = await grep.execute(['hi', '/a.txt', '/b.txt'], ctx);
    expect(r.stdout).toContain('/a.txt:');
    expect(r.stdout).toContain('/b.txt:');
  });

  it('supports -h suppress filename', async () => {
    const ctx = makeCtx({ '/a.txt': 'hi\n', '/b.txt': 'hi\n' });
    const r = await grep.execute(['-h', 'hi', '/a.txt', '/b.txt'], ctx);
    expect(r.stdout).toBe('hi\nhi\n');
  });
});
