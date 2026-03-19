# @mylocalgpt/shell

Virtual bash interpreter for AI agents. Pure ECMAScript, zero runtime dependencies.

## Constraints

- **Zero runtime dependencies.** Everything hand-written.
- **No `node:` imports** in core. Enforce with lint rule.
- **No `eval`/`Function`** code paths.
- **UTF-8 always.** Never latin1/binary.
- **No spread on user data.** Stack overflows at ~0.5MB. Use loops.
- **Isolated declarations** - explicit return types on all exports.

## Testing

- **Unit:** Vitest
- **Comparison:** smokepod v1 (`peteretelej/smokepod@v1`) - record bash fixtures, verify via JSONL adapter
  - `tests/comparison/shell/` - shell language features (arithmetic, control flow, pipes, quoting, etc.)
  - `tests/comparison/commands/` - one file per command
  - `tests/comparison/jq/` - jq processor tests
- **Validation gate:** `pnpm test:all` runs unit + comparison + lint + typecheck
- **CI:** macOS + Linux + Windows + Bun

## Docs

Design docs for AI agents in `docs/`. Read on-demand, not required.

- [`docs/design.md`](docs/design.md) - Architecture overview, subsystem map, key decisions
- [`docs/design/parser.md`](docs/design/parser.md) - Lexer, AST types, recursive descent parser
- [`docs/design/interpreter.md`](docs/design/interpreter.md) - Execution, pipes, expansion phases, control flow signals
- [`docs/design/commands.md`](docs/design/commands.md) - Registry, adding commands, custom command API
- [`docs/design/filesystem.md`](docs/design/filesystem.md) - InMemoryFs, OverlayFs, lazy files, virtual devices, symlinks
- [`docs/design/security.md`](docs/design/security.md) - Execution limits, regex guardrails, threat model
- [`docs/design/jq.md`](docs/design/jq.md) - Generator evaluator, builtins, format strings
- [`docs/3rd-party/testing-with-smokepod.md`](docs/3rd-party/testing-with-smokepod.md) - Comparison test workflow
- [`THREAT_MODEL.md`](THREAT_MODEL.md) - Security model, protections, threat analysis, non-goals

