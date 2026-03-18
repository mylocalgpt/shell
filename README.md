# @mylocalgpt/shell

Virtual bash interpreter for AI agents. Pure TypeScript, zero runtime dependencies. Runs in browsers, Node.js, Cloudflare Workers, and any JavaScript runtime. Ships with 60+ commands, a full jq implementation, and a 33KB gzipped entry point.

- 33 KB gzipped, zero dependencies, runs anywhere
- 60+ commands including grep, sed, awk, find, xargs, and a full jq implementation
- Pipes, redirections, variables, control flow, functions, arithmetic
- Configurable execution limits, regex guardrails, no eval

## Install

```bash
npm install @mylocalgpt/shell
```

## Quick Start

```typescript
import { Shell } from '@mylocalgpt/shell';

const shell = new Shell({
  files: { '/data.json': '{"name": "alice"}' },
});

const result = await shell.exec('cat /data.json | jq .name');
console.log(result.stdout); // "alice"\n
```

## API Reference

### Shell Constructor

```typescript
const shell = new Shell(options?: ShellOptions);
```

| Option | Type | Description |
|--------|------|-------------|
| `files` | `Record<string, string \| (() => string \| Promise<string>)>` | Initial filesystem contents. Values can be strings or lazy-loaded functions. |
| `env` | `Record<string, string>` | Environment variables. Merged with defaults (HOME, USER, PATH, SHELL). |
| `limits` | `Partial<ExecutionLimits>` | Execution limits. Merged with safe defaults. |
| `commands` | `Record<string, CommandHandler>` | Custom commands to register. |
| `onUnknownCommand` | `(name, args, ctx) => CommandResult` | Handler for unregistered commands. |
| `onOutput` | `(result) => ExecResult` | Post-processing hook for exec results. |
| `hostname` | `string` | Virtual hostname (used by `hostname` command). |
| `username` | `string` | Virtual username (used by `whoami` command). |
| `enabledCommands` | `string[]` | Restrict available commands to this allowlist. |

### shell.exec(command, options?)

Execute a shell command. Never throws; all errors are returned in the result.

```typescript
const result = await shell.exec('echo hello', {
  env: { EXTRA: 'value' },   // per-call env vars
  cwd: '/workspace',          // override working directory
  stdin: 'input data',        // provide stdin
  signal: controller.signal,  // AbortSignal for cancellation
  timeout: 5000,              // timeout in milliseconds
});
```

**ExecResult:**

```typescript
interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

**State persistence:** environment exports, functions, working directory, and filesystem persist across exec() calls. Shell options (set -e, etc.) reset per call.

### shell.defineCommand(name, handler)

Register a custom command that works in pipes and redirections.

```typescript
shell.defineCommand('fetch-url', async (args, ctx) => {
  const response = await fetch(args[0]);
  return { stdout: await response.text(), stderr: '', exitCode: 0 };
});

await shell.exec('fetch-url https://api.example.com | jq .data');
```

### shell.reset()

Clear environment and functions, reset working directory. Filesystem is kept intact.

### Accessors

- `shell.fs` - the virtual FileSystem instance
- `shell.cwd` - current working directory
- `shell.env` - environment variables (Map)

## Supported Bash Features

- Pipes and redirections (`|`, `>`, `>>`, `<`, `2>&1`, `&>`)
- Variables and expansion (`$VAR`, `${VAR:-default}`, `${VAR/pattern/replace}`)
- Control flow (`if/elif/else/fi`, `for/while/until`, `case/esac`)
- Functions with local variables
- Arrays and arithmetic (`$((expr))`)
- Command substitution (`$(cmd)`, `` `cmd` ``)
- Here documents (`<<EOF`)
- Glob expansion (`*`, `?`, `[...]`)
- Brace expansion (`{a,b}`, `{1..10}`)
- `set -euo pipefail`
- Subshells (`(cmd)`)
- Conditional expressions (`[[ ]]`, `[ ]`)

## Commands

| Command | Description |
|---------|-------------|
| `cat` | Concatenate and print files |
| `cp` | Copy files |
| `mv` | Move/rename files |
| `rm` | Remove files |
| `mkdir` | Create directories |
| `rmdir` | Remove empty directories |
| `touch` | Create empty files or update timestamps |
| `chmod` | Change file permissions |
| `ln` | Create symbolic links |
| `stat` | Display file status |
| `file` | Determine file type |
| `grep` | Search file contents (-i, -v, -c, -l, -n, -r, -w, -E) |
| `sed` | Stream editor (s, d, p, i, a, c, y commands; -i, -n, -e) |
| `awk` | Pattern scanning (print, if/else, variables, field splitting) |
| `head` | Output first lines (-n, -c) |
| `tail` | Output last lines (-n, -c, -f) |
| `sort` | Sort lines (-r, -n, -u, -k, -t) |
| `uniq` | Filter duplicate lines (-c, -d, -u) |
| `wc` | Count lines, words, characters (-l, -w, -c, -m) |
| `cut` | Remove sections from lines (-d, -f, -c) |
| `tr` | Translate characters (-d, -s) |
| `rev` | Reverse lines |
| `tac` | Reverse file line order |
| `paste` | Merge lines from files (-d) |
| `fold` | Wrap lines (-w, -s) |
| `comm` | Compare sorted files |
| `join` | Join lines on a common field |
| `nl` | Number lines |
| `expand` | Convert tabs to spaces |
| `unexpand` | Convert spaces to tabs |
| `strings` | Print printable strings |
| `column` | Format into columns (-t, -s) |
| `find` | Search for files (-name, -type, -path, -maxdepth) |
| `xargs` | Build commands from stdin (-I, -n) |
| `diff` | Compare files |
| `base64` | Encode/decode base64 (-d) |
| `md5sum` | Compute MD5 hash |
| `sha1sum` | Compute SHA-1 hash |
| `sha256sum` | Compute SHA-256 hash |
| `expr` | Evaluate expressions |
| `od` | Octal dump |
| `ls` | List directory contents (-l, -a, -R, -1) |
| `pwd` | Print working directory |
| `tree` | Display directory tree |
| `du` | Estimate file space usage |
| `basename` | Strip directory from path |
| `dirname` | Strip filename from path |
| `readlink` | Read symbolic link target |
| `realpath` | Resolve canonical path |
| `echo` | Print arguments (-n, -e) |
| `printf` | Format and print |
| `env` | Display environment |
| `printenv` | Print environment variables |
| `date` | Display date/time |
| `seq` | Print number sequence |
| `hostname` | Print hostname |
| `whoami` | Print current user |
| `which` | Locate a command |
| `tee` | Duplicate stdin to file and stdout |
| `sleep` | Pause execution |
| `jq` | JSON processor (full implementation) |

## jq Support

Full jq implementation built from scratch. Supports identity, field access, array/object indexing, pipe, array/object construction, conditionals, try/catch, reduce, foreach, label/break, string interpolation, user-defined functions, and 80+ builtins including `map`, `select`, `keys`, `values`, `has`, `in`, `contains`, `test`, `match`, `sub`, `gsub`, `split`, `join`, `ascii_downcase`, `ascii_upcase`, `tostring`, `tonumber`, `length`, `type`, `empty`, `error`, `env`, `path`, `getpath`, `setpath`, `delpaths`, `to_entries`, `from_entries`, `with_entries`, `group_by`, `sort_by`, `unique_by`, `min_by`, `max_by`, `flatten`, `range`, `floor`, `ceil`, `round`, `pow`, `log`, `sqrt`, `nan`, `infinite`, `isinfinite`, `isnan`, `isnormal`, `add`, `any`, `all`, `limit`, `first`, `last`, `nth`, `indices`, `inside`, `ltrimstr`, `rtrimstr`, `startswith`, `endswith`, `ascii`, `explode`, `implode`, `tojson`, `fromjson`, `@base64`, `@base64d`, `@uri`, `@csv`, `@tsv`, `@html`, `@json`, `@text`, `now`, `todate`, `fromdate`, `strftime`, `strptime`, `gmtime`, `mktime`, `builtins`, `debug`, `input`, `inputs`, `$ENV`.

Available as a standalone import:

```typescript
import { jq } from '@mylocalgpt/shell/jq';
```

## Execution Limits

All limits are configurable via the `limits` constructor option.

| Limit | Default | Prevents |
|-------|---------|----------|
| `maxLoopIterations` | 10,000 | Infinite loops |
| `maxCallDepth` | 100 | Stack overflow from recursion |
| `maxCommandCount` | 10,000 | Excessive command execution |
| `maxStringLength` | 10,000,000 | Memory exhaustion from string growth |
| `maxArraySize` | 100,000 | Memory exhaustion from array growth |
| `maxOutputSize` | 10,000,000 | Unbounded output accumulation |
| `maxPipelineDepth` | 100 | Deeply nested pipes |

## Custom Commands

```typescript
const shell = new Shell({
  commands: {
    'fetch-data': async (args, ctx) => {
      const url = args[0];
      const response = await fetch(url);
      return { stdout: await response.text(), stderr: '', exitCode: 0 };
    },
  },
});

// Or after construction:
shell.defineCommand('transform', async (args, ctx) => {
  return { stdout: ctx.stdin.toUpperCase(), stderr: '', exitCode: 0 };
});
```

Custom commands receive the full `CommandContext` and participate in pipes, redirections, and all shell features.

## Hooks

### onUnknownCommand

Handle commands not in the registry:

```typescript
const shell = new Shell({
  onUnknownCommand: async (name, args, ctx) => {
    if (name === 'python') {
      return { stdout: '', stderr: `${name}: use jq for data processing\n`, exitCode: 127 };
    }
    return { stdout: '', stderr: `${name}: command not found\n`, exitCode: 127 };
  },
});
```

### onOutput

Post-process all exec results (truncate, redact, log):

```typescript
const shell = new Shell({
  onOutput: (result) => ({
    ...result,
    stdout: result.stdout.slice(0, 30000), // truncate large output
  }),
});
```

## Security Model

**What we do:**

- All user-provided regex goes through pattern complexity checks and input-length caps
- Execution limits prevent infinite loops, deep recursion, and memory exhaustion
- No `eval()` or `new Function()` code paths
- Path traversal prevention via normalized absolute paths
- Environment variables stored in Map (no prototype pollution)
- No `node:` imports; runs in sandboxed environments

**What we don't do:**

- This is not an OS-level sandbox. The shell executes within your JavaScript runtime's security context.
- Custom commands have full access to the JavaScript environment. Use OS-level isolation for untrusted code.

## License

MIT
