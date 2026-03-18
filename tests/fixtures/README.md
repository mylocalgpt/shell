# Test Fixtures

Recorded bash 5.x output in JSONL format, used by smokepod for comparison testing.

## What these are

Each fixture file contains the expected output from running test commands against real bash 5.x. The smokepod verify step compares our shell's output against these recorded baselines.

## How they're generated

```bash
pnpm test:record-fixtures
```

This runs each command in `tests/comparison/*.test` against `/bin/bash` and saves the output.

## When to re-record

- After adding new test cases
- After modifying existing test commands
- When upgrading the reference bash version

## Important

These files should be committed to the repo so CI can verify without needing a real bash installation.
