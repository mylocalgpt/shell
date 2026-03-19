# Commands

One file per command, lazy-loaded on first use. 65 registered default commands + 27 shell builtins.

## Files

| File | Role |
|------|------|
| `src/commands/types.ts` | Core types: Command, CommandContext, CommandResult, LazyCommandDef |
| `src/commands/registry.ts` | Dual-track registry with lazy loading and caching |
| `src/commands/defaults.ts` | 65 default command registrations |
| `src/commands/<name>.ts` | One implementation file per command |

## Key Types

```
CommandResult { stdout: string, stderr: string, exitCode: number }

CommandContext {
  fs: FileSystem         // virtual filesystem
  cwd: string            // current working directory
  env: Map<string,string> // environment variables (Map, not object)
  stdin: string          // piped input
  exec: (cmd) => Promise<CommandResult>  // run subcommands
}

Command { name: string, execute(args, ctx): Promise<CommandResult> }

LazyCommandDef { name: string, load: () => Promise<Command> }
```

## Registry

Dual-track architecture in `src/commands/registry.ts`:

1. **definitions** `Map<string, LazyCommandDef>` - lazy command definitions, not yet loaded
2. **cache** `Map<string, Command>` - loaded command instances

**Resolution chain for `get(name)`:**
1. Check cache (already loaded) - O(1)
2. Check definitions, call `load()`, cache result
3. Try `onUnknownCommand` callback (fallback)

## Adding a Command

1. Create `src/commands/<name>.ts` exporting a `Command` object
2. Add registration in `src/commands/defaults.ts`:
   ```typescript
   registry.register({
     name: '<name>',
     load: () => import('./<name>.js').then((m) => m.<name>),
   });
   ```
3. Follow existing patterns (see below)

## Common Patterns

**Path resolution:**
```typescript
const resolved = resolvePath(path, ctx.cwd);
const content = ctx.fs.readFile(resolved);
```
Each command defines its own `resolvePath()` helper (resolves relative to cwd, normalizes `.` and `..`).

**Regex safety (for commands accepting patterns):**
```typescript
import { checkRegexSafety, checkSubjectLength } from '../security/regex';
const err = checkRegexSafety(pattern);
if (err) return { stdout: '', stderr: `grep: ${err}\n`, exitCode: 2 };
```

**Stdin handling:**
```typescript
if (files.length === 0) {
  content = ctx.stdin;  // read from pipe
} else {
  for (const file of files) {
    if (file === '-') content += ctx.stdin;
    else content += await ctx.fs.readFile(resolvePath(file, ctx.cwd));
  }
}
```

**Subcommand execution (xargs, find -exec, etc.):**
```typescript
const result = await ctx.exec(`echo ${arg}`);
```

## Custom Commands

Three integration points for external code:

**1. Constructor option:**
```typescript
const shell = new Shell({
  commands: {
    'my-tool': async (args, ctx) => ({ stdout: 'ok\n', stderr: '', exitCode: 0 }),
  },
});
```

**2. Runtime registration:**
```typescript
shell.defineCommand('my-tool', async (args, ctx) => ({ ... }));
```

**3. Unknown command fallback:**
```typescript
const shell = new Shell({
  onUnknownCommand: (name, args, ctx) => {
    if (name === 'custom') return { stdout: '', stderr: '', exitCode: 0 };
    return undefined; // not handled
  },
});
```

Custom commands participate fully in pipes, redirections, and all shell features.

## Default Commands (65)

awk, base64, basename, cat, chmod, column, comm, cp, curl, cut, date, diff, dirname, du, echo, env, expand, expr, file, find, fold, grep, head, hostname, join, jq, ln, ls, md5sum, mkdir, mv, nl, od, paste, printenv, printf, pwd, readlink, realpath, rev, rm, rmdir, sed, seq, sha1sum, sha256sum, sleep, sort, stat, strings, tac, tail, tee, timeout, touch, tr, tree, unexpand, uniq, wc, which, whoami, xargs, xxd, yes

## Commands with Non-obvious Behavior

| Command | Behavior |
|---------|----------|
| `curl` | Delegates to `ShellOptions.network.handler` callback; core stays network-free. Flags: `-X`, `-H`, `-d`, `-o`, `-O`, `-s`, `-L`, `-f`, `-w`. Hostname allowlist via glob. Exit 7 on rejection |
| `timeout` | `Promise.race` between `ctx.exec()` and `setTimeout`. Exit 124 on expiry. Duration 0 means no timeout. Virtual `sleep` returns instantly, so `timeout 5 sleep 100` completes immediately rather than timing out |
| `yes` | Output capped by `SHELL_MAX_OUTPUT` env var (default 10MB) to prevent unbounded string growth |
| `xxd` | Basic hex dump only (no `-r` reverse). `-l` limit, `-s` offset |

## Gotchas

- **Commands receive stdin as a string, not a stream.** Large inputs are fully buffered in memory.
- **`env` is a Map, not an object.** Use `ctx.env.get('KEY')`, not `ctx.env.KEY` or `ctx.env['KEY']`.
- **`readFile` returns `string | Promise<string>`.** Always await the result - lazy files may return a Promise.
- **`exec()` runs in the parent shell context.** Side effects (variable changes, redirections to files) are visible to the caller.
