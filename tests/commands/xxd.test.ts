import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';

describe('xxd command', () => {
  it('formats hex dump from stdin', async () => {
    const shell = new Shell();
    const result = await shell.exec('echo -n "abc" | xxd');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('6162 63');
    expect(result.stdout).toContain('abc');
  });

  it('handles empty input', async () => {
    const shell = new Shell();
    const result = await shell.exec('echo -n "" | xxd');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('reads from file', async () => {
    const shell = new Shell({
      files: { '/test.bin': 'Hello' },
    });
    const result = await shell.exec('xxd /test.bin');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('4865 6c6c 6f');
    expect(result.stdout).toContain('Hello');
  });

  it('supports -l length limit', async () => {
    const shell = new Shell();
    const result = await shell.exec('echo -n "Hello, World!" | xxd -l 5');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello');
    expect(result.stdout).not.toContain('World');
  });

  it('supports -s offset', async () => {
    const shell = new Shell();
    const result = await shell.exec('echo -n "Hello, World!" | xxd -s 7');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('World!');
    expect(result.stdout).toContain('00000007');
  });
});
