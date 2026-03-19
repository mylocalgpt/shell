# Security

Primary threat: untrusted AI agent scripts causing resource exhaustion or ReDoS. Defense is architectural - no eval, no node: imports, Map-based state, configurable limits.

## Threat Model

- **Actors:** AI agents generating bash scripts, potentially adversarial or buggy
- **Goals:** Prevent infinite loops, memory exhaustion, ReDoS, prototype pollution, path traversal
- **Non-goals:** Sandboxing OS access (there is none), network isolation, multi-tenancy

## Execution Limits

Defined in `src/security/limits.ts` (35 lines). All configurable via `ShellOptions.limits`.

| Limit | Default | Prevents |
|-------|---------|----------|
| maxLoopIterations | 10,000 | Infinite loops (for, while, until) |
| maxCallDepth | 100 | Stack overflow from recursive functions |
| maxCommandCount | 10,000 | Runaway scripts executing endless commands |
| maxStringLength | 10,000,000 | Memory exhaustion from string concatenation |
| maxArraySize | 100,000 | Memory exhaustion from array growth |
| maxOutputSize | 10,000,000 | Unbounded stdout/stderr accumulation |
| maxPipelineDepth | 100 | Deeply nested pipeline structures |

Limits are checked at execution points (loop iteration, function call, command dispatch). Exceeding a limit throws a descriptive error, not a silent truncation.

## Regex Guardrails

Defined in `src/security/regex.ts` (~240 lines). Used by grep, sed, awk, expr, find, jq, and any command accepting regex patterns.

**Input caps:**
- `MAX_PATTERN_LENGTH`: 1,000 characters
- `MAX_SUBJECT_LENGTH`: 100,000 characters

**Pattern analysis (before execution):**
- **Nested quantifier detection:** parses pattern structure, identifies `(a+)+`, `(a*)*`, `(.+)+` and similar ReDoS patterns
- **Backreference in quantified group:** finds groups followed by quantifiers containing `\1`-`\9`, which cause exponential backtracking

**Public API:**
- `checkRegexSafety(pattern)` - returns null if safe, error message if unsafe
- `checkSubjectLength(subject)` - validates subject length

All detection is hand-written (no dependencies). Properly handles escaped characters and character class internals.

## Architectural Constraints

| Constraint | Rationale |
|------------|-----------|
| No `eval`/`Function` | Eliminates code injection vectors entirely |
| `Map<string, string>` for env vars | No `__proto__` or `constructor` pollution |
| No `node:` imports in core | Pure ECMAScript, no ambient authority |
| No spread on user data | Prevents stack overflow at ~0.5MB arrays |
| Path normalization | `..` resolved in-memory, cannot escape virtual root |
| chmod is informational only | No real permission enforcement in virtual FS |

## jq Limits

Separate `JqLimits` type in `src/jq/evaluator.ts` with higher defaults (jq operations are typically more intensive):

| Limit | jq Default | Shell Default |
|-------|-----------|---------------|
| maxLoopIterations | 100,000 | 10,000 |
| maxCallDepth | 200 | 100 |
| maxStringLength | 1,000,000 | 10,000,000 |
| maxArraySize | 100,000 | 100,000 |
| maxOutputSize | 10,000,000 | 10,000,000 |

## Network Allowlist

The curl command delegates all HTTP requests to a consumer-provided handler. An optional `allowlist` on `ShellOptions.network` restricts which hostnames curl can reach:
- Hostnames are extracted from URLs without the URL constructor (for runtime portability)
- Patterns use the project's glob matcher (e.g. `*.example.com`)
- Rejected requests return exit code 7

## OverlayFs Security

- Host writes are architecturally impossible (no writeFileSync calls in overlay)
- `realpath` rejects paths that resolve outside the root directory via symlink
- `allowPaths`/`denyPaths` options filter which host paths are readable

See also: [THREAT_MODEL.md](../../THREAT_MODEL.md) for the full security model.

## Gotchas

- **Regex guardrails are heuristic.** They catch common ReDoS patterns but cannot detect all possible exponential-time regexes. The input caps provide a hard backstop.
- **Limits are per-exec, not global.** Each `Shell.exec()` call gets fresh counters. A script can call exec() repeatedly to bypass maxCommandCount.
- **chmod stores mode but doesn't enforce it.** `chmod 000 file` sets the mode bits but `cat file` still works. This is intentional - permission enforcement adds complexity without security value in a virtual FS.
