import { describe, expect, it } from 'vitest';
import { Shell } from '../../src/index.js';

describe('jq command', () => {
  const sh = new Shell();

  async function run(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return sh.exec(cmd);
  }

  describe('basic operations', () => {
    it('identity', async () => {
      const r = await run('printf \'{"a":1}\' | jq .');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toContain('"a"');
    });

    it('field access', async () => {
      const r = await run('printf \'{"name":"alice"}\' | jq .name');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('"alice"');
    });

    it('array index', async () => {
      const r = await run("printf '[10,20,30]' | jq '.[1]'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('20');
    });

    it('nested field access', async () => {
      const r = await run('printf \'{"a":{"b":42}}\' | jq .a.b');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('42');
    });

    it('iteration', async () => {
      const r = await run("printf '[1,2,3]' | jq '.[]'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('1\n2\n3');
    });
  });

  describe('flags', () => {
    it('-r raw output', async () => {
      const r = await run('printf \'{"name":"alice"}\' | jq -r .name');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('alice');
    });

    it('-c compact output', async () => {
      const r = await run('printf \'{"a":1,"b":2}\' | jq -c .');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('{"a":1,"b":2}');
    });

    it('-n null input', async () => {
      const r = await run('jq -n null');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('null');
    });

    it('-S sort keys', async () => {
      const r = await run('printf \'{"b":2,"a":1}\' | jq -Sc .');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('{"a":1,"b":2}');
    });

    it('--arg binds variable', async () => {
      const r = await run("jq -n --arg name alice '$name'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('"alice"');
    });

    it('--argjson binds parsed JSON', async () => {
      const r = await run("jq -n --argjson val 42 '$val'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('42');
    });

    it('-e exits 1 for false', async () => {
      const r = await run('printf false | jq -e .');
      expect(r.exitCode).toBe(1);
    });

    it('-e exits 0 for truthy', async () => {
      const r = await run('printf true | jq -e .');
      expect(r.exitCode).toBe(0);
    });

    it('combined short flags -rc', async () => {
      const r = await run('printf \'{"a":"hello"}\' | jq -rc .a');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('hello');
    });
  });

  describe('error handling', () => {
    it('no filter gives exit 2', async () => {
      const r = await run('printf "{}" | jq');
      expect(r.exitCode).toBe(2);
    });

    it('parse error gives exit 3', async () => {
      const r = await run('printf "{}" | jq "invalid[["');
      expect(r.exitCode).toBe(3);
    });

    it('runtime error gives exit 5', async () => {
      const r = await run('printf "42" | jq ".[]"');
      expect(r.exitCode).toBe(5);
    });
  });

  describe('expressions', () => {
    it('format strings', async () => {
      const r = await run("printf '\"hello\"' | jq -r '@base64'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('aGVsbG8=');
    });

    it('keys', async () => {
      const r = await run('printf \'{"b":2,"a":1}\' | jq -c \'keys\'');
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('["a","b"]');
    });

    it('length', async () => {
      const r = await run("printf '[1,2,3]' | jq 'length'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('3');
    });

    it('add', async () => {
      const r = await run("printf '[1,2,3]' | jq 'add'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('6');
    });

    it('sort', async () => {
      const r = await run("printf '[3,1,2]' | jq -c 'sort'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('[1,2,3]');
    });

    it('reverse', async () => {
      const r = await run("printf '[1,2,3]' | jq -c 'reverse'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('[3,2,1]');
    });

    it('type', async () => {
      const r = await run("printf '42' | jq 'type'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('"number"');
    });

    it('not', async () => {
      const r = await run("printf 'true' | jq 'not'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('false');
    });

    it('unique', async () => {
      const r = await run("printf '[1,2,1,3,2]' | jq -c 'unique'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('[1,2,3]');
    });

    it('empty yields no output', async () => {
      const r = await run("printf 'null' | jq 'empty'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('');
    });

    it('tostring/tonumber', async () => {
      const r = await run("printf '42' | jq -r 'tostring'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('42');
    });

    it('ascii_downcase', async () => {
      const r = await run("printf '\"HELLO\"' | jq -r 'ascii_downcase'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('hello');
    });

    it('null input with literal', async () => {
      const r = await run("jq -n '42'");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe('42');
    });
  });
});
