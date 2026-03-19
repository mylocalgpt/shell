import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.js';

describe('command hooks', () => {
  describe('onBeforeCommand', () => {
    it('receives correct cmd name and args', async () => {
      const log: Array<{ cmd: string; args: string[] }> = [];
      const shell = new Shell({
        onBeforeCommand: (cmd, args) => {
          log.push({ cmd, args: [...args] });
        },
      });
      await shell.exec('echo hello world');
      expect(log).toHaveLength(1);
      expect(log[0].cmd).toBe('echo');
      expect(log[0].args).toEqual(['hello', 'world']);
    });

    it('blocks command when returning false', async () => {
      const shell = new Shell({
        onBeforeCommand: () => false,
      });
      const result = await shell.exec('echo should not run');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('permission denied');
      expect(result.stdout).toBe('');
    });

    it('blocks command with async false', async () => {
      const shell = new Shell({
        onBeforeCommand: async () => false,
      });
      const result = await shell.exec('echo blocked');
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain('permission denied');
    });

    it('fires for each command in a pipeline', async () => {
      const commands: string[] = [];
      const shell = new Shell({
        onBeforeCommand: (cmd) => {
          commands.push(cmd);
        },
      });
      await shell.exec('echo hello | cat | wc -c');
      expect(commands).toEqual(['echo', 'cat', 'wc']);
    });
  });

  describe('onCommandResult', () => {
    it('can redact stdout content', async () => {
      const shell = new Shell({
        onCommandResult: (cmd, result) => ({
          ...result,
          stdout: result.stdout.replace('secret', 'REDACTED'),
        }),
      });
      const result = await shell.exec('echo secret');
      expect(result.stdout).toBe('REDACTED\n');
    });

    it('fires per command in a pipeline', async () => {
      const commands: string[] = [];
      const shell = new Shell({
        onCommandResult: (cmd, result) => {
          commands.push(cmd);
          return result;
        },
      });
      await shell.exec('echo hello | cat');
      expect(commands).toEqual(['echo', 'cat']);
    });

    it('downstream pipe sees modified output', async () => {
      const shell = new Shell({
        onCommandResult: (cmd, result) => {
          if (cmd === 'echo') {
            return { ...result, stdout: 'replaced\n' };
          }
          return result;
        },
      });
      const result = await shell.exec('echo original | cat');
      expect(result.stdout).toBe('replaced\n');
    });
  });

  describe('no hooks set', () => {
    it('executes normally without hooks', async () => {
      const shell = new Shell();
      const result = await shell.exec('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
    });
  });
});
