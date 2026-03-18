# Testing with Smokepod

Smokepod is our comparison test runner. It runs commands through real bash and our shell, then diffs the output. We own it (`peteretelej/smokepod`) - change it freely if it doesn't do what we need.

## When to Use What

- **Bash-observable behavior** (output, exit codes, variable expansion) -> comparison test
- **Internal APIs** (registry, filesystem methods, security checks) -> unit test (Vitest)
- **Bug fix** -> add comparison test case first (it will fail), then fix

Comparison tests are the primary correctness signal. Prefer them over unit tests for anything bash defines.

## Commands

```bash
# Record fixtures from real bash
pnpm test:record-fixtures

# Verify our shell matches recorded fixtures
pnpm test:comparison
```

**Adapter:** `scripts/smokepod-adapter.mjs` bridges smokepod and our shell. Reads JSONL commands from stdin, executes each via `Shell.exec()`, outputs JSONL results.

## Test File Format

Test files live in `tests/comparison/*.test`. Plain text format:

```
## section-name
$ echo hello
hello

$ echo $?
0

## another-section
$ cat <<EOF
hello
EOF
hello
```

- `## name` starts a test section
- `$ command` is a command to execute
- Lines after `$` are expected stdout (until next `$`, `##`, or blank line)
- `[exit:CODE]` specifies expected exit code
- `(xfail: reason)` in section name marks known failures

**xfail example:**
```
## declare-integer (xfail: declare -i does not evaluate arithmetic)
$ declare -i num=5+3; echo $num
8
```

## Fixture Files

Recorded fixtures live in `tests/fixtures/*.fixture.json`. Each contains:
- Source test file reference
- Recording metadata (bash version, platform, timestamp)
- Per-section arrays of `{ command, stdout, stderr, exit_code }`

14 test files covering: smoke, arithmetic, variables, control flow, pipes/logic, quoting, text processing, and edge cases for arithmetic, commands, control flow, expansion, jq, redirects, and variables.

## Adding a Test

1. Add test case to appropriate `tests/comparison/*.test` file (or create new one)
2. Run `pnpm test:record-fixtures` to record bash output
3. Run `pnpm test:comparison` to verify our shell matches
4. If it fails, fix the code (or mark `(xfail: reason)` if it's a known limitation)
