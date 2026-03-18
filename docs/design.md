# Architecture

Virtual bash interpreter for AI agents. Hand-written recursive descent parser, sequential string-piped execution, in-memory filesystem. Pure ECMAScript, zero runtime dependencies.

## Subsystem Map

| Subsystem | Purpose | Key files | ~Lines |
|-----------|---------|-----------|--------|
| Parser | Lexer, AST, recursive descent | `src/parser/{ast,lexer,parser}.ts` | 3,200 |
| Interpreter | Execution, pipes, expansion, control flow | `src/interpreter/{interpreter,expansion,builtins}.ts` | 3,800 |
| Filesystem | In-memory virtual FS, lazy files | `src/fs/{types,memory}.ts` | 760 |
| Commands | One-file-per-command, lazy registry | `src/commands/*.ts` (61 registered) | ~8,000 |
| Security | Execution limits, regex guardrails | `src/security/{limits,regex}.ts` | 275 |
| jq | Full jq processor, generator-based | `src/jq/*.ts` | 5,500 |
| Utils | Glob, diff, printf (hand-written) | `src/utils/{glob,diff,printf}.ts` | 1,300 |

## Data Flow

```
input string ─→ parse() ─→ AST ─→ Interpreter.execute() ─→ CommandResult
                                        │
                                        ├─ expand words (7 phases)
                                        ├─ resolve builtins (27) or commands (61)
                                        └─ pipe stdout as string to next command
```

`Shell.exec()` wraps this pipeline. Never throws - returns `{ stdout, stderr, exitCode }`.

## Subsystem Overviews

### Parser
Hand-written recursive descent targeting "the bash that LLMs write" (not full POSIX). Lexer produces 47 token types, parser uses 2-token lookahead with no backtracking. Coproc/select rejected with helpful errors.
→ [design/parser.md](design/parser.md)

### Interpreter
Sequential execution with string-piped pipelines. 7-phase word expansion (brace, tilde, param, cmd sub, arith, split, glob). Exception-based control flow signals cross async boundaries. 27 shell builtins dispatched via switch.
→ [design/interpreter.md](design/interpreter.md)

### Filesystem
Flat `Map<string, FileNode>` keyed by normalized paths. Lazy file content (sync or async loaders, cached on first read). Virtual devices at /dev/{null,stdin,stdout,stderr}. Symlinks with 40-depth resolution limit.
→ [design/filesystem.md](design/filesystem.md)

### Commands
One file per command, lazy-loaded on first use. Dual-track registry (definitions Map + cache Map). 61 default commands, 27 builtins. Custom commands via `ShellOptions.commands` or `defineCommand()`.
→ [design/commands.md](design/commands.md)

### Security
Prevents resource exhaustion and ReDoS from untrusted scripts. 7 execution limits with configurable caps. Regex guardrails detect nested quantifiers and backreferences in quantified groups before executing patterns.
→ [design/security.md](design/security.md)

### jq
Independent module with generator-based evaluator. 31 AST node types, 12-level precedence parser, 80+ builtins. Separate `JqLimits` with higher defaults. Full format string support.
→ [design/jq.md](design/jq.md)

## Key Design Decisions

- **Sequential string-piped execution** - no OS processes, no streams. Each command's stdout string becomes the next command's stdin. Simple, deterministic, portable.
- **Exception signals for control flow** - `BreakSignal`, `ContinueSignal`, `ReturnSignal`, `ExitSignal` extend Error. Cross async boundaries cleanly where return values cannot.
- **Map-based env vars** - `Map<string, string>` prevents prototype pollution. No `__proto__` or `constructor` injection via variable assignment.
- **Flat Map filesystem** - normalized paths as keys, path-prefix for parent-child relationships. No tree traversal, O(1) lookups.
- **No `node:` imports in core** - pure ECMAScript for portability. Node APIs only in test harness and build scripts.
- **Generator-based jq** - `yield*` composes multiple outputs naturally. Matches jq's semantics where filters produce zero or more values.
- **Lazy command loading** - commands imported on first use via dynamic `import()`. Reduces startup cost for scripts that use few commands.
