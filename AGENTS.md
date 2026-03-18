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
- **Comparison:** smokepod v1 (`peteretelej/smokepod@v1`) - record bash 5.x fixtures, verify via JSONL adapter
- **CI:** macOS + Linux + Windows

