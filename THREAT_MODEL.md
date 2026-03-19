# Security Model

@mylocalgpt/shell is a virtual bash interpreter designed for AI agents. The primary threat is untrusted or buggy agent-generated scripts causing resource exhaustion, ReDoS, or state corruption. Defense is architectural: no eval, no node: imports, Map-based state, and configurable execution limits.

## Protections

### Regex Guardrails

User-provided regex patterns (in grep, sed, awk, expr, find, jq) are analyzed before execution:

- **Nested quantifier detection** - identifies patterns like `(a+)+`, `(a*)*`, `(.+)+` that cause catastrophic backtracking
- **Backreference in quantified group** - catches groups followed by quantifiers containing `\1`-`\9`
- **Input caps** - patterns are limited to 1,000 characters, subjects to 100,000 characters

All detection is hand-written with no dependencies. Properly handles escaped characters and character class internals.

Validated in: `tests/security.test.ts`

### Execution Limits

Seven configurable limits prevent runaway scripts. All are checked at execution points (loop iteration, function call, command dispatch). Exceeding a limit throws a descriptive error, not a silent truncation.

| Limit | Default | Prevents |
|-------|---------|----------|
| maxLoopIterations | 10,000 | Infinite loops (for, while, until) |
| maxCallDepth | 100 | Stack overflow from recursive functions |
| maxCommandCount | 10,000 | Runaway scripts executing endless commands |
| maxStringLength | 10,000,000 | Memory exhaustion from string concatenation |
| maxArraySize | 100,000 | Memory exhaustion from array growth |
| maxOutputSize | 10,000,000 | Unbounded stdout/stderr accumulation |
| maxPipelineDepth | 100 | Deeply nested pipeline structures |

Limits are per-exec call. Each `Shell.exec()` call resets counters.

Validated in: `tests/security.test.ts`

### Map-based Environment Variables

Environment variables are stored in a `Map<string, string>`, not a plain object. This prevents prototype pollution via keys like `__proto__`, `constructor`, or `toString`.

Validated in: `tests/security.test.ts`

### No eval or Function

The codebase contains zero `eval()` or `new Function()` code paths. Shell script execution is done by walking the AST with a recursive descent interpreter. This eliminates code injection vectors entirely.

### Path Normalization

All filesystem paths are normalized to absolute paths with `..` segments resolved in-memory. Scripts cannot escape the virtual filesystem root. The virtual filesystem has no connection to the host filesystem.

### Error Sanitization

Internal errors are caught and returned as `{ stdout, stderr, exitCode }` results. `Shell.exec()` never throws to the caller. Stack traces and internal state are not leaked in error messages.

## Explicit Non-Goals

- **OS-level sandboxing.** The shell executes within your JavaScript runtime's security context. It does not provide process isolation.
- **Network isolation.** Custom commands have full access to the JavaScript environment. Network restrictions are the caller's responsibility.
- **Multi-tenancy.** Each Shell instance is single-tenant. There is no isolation between exec() calls on the same instance.
- **Permission enforcement.** `chmod` stores mode bits but does not enforce them. Read/write access is unrestricted within the virtual filesystem.
- **Comprehensive ReDoS prevention.** Regex guardrails are heuristic. They catch common patterns but cannot detect all possible exponential-time regexes. The input caps provide a hard backstop.

## Recommendation

For running untrusted scripts, combine @mylocalgpt/shell with OS-level isolation (containers, V8 isolates, or similar). The shell's built-in limits protect against accidental resource exhaustion but are not a substitute for a security sandbox.
