# Contributing

## Setup

```bash
git clone https://github.com/mylocalgpt/shell.git
cd shell
pnpm install
```

## Development

```bash
pnpm build          # build ESM + CJS + types
pnpm test           # unit tests (Vitest)
pnpm test:comparison # comparison tests vs real bash (smokepod)
pnpm test:all       # unit + comparison + lint + typecheck
pnpm lint:fix       # auto-fix lint issues
pnpm typecheck      # type-check without emitting
```

## Testing

**Comparison tests are the primary correctness signal.** They run commands through both real bash and our shell, diffing the output. Prefer adding comparison tests over unit tests for any behavior that bash defines.

Tests live in `tests/comparison/`:

- `tests/comparison/shell/` - shell language features (arithmetic, control flow, pipes, quoting)
- `tests/comparison/commands/` - one file per command
- `tests/comparison/jq/` - jq processor tests

To add a comparison test, create a `.sh` file in the appropriate directory, then record the bash fixture:

```bash
pnpm test:record-fixtures
```

Use unit tests (Vitest, in `tests/`) only for things comparison tests can't cover: internal APIs, error handling, security guardrails, execution limits, filesystem edge cases.

When fixing a bug, add the failing test first, then fix the code.

## Constraints

- **Zero runtime dependencies.** Everything is hand-written.
- **No `node:` imports** in core (`src/`). The package must run in browsers and edge runtimes.
- **No `eval` or `new Function`** code paths.
- **Explicit return types** on all exports (`isolatedDeclarations`).

## Pull Requests

- Keep PRs focused. One logical change per PR.
- All CI checks must pass: typecheck, lint, unit tests, comparison tests, build verification.
- CI runs on Ubuntu, macOS, and Windows across Node 20 and 22.

## Releasing

Releases are published to npm via GitHub Actions when a version tag is pushed.

```bash
npm version patch   # or minor, major
git push && git push --tags
```

`npm version` bumps `package.json`, commits, and creates the tag. The release workflow then runs cross-platform tests, verifies the tag matches `package.json`, and publishes to npm with OIDC provenance.
