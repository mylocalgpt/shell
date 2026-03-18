# Interpreter

Sequential execution engine. Parses input, expands words, resolves commands, pipes stdout strings between pipeline stages.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/interpreter/interpreter.ts` | 1,350 | Core execution, pipes, subshells, control flow |
| `src/interpreter/expansion.ts` | 1,507 | Word expansion (7 phases) |
| `src/interpreter/builtins.ts` | 944 | 27 shell builtins |

## Execution Flow

```
Shell.exec(input)
  → parse(input) → AST
  → Interpreter.execute(AST)
    → executeProgram() → executeList() → executePipeline() → executeCommand()
  → CommandResult { stdout, stderr, exitCode }
```

`Shell.exec()` catches all errors and returns a result. Never throws.

## Pipes

**Sequential string piping.** Each command runs to completion, its stdout string becomes the next command's stdin.

```
cmd1 | cmd2 | cmd3
  1. run cmd1, capture stdout
  2. run cmd2 with stdin=cmd1.stdout, capture stdout
  3. run cmd3 with stdin=cmd2.stdout
```

- **PIPESTATUS:** array of all exit codes, stored as `$PIPESTATUS`
- **pipefail:** when enabled, pipeline exit code is the rightmost non-zero exit code
- **Not parallel.** Commands execute sequentially, not concurrently. No streaming.

## Word Expansion

7 phases in strict order (defined in `src/interpreter/expansion.ts`):

| Phase | Operation | Suppressed by |
|-------|-----------|---------------|
| 1 | Brace expansion (`{a,b}`, `{1..5}`) | Quoting |
| 2 | Tilde expansion (`~`, `~user`) | Quoting |
| 3 | Parameter expansion (`$var`, `${var:-default}`) | Single quotes |
| 4 | Command substitution (`$(cmd)`, `` `cmd` ``) | Single quotes |
| 5 | Arithmetic expansion (`$((expr))`) | Single quotes |
| 6 | Word splitting (on IFS) | Double quotes, assignment context |
| 7 | Glob expansion (`*.txt`) | Quoting, `set -f` (noglob) |

Single-quoted strings skip all expansion. Double-quoted strings allow phases 3-5 but suppress 6-7.

## Variable Scope

- **Global env:** `Map<string, string>` - prevents prototype pollution
- **Local scope stack:** pushed on function entry, popped on exit
- **Export tracking:** separate set of exported variable names
- **Readonly tracking:** separate set, assignment to readonly throws error
- **Special vars:** `$?`, `$!`, `$$`, `$#`, `$0`-`$9`, `$@`, `$*`, `$RANDOM`, `$LINENO`, `$PIPESTATUS`

## Control Flow

Exception-based signals (extend Error, cross async boundaries):

| Signal | Data | Thrown by | Caught by |
|--------|------|-----------|-----------|
| BreakSignal | `levels: number` | `break [n]` | Loop constructs (for, while, until) |
| ContinueSignal | `levels: number` | `continue [n]` | Loop constructs |
| ReturnSignal | `exitCode: number` | `return [n]` | Function call handler |
| ExitSignal | `exitCode: number` | `exit [n]` | Subshell handler, top-level |

Multi-level break/continue: signal carries a level count, decremented at each enclosing loop. Re-thrown if levels remain.

**errexit (`set -e`):**
- Checked after each command: if exit code != 0 and `conditionalDepth === 0`, throws ErrexitError
- `conditionalDepth` incremented inside `if` conditions, `&&`/`||` chains, negated pipelines, `while`/`until` conditions
- This prevents `set -e` from triggering inside conditional contexts (matching bash behavior)

## Builtins

27 builtins in `BUILTIN_NAMES` set, dispatched via switch in `executeBuiltin()`:

```
:  cd  export  unset  readonly  read  source  .  local  set
declare  typeset  eval  shift  test  [  true  false  return
break  continue  exit  type  command  builtin  trap  getopts
```

- `source` and `.` share implementation
- `declare` and `typeset` share implementation
- `test` and `[` share implementation
- `trap` and `getopts` are stubs (return error)

## Subshells

- **Environment:** cloned `Map` (isolated from parent)
- **Filesystem:** shared (not cloned) - differs from real bash
- **Exit handling:** `ExitSignal` caught at subshell boundary
- **Command substitution:** runs in subshell, captures stdout

## Gotchas

- **Pipe stdin is a string buffer, not a stream.** Large pipe data is held entirely in memory. No backpressure.
- **Subshells share the filesystem.** A write in `$(echo hi > file)` is visible in the parent. Real bash uses separate process address spaces.
- **conditionalDepth is the errexit mechanism.** If you add a new conditional construct, you must increment/decrement conditionalDepth or `set -e` will incorrectly trigger inside it.
- **Expansion order matters.** Brace expansion happens before variable expansion, so `{$a,$b}` braces first, then expands variables in each result. This matches bash.
