import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';

describe('timeout command', () => {
  it('runs command within timeout', async () => {
    const shell = new Shell();
    const result = await shell.exec('timeout 10 echo hello');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
  });

  it('returns exit code 124 when timeout expires', async () => {
    // sleep is a no-op in the virtual shell, so use a custom command
    // that takes real async time
    const shell = new Shell({
      commands: {
        'slow-cmd': async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { stdout: 'done\n', stderr: '', exitCode: 0 };
        },
      },
    });
    const result = await shell.exec('timeout 0.01 slow-cmd');
    expect(result.exitCode).toBe(124);
  });

  it('returns usage error on missing args', async () => {
    const shell = new Shell();
    const result = await shell.exec('timeout');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('missing operand');
  });

  it('returns error for invalid duration', async () => {
    const shell = new Shell();
    const result = await shell.exec('timeout abc echo hi');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('invalid time interval');
  });
});
