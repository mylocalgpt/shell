import { globMatch } from '../utils/glob.js';
import type { Command, CommandContext, CommandResult, NetworkResponse } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

/** Extract hostname from a URL without URL constructor. */
function extractHostname(url: string): string {
  // 1. Strip scheme
  const schemeIdx = url.indexOf('://');
  const remainder = schemeIdx >= 0 ? url.slice(schemeIdx + 3) : url;
  // 2. Strip path
  const slashIdx = remainder.indexOf('/');
  const authority = slashIdx >= 0 ? remainder.slice(0, slashIdx) : remainder;
  // 3. Strip user:pass@
  const atIdx = authority.lastIndexOf('@');
  const hostPort = atIdx >= 0 ? authority.slice(atIdx + 1) : authority;
  // 4. Strip :port
  const colonIdx = hostPort.lastIndexOf(':');
  return colonIdx >= 0 ? hostPort.slice(0, colonIdx) : hostPort;
}

/** Extract filename from URL path's last segment. */
function extractFilename(url: string): string {
  const schemeIdx = url.indexOf('://');
  const remainder = schemeIdx >= 0 ? url.slice(schemeIdx + 3) : url;
  const slashIdx = remainder.indexOf('/');
  const path = slashIdx >= 0 ? remainder.slice(slashIdx) : '/';
  const queryIdx = path.indexOf('?');
  const cleanPath = queryIdx >= 0 ? path.slice(0, queryIdx) : path;
  const lastSlash = cleanPath.lastIndexOf('/');
  const filename = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
  return filename || 'index.html';
}

export const curl: Command = {
  name: 'curl',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let method = '';
    const headers: Record<string, string> = {};
    let body: string | undefined;
    let dataRaw = false;
    let outputFile = '';
    let outputFromUrl = false;
    let silent = false;
    let followRedirects = false;
    let failSilently = false;
    let writeOutFormat = '';
    let url = '';

    // Parse flags
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--data-raw' && i + 1 < args.length) {
        body = args[++i];
        dataRaw = true;
      } else if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
        // Handle combined short flags like -sL, -fsSL, etc.
        // Flags that take a next argument: X, H, d, o, w
        for (let j = 1; j < arg.length; j++) {
          const ch = arg[j];
          // Flags that consume the rest of the arg or next arg
          if (ch === 'X') {
            method = j + 1 < arg.length ? arg.slice(j + 1) : i + 1 < args.length ? args[++i] : '';
            break;
          }
          if (ch === 'H') {
            const hdr =
              j + 1 < arg.length ? arg.slice(j + 1) : i + 1 < args.length ? args[++i] : '';
            const colonIdx = hdr.indexOf(':');
            if (colonIdx >= 0) {
              headers[hdr.slice(0, colonIdx).trim()] = hdr.slice(colonIdx + 1).trim();
            }
            break;
          }
          if (ch === 'd') {
            body = j + 1 < arg.length ? arg.slice(j + 1) : i + 1 < args.length ? args[++i] : '';
            dataRaw = false;
            break;
          }
          if (ch === 'o') {
            outputFile =
              j + 1 < arg.length ? arg.slice(j + 1) : i + 1 < args.length ? args[++i] : '';
            break;
          }
          if (ch === 'w') {
            writeOutFormat =
              j + 1 < arg.length ? arg.slice(j + 1) : i + 1 < args.length ? args[++i] : '';
            break;
          }
          // Boolean flags
          if (ch === 'O') outputFromUrl = true;
          else if (ch === 's') silent = true;
          else if (ch === 'L') followRedirects = true;
          else if (ch === 'f') failSilently = true;
          // 'S' is no-op (show errors even when silent)
        }
      } else if (!arg.startsWith('-')) {
        url = arg;
      }
    }

    if (!url) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: 'curl: no URL specified\n',
      };
    }

    // Check network handler
    if (!ctx.network) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          'curl: network access not configured. Pass a network handler via ShellOptions.network to enable curl.\n',
      };
    }

    // Check allowlist
    if (ctx.network.allowlist) {
      const hostname = extractHostname(url);
      let allowed = false;
      for (let i = 0; i < ctx.network.allowlist.length; i++) {
        if (globMatch(ctx.network.allowlist[i], hostname, true)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return {
          exitCode: 7,
          stdout: '',
          stderr: `curl: (7) Failed to connect to ${extractHostname(url)}: host not in allowlist\n`,
        };
      }
    }

    // Handle -d auto-POST
    if (body !== undefined && !method) {
      method = 'POST';
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    if (!method) method = 'GET';

    // Handle -d @file (read body from filesystem)
    if (body?.startsWith('@') && !dataRaw) {
      const filePath = resolvePath(body.slice(1), ctx.cwd);
      try {
        const data = ctx.fs.readFile(filePath);
        body = typeof data === 'string' ? data : await data;
      } catch {
        return {
          exitCode: 1,
          stdout: '',
          stderr: `curl: can't read data from file '${body.slice(1)}': No such file or directory\n`,
        };
      }
    }

    // Execute request with redirect following
    let response: NetworkResponse;
    let finalUrl = url;
    const maxRedirects = 10;
    let redirectCount = 0;
    let currentMethod = method;
    let currentBody = body;

    try {
      response = await ctx.network.handler(finalUrl, {
        method: currentMethod,
        headers,
        body: currentBody,
      });

      // Follow redirects
      if (followRedirects) {
        while (
          redirectCount < maxRedirects &&
          (response.status === 301 ||
            response.status === 302 ||
            response.status === 303 ||
            response.status === 307 ||
            response.status === 308)
        ) {
          // Find location header (case-insensitive)
          let location = '';
          const responseHeaders = Object.keys(response.headers);
          for (let i = 0; i < responseHeaders.length; i++) {
            if (responseHeaders[i].toLowerCase() === 'location') {
              location = response.headers[responseHeaders[i]];
              break;
            }
          }
          if (!location) break;

          // 303 changes method to GET
          if (response.status === 303) {
            currentMethod = 'GET';
            currentBody = undefined;
          }

          finalUrl = location;
          redirectCount++;
          response = await ctx.network.handler(finalUrl, {
            method: currentMethod,
            headers,
            body: currentBody,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        exitCode: 1,
        stdout: '',
        stderr: `curl: (6) Could not resolve host: ${msg}\n`,
      };
    }

    // Handle -f (fail silently on HTTP errors)
    if (failSilently && response.status >= 400) {
      return {
        exitCode: 22,
        stdout: '',
        stderr: silent ? '' : `curl: (22) The requested URL returned error: ${response.status}\n`,
      };
    }

    let stdout = response.body;

    // Handle -o file
    if (outputFile) {
      const path = resolvePath(outputFile, ctx.cwd);
      ctx.fs.writeFile(path, response.body);
      stdout = '';
    }

    // Handle -O (derive filename from URL)
    if (outputFromUrl) {
      const filename = extractFilename(url);
      const path = resolvePath(filename, ctx.cwd);
      ctx.fs.writeFile(path, response.body);
      stdout = '';
    }

    // Handle -w format
    if (writeOutFormat) {
      let writeOut = writeOutFormat;
      writeOut = writeOut.split('%{http_code}').join(String(response.status));
      writeOut = writeOut.split('%{url}').join(finalUrl);
      stdout += writeOut;
    }

    return { exitCode: 0, stdout, stderr: '' };
  },
};
