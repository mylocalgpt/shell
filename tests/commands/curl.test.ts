import { describe, expect, it } from 'vitest';
import type { NetworkRequest } from '../../src/index.js';
import { Shell } from '../../src/index.js';

const mockHandler = async (_url: string, _opts: NetworkRequest) => ({
  status: 200,
  body: '{"name":"test"}',
  headers: {} as Record<string, string>,
});

function shellWithNetwork(handler = mockHandler, allowlist?: string[]): Shell {
  return new Shell({
    network: { handler, allowlist },
  });
}

describe('curl command', () => {
  it('basic GET returns body', async () => {
    const shell = shellWithNetwork();
    const result = await shell.exec('curl -s http://example.com/api');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"name":"test"}');
  });

  it('POST with -d data', async () => {
    let capturedOpts: NetworkRequest | undefined;
    const shell = shellWithNetwork(async (_url, opts) => {
      capturedOpts = opts;
      return { status: 200, body: 'ok', headers: {} };
    });
    await shell.exec('curl -s -X POST -d \'{"key":"val"}\' http://example.com/api');
    expect(capturedOpts?.method).toBe('POST');
    expect(capturedOpts?.body).toBe('{"key":"val"}');
  });

  it('sends custom headers with -H', async () => {
    let capturedOpts: NetworkRequest | undefined;
    const shell = shellWithNetwork(async (_url, opts) => {
      capturedOpts = opts;
      return { status: 200, body: 'ok', headers: {} };
    });
    await shell.exec('curl -s -H "Authorization: Bearer tok" http://example.com');
    expect(capturedOpts?.headers.Authorization).toBe('Bearer tok');
  });

  it('-d auto-sets POST and content-type', async () => {
    let capturedOpts: NetworkRequest | undefined;
    const shell = shellWithNetwork(async (_url, opts) => {
      capturedOpts = opts;
      return { status: 200, body: 'ok', headers: {} };
    });
    await shell.exec('curl -s -d "key=val" http://example.com');
    expect(capturedOpts?.method).toBe('POST');
    expect(capturedOpts?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('-d @file reads body from filesystem', async () => {
    let capturedBody: string | undefined;
    const shell = new Shell({
      files: { '/data.json': '{"from":"file"}' },
      network: {
        handler: async (_url, opts) => {
          capturedBody = opts.body;
          return { status: 200, body: 'ok', headers: {} };
        },
      },
    });
    await shell.exec('curl -s -d @/data.json http://example.com');
    expect(capturedBody).toBe('{"from":"file"}');
  });

  it('-o file writes to filesystem', async () => {
    const shell = shellWithNetwork();
    const result = await shell.exec('curl -s -o /output.json http://example.com/api');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(shell.fs.readFile('/output.json')).toBe('{"name":"test"}');
  });

  it('-f on 404 exits 22 with empty output', async () => {
    const shell = shellWithNetwork(async () => ({
      status: 404,
      body: 'not found',
      headers: {},
    }));
    const result = await shell.exec('curl -sf http://example.com/missing');
    expect(result.exitCode).toBe(22);
    expect(result.stdout).toBe('');
  });

  it('-L follows redirects', async () => {
    let callCount = 0;
    const shell = shellWithNetwork(async (url) => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 302,
          body: '',
          headers: { Location: 'http://example.com/final' },
        };
      }
      return { status: 200, body: 'final', headers: {} };
    });
    const result = await shell.exec('curl -sL http://example.com/redirect');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('final');
    expect(callCount).toBe(2);
  });

  it("-w '%{http_code}' outputs status code", async () => {
    const shell = shellWithNetwork();
    const result = await shell.exec("curl -s -w '%{http_code}' http://example.com");
    expect(result.stdout).toContain('200');
  });

  it('returns error when network not configured', async () => {
    const shell = new Shell();
    const result = await shell.exec('curl -s http://example.com');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('network access not configured');
  });

  it('rejects hosts not in allowlist', async () => {
    const shell = shellWithNetwork(mockHandler, ['api.allowed.com']);
    const result = await shell.exec('curl -s http://evil.com/data');
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('not in allowlist');
  });

  it('allows hosts matching allowlist pattern', async () => {
    const shell = shellWithNetwork(mockHandler, ['*.example.com']);
    const result = await shell.exec('curl -s http://api.example.com/data');
    expect(result.exitCode).toBe(0);
  });

  it('works in pipes with jq', async () => {
    const shell = shellWithNetwork();
    const result = await shell.exec('curl -s http://example.com/api | jq .name');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"test"\n');
  });
});
