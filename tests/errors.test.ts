import { describe, expect, it } from 'vitest';
import { commandError, findSimilarCommands, formatLimitError, shellError } from '../src/errors.js';
import { Shell } from '../src/index.js';

describe('error formatting utilities', () => {
  it('shellError formats with prefix', () => {
    expect(shellError('something broke')).toBe('@mylocalgpt/shell: something broke\n');
  });

  it('shellError includes alternative when provided', () => {
    const result = shellError('feature not supported', 'use X instead');
    expect(result).toBe('@mylocalgpt/shell: feature not supported\nAlternative: use X instead\n');
  });

  it('commandError formats in coreutils style', () => {
    expect(commandError('grep', 'No such file')).toBe('grep: No such file\n');
  });

  it('formatLimitError returns descriptive messages', () => {
    const msg = formatLimitError('maxLoopIterations', 10000);
    expect(msg).toContain('maximum loop iterations');
    expect(msg).toContain('10000');
    expect(msg).toContain('limits.maxLoopIterations');
  });

  it('formatLimitError handles unknown limit names', () => {
    const msg = formatLimitError('unknownLimit', 42);
    expect(msg).toContain('unknownLimit');
  });
});

describe('findSimilarCommands', () => {
  const commands = ['cat', 'grep', 'cut', 'curl', 'cd', 'cp', 'ls', 'echo', 'head', 'tail'];

  it('finds prefix matches', () => {
    const result = findSimilarCommands('ca', commands);
    expect(result).toContain('cat');
  });

  it('finds edit-distance matches', () => {
    const result = findSimilarCommands('grpe', commands);
    expect(result).toContain('grep');
  });

  it('returns empty for unrelated names', () => {
    const result = findSimilarCommands('zzzzzzzzz', commands);
    expect(result).toEqual([]);
  });

  it('limits suggestions to maxSuggestions', () => {
    const result = findSimilarCommands('c', commands, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('error messages through Shell', () => {
  describe('syntax errors', () => {
    it('includes @mylocalgpt/shell prefix', async () => {
      const shell = new Shell();
      const result = await shell.exec('if; then');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('@mylocalgpt/shell:');
    });

    it('includes position info', async () => {
      const shell = new Shell();
      const result = await shell.exec('if; then');
      expect(result.stderr).toMatch(/line \d+|col \d+/);
    });
  });

  describe('command not found', () => {
    it('includes prefix and command name', async () => {
      const shell = new Shell();
      const result = await shell.exec('nonexistent-command');
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain('@mylocalgpt/shell:');
      expect(result.stderr).toContain('nonexistent-command');
      expect(result.stderr).toContain('command not found');
    });

    it('suggests similar commands', async () => {
      const shell = new Shell();
      const result = await shell.exec('grpe');
      expect(result.stderr).toContain('Similar:');
      expect(result.stderr).toContain('grep');
    });
  });

  describe('unsupported features', () => {
    it('here-strings are supported', async () => {
      const shell = new Shell();
      const result = await shell.exec('cat <<< "hello"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
    });

    it('coproc produces helpful error', async () => {
      const shell = new Shell();
      const result = await shell.exec('coproc myproc { echo hello; }');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('coproc');
      expect(result.stderr).toContain('not supported');
    });

    it('select produces helpful error', async () => {
      const shell = new Shell();
      const result = await shell.exec('select opt in a b c; do echo $opt; done');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('select');
      expect(result.stderr).toContain('not supported');
    });

    it('trap produces helpful error', async () => {
      const shell = new Shell();
      const result = await shell.exec('trap exit EXIT');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('not supported');
    });

    it('getopts produces helpful error', async () => {
      const shell = new Shell();
      const result = await shell.exec('getopts "ab:" opt');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('not supported');
    });
  });

  describe('execution limits', () => {
    it('loop limit error is descriptive', async () => {
      const shell = new Shell({ limits: { maxLoopIterations: 5 } });
      const result = await shell.exec('while true; do echo x; done');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum loop iterations');
      expect(result.stderr).toContain('limits.maxLoopIterations');
    });

    it('command count limit error is descriptive', async () => {
      const shell = new Shell({ limits: { maxCommandCount: 3 } });
      const result = await shell.exec('echo 1; echo 2; echo 3; echo 4');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum command count');
      expect(result.stderr).toContain('limits.maxCommandCount');
    });
  });

  describe('no host path leaks', () => {
    it('error messages do not contain absolute OS paths', async () => {
      const shell = new Shell();
      const result = await shell.exec('cat /nonexistent');
      // Should not contain /Users, /home, or C:\ style paths
      expect(result.stderr).not.toMatch(/\/Users\//);
      expect(result.stderr).not.toMatch(/\/home\//);
      expect(result.stderr).not.toMatch(/[A-Z]:\\/);
    });

    it('error messages do not contain stack traces', async () => {
      const shell = new Shell();
      const result = await shell.exec('cat /nonexistent');
      expect(result.stderr).not.toContain('.ts:');
      expect(result.stderr).not.toContain('.js:');
      expect(result.stderr).not.toContain('at ');
    });
  });
});
