import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';

describe('yes command', () => {
  it('outputs y lines piped to head', async () => {
    const shell = new Shell();
    const result = await shell.exec('yes | head -3');
    expect(result.stdout).toBe('y\ny\ny\n');
    expect(result.exitCode).toBe(0);
  });

  it('outputs custom string piped to head', async () => {
    const shell = new Shell();
    const result = await shell.exec('yes hello | head -2');
    expect(result.stdout).toBe('hello\nhello\n');
  });

  it('output length is capped at configured limit', async () => {
    const shell = new Shell({ limits: { maxOutputSize: 100 } });
    const result = await shell.exec('yes');
    // Output should be around the limit, not unbounded
    expect(result.stdout.length).toBeLessThan(500);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});
