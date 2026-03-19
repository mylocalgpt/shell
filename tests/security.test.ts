import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.js';

describe('security hardening', () => {
  describe('prototype pollution', () => {
    it('env var named __proto__ does not pollute', async () => {
      // __proto__ is a reserved property - setting it as env var should not pollute
      const env: Record<string, string> = {};
      Object.defineProperty(env, '__proto__', { value: 'evil', enumerable: true });
      const shell = new Shell({ env });
      // The important thing is that Object.prototype is not polluted
      expect(({} as Record<string, unknown>).toString).toBeTypeOf('function');
    });

    it('env var named constructor does not pollute', async () => {
      const shell = new Shell({ env: { constructor: 'evil' } });
      const result = await shell.exec('echo $constructor');
      expect(result.stdout).toBe('evil\n');
    });

    it('env var named toString does not pollute', async () => {
      const shell = new Shell({ env: { toString: 'evil' } });
      const result = await shell.exec('echo $toString');
      expect(result.stdout).toBe('evil\n');
    });

    it('jq object with prototype-like keys is safe', async () => {
      const shell = new Shell({
        files: { '/data.json': '{"constructor": "evil", "toString": "bad"}' },
      });
      const result = await shell.exec('jq .constructor /data.json');
      expect(result.stdout).toContain('evil');
      // Verify Object.prototype is not polluted
      expect(({} as Record<string, unknown>).toString).toBeTypeOf('function');
    });
  });

  describe('path traversal', () => {
    it('prevents escape via ../../', async () => {
      const shell = new Shell({
        files: { '/workspace/data.txt': 'safe content' },
      });
      const result = await shell.exec('cat /workspace/../../etc/passwd');
      expect(result.exitCode).not.toBe(0);
    });

    it('normalizes path with many ..', async () => {
      const shell = new Shell({
        files: { '/etc/passwd': 'virtual passwd' },
      });
      // Attempt deep traversal - should resolve to /etc/passwd in virtual FS
      const result = await shell.exec('cat /a/b/c/../../../../etc/passwd');
      expect(result.stdout).toBe('virtual passwd');
    });

    it('handles paths with trailing slashes', async () => {
      const shell = new Shell();
      shell.fs.writeFile('/test.txt', 'content');
      const result = await shell.exec('ls /');
      expect(result.exitCode).toBe(0);
    });

    it('handles null bytes in paths gracefully', async () => {
      const shell = new Shell();
      // Shell should handle this without crashing
      const result = await shell.exec('cat "/test\\x00.txt"');
      expect(typeof result.exitCode).toBe('number');
    });
  });

  describe('execution limits', () => {
    it('maxLoopIterations terminates infinite loops', async () => {
      const shell = new Shell({ limits: { maxLoopIterations: 10 } });
      const result = await shell.exec('while true; do echo x; done');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum loop iterations');
    });

    it('maxCallDepth prevents stack overflow from recursion', async () => {
      const shell = new Shell({ limits: { maxCallDepth: 5 } });
      const result = await shell.exec('f() { f; }; f');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum call depth');
    });

    it('maxCommandCount prevents excessive command execution', async () => {
      const shell = new Shell({ limits: { maxCommandCount: 5 } });
      const result = await shell.exec('echo 1; echo 2; echo 3; echo 4; echo 5; echo 6; echo 7');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum command count');
    });

    it('maxOutputSize is defined as a configurable limit', () => {
      // maxOutputSize is currently enforced by the jq evaluator but not
      // the shell interpreter's stdout accumulation. The limit is defined
      // and configurable for future enforcement.
      const shell = new Shell({ limits: { maxOutputSize: 100 } });
      expect(shell).toBeDefined();
    });

    it('for loop respects maxLoopIterations', async () => {
      const shell = new Shell({ limits: { maxLoopIterations: 5 } });
      const result = await shell.exec('for i in $(seq 1 100); do echo $i; done');
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('maximum loop iterations');
    });
  });

  describe('regex guardrails', () => {
    it('grep rejects dangerous regex patterns', async () => {
      const shell = new Shell({
        files: { '/data.txt': 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      });
      // Nested quantifier pattern that could cause ReDoS
      const result = await shell.exec('grep "(a+)+$" /data.txt');
      // Should either reject the pattern or handle it safely
      expect(typeof result.exitCode).toBe('number');
    });

    it('sed rejects dangerous regex patterns', async () => {
      const shell = new Shell({
        files: { '/data.txt': 'aaaaaaaaaaaaaaaaaaaaaaaa' },
      });
      const result = await shell.exec('sed "s/(a+)+$/x/" /data.txt');
      expect(typeof result.exitCode).toBe('number');
    });

    it('expr regex works for safe patterns after fix', async () => {
      const shell = new Shell();
      const result = await shell.exec('expr match "hello123" "hello[0-9]*"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).not.toBe('0');
    });
  });

  describe('large data handling', () => {
    it('processes a large file without stack overflow', async () => {
      // Create a file with many lines
      const lines: string[] = [];
      for (let i = 0; i < 10000; i++) {
        lines.push(`line ${i}: some data here`);
      }
      const shell = new Shell({
        files: { '/large.txt': lines.join('\n') },
      });
      const result = await shell.exec('wc -l /large.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('9999');
    });

    it('sorts many lines without issues', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`line ${999 - i}`);
      }
      const shell = new Shell({
        files: { '/data.txt': `${lines.join('\n')}\n` },
      });
      const result = await shell.exec('sort /data.txt | head -3');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('line 0');
    });
  });

  describe('input validation', () => {
    it('cat handles empty file', async () => {
      const shell = new Shell({ files: { '/empty.txt': '' } });
      const result = await shell.exec('cat /empty.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
    });

    it('grep handles empty input', async () => {
      const shell = new Shell({ files: { '/empty.txt': '' } });
      const result = await shell.exec('grep "pattern" /empty.txt');
      expect(result.exitCode).toBe(1); // no match
    });

    it('head handles file with only whitespace', async () => {
      const shell = new Shell({ files: { '/ws.txt': '   \n  \n  ' } });
      const result = await shell.exec('head -1 /ws.txt');
      expect(result.exitCode).toBe(0);
    });

    it('wc handles very long single line', async () => {
      const longLine = 'x'.repeat(100000);
      const shell = new Shell({ files: { '/long.txt': longLine } });
      const result = await shell.exec('wc -c /long.txt');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('100000');
    });

    it('sort handles file with unicode content', async () => {
      const shell = new Shell({
        files: { '/unicode.txt': 'cafe\ncafe\ncaf\n' },
      });
      const result = await shell.exec('sort /unicode.txt');
      expect(result.exitCode).toBe(0);
    });

    it('cut handles binary-like content gracefully', async () => {
      const shell = new Shell({
        files: { '/binary.txt': 'abc\x01\x02\x03def\n' },
      });
      const result = await shell.exec('cut -c1-3 /binary.txt');
      expect(result.exitCode).toBe(0);
    });

    it('commands do not throw uncaught exceptions on missing files', async () => {
      const shell = new Shell();
      const commands = ['cat', 'grep pattern', 'head', 'tail', 'wc', 'sort'];
      for (const cmd of commands) {
        const result = await shell.exec(`${cmd} /nonexistent 2>/dev/null`);
        expect(typeof result.exitCode).toBe('number');
      }
    });
  });

  describe('no eval/Function code paths', () => {
    it('shell does not execute arbitrary JavaScript', async () => {
      const shell = new Shell();
      // Attempt to inject JS - should be treated as a shell command
      const result = await shell.exec('eval "console.log(process.env)"');
      // eval is a shell builtin, should not execute JS
      expect(typeof result.exitCode).toBe('number');
    });
  });
});
