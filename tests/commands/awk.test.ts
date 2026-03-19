import { describe, expect, it } from 'vitest';
import { awk } from '../../src/commands/awk.js';
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

describe('awk', () => {
  it('prints all lines', async () => {
    const r = await awk.execute(['{print}'], makeCtx({}, 'a\nb\n'));
    expect(r.stdout).toBe('a\nb\n');
  });

  it('prints specific field', async () => {
    const r = await awk.execute(['{print $2}'], makeCtx({}, 'a b c\nx y z\n'));
    expect(r.stdout).toBe('b\ny\n');
  });

  it('uses -F field separator', async () => {
    const r = await awk.execute(['-F:', '{print $1}'], makeCtx({}, 'a:b:c\n'));
    expect(r.stdout).toBe('a\n');
  });

  it('supports NR', async () => {
    const r = await awk.execute(['{print NR, $0}'], makeCtx({}, 'a\nb\n'));
    expect(r.stdout).toBe('1 a\n2 b\n');
  });

  it('supports NF', async () => {
    const r = await awk.execute(['{print NF}'], makeCtx({}, 'a b c\nx y\n'));
    expect(r.stdout).toBe('3\n2\n');
  });

  it('supports BEGIN block', async () => {
    const r = await awk.execute(['BEGIN{print "header"}{print}'], makeCtx({}, 'data\n'));
    expect(r.stdout).toBe('header\ndata\n');
  });

  it('supports END block', async () => {
    const r = await awk.execute(['{} END{print NR}'], makeCtx({}, 'a\nb\nc\n'));
    expect(r.stdout).toBe('3\n');
  });

  it('supports regex pattern', async () => {
    const r = await awk.execute(['/^b/{print}'], makeCtx({}, 'apple\nbanana\ncherry\n'));
    expect(r.stdout).toBe('banana\n');
  });

  it('supports string concatenation', async () => {
    const r = await awk.execute(['{print $1 "-" $2}'], makeCtx({}, 'a b\n'));
    expect(r.stdout).toBe('a-b\n');
  });

  it('supports arithmetic', async () => {
    const r = await awk.execute(['{print $1+$2}'], makeCtx({}, '3 4\n'));
    expect(r.stdout).toBe('7\n');
  });

  it('supports length function', async () => {
    const r = await awk.execute(['{print length($0)}'], makeCtx({}, 'hello\n'));
    expect(r.stdout).toBe('5\n');
  });

  it('supports substr function', async () => {
    const r = await awk.execute(['{print substr($0,2,3)}'], makeCtx({}, 'hello\n'));
    expect(r.stdout).toBe('ell\n');
  });

  it('supports tolower/toupper', async () => {
    const r = await awk.execute(['{print toupper($0)}'], makeCtx({}, 'hello\n'));
    expect(r.stdout).toBe('HELLO\n');
  });

  it('supports OFS', async () => {
    const r = await awk.execute(['BEGIN{OFS=","}{print $1,$2}'], makeCtx({}, 'a b\n'));
    expect(r.stdout).toBe('a,b\n');
  });

  it('reads from file', async () => {
    const ctx = makeCtx({ '/f.txt': 'hello world\n' });
    const r = await awk.execute(['{print $1}', '/f.txt'], ctx);
    expect(r.stdout).toBe('hello\n');
  });

  it('supports comparison pattern', async () => {
    const r = await awk.execute(['NR==2{print}'], makeCtx({}, 'a\nb\nc\n'));
    expect(r.stdout).toBe('b\n');
  });

  it('supports $NF (last field)', async () => {
    const r = await awk.execute(['{print $NF}'], makeCtx({}, 'a b c\n'));
    expect(r.stdout).toBe('c\n');
  });
});
