# Comparison Tests

These tests compare our shell's output against real bash 5.x output using [smokepod](https://github.com/peteretelej/smokepod).

## How it works

1. **Record**: Run `pnpm test:record-fixtures` to execute each test command against real bash and save the output as JSONL fixtures.
2. **Verify**: Run `pnpm test:comparison` to execute the same commands against our shell via the JSONL adapter and compare results against recorded fixtures.

## File format

Test files use the `.test` extension with this format:

```
## test-name
$ command to run
expected stdout line 1
expected stdout line 2

## another-test
$ another command
[exit:0]
```

- `## name` - Section header (test name)
- `$ command` - The shell command to execute
- Lines after `$` - Expected stdout output
- `[exit:N]` - Assert exit code is N
- `(re)` suffix on a line - Match that line as a regex

## Adding tests

1. Add test cases to a `.test` file in this directory
2. Record fixtures: `pnpm test:record-fixtures`
3. Verify: `pnpm test:comparison`
4. Commit both the `.test` file and the recorded fixtures

## Re-recording fixtures

Run `pnpm test:record-fixtures` whenever test cases change. This requires bash 5.x on the system.
