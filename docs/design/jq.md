# jq Processor

Independent module implementing a near-complete jq interpreter. Generator-based evaluator, 80+ builtins, format string support.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/jq/evaluator.ts` | 3,146 | Generator-based evaluator, builtins |
| `src/jq/parser.ts` | 801 | Recursive descent, 12-level precedence |
| `src/jq/tokenizer.ts` | 574 | Tokenizer, string interpolation |
| `src/jq/ast.ts` | 331 | 31 AST node types |
| `src/jq/index.ts` | 127 | Public API, options handling |
| `src/jq/errors.ts` | 59 | Error hierarchy |
| `src/jq/builtins/format.ts` | 456 | Format strings (@html, @csv, @tsv, @json, @uri, @base64, @text) |
| **Total** | **~5,500** | |

## Pipeline

```
JSON string ─→ tokenize ─→ parse ─→ evaluate ─→ format output
                68 tokens    31 AST    generator    JSON/raw/compact
                             types     yield*
```

## AST

31 node types, discriminated by `type` field. Key categories:

- **Access:** Identity (`.`), RecursiveDescent (`..`), Field (`.foo`), Index (`.[0]`), Slice (`.[2:5]`), Iterate (`.[]`)
- **Composition:** Pipe (`|`), Comma (`,`), Optional (`?`)
- **Construction:** ArrayConstruction, ObjectConstruction, StringInterpolation
- **Operators:** Arithmetic, Comparison, Logic, Not, Negate, Alternative (`//`), Update, UpdateOp
- **Control flow:** If, TryCatch, Reduce, Foreach, Label, Break
- **Definitions:** FunctionDef, FunctionCall, VariableBinding
- **Literals:** Literal, Variable, Format

## Parser

12-level precedence hierarchy (lowest to highest):

1. Pipe (`|`)
2. Comma (`,`)
3. As binding (`as $var`)
4. Alternative (`//`)
5. Logic (`and`, `or`)
6. Not (`not`)
7. Comparison (`==`, `!=`, `<`, `>`, `<=`, `>=`)
8. Addition (`+`, `-`)
9. Multiplication (`*`, `/`, `%`)
10. Unary negation (`-`)
11. Postfix (`?`, `.field`, `[index]`)
12. Primary (literals, `.`, `if`, `try`, `reduce`, `def`, etc.)

## Evaluator

**Generator-based:** main function is `function* evaluate(node, input, env)`. Uses `yield*` to delegate to sub-generators. Filters naturally produce zero or more values.

**JqEnv** (evaluation context):
- `variables: Map<string, JsonValue>` - variable bindings (`$x`)
- `functions: Map<string, JqFuncDef>` - user-defined functions (keyed by `name/arity`)
- `depth: number` - call depth tracker
- `limits: JqLimits` - execution limits
- `outputSize: number` - cumulative output bytes
- `inputSource?: () => Generator<JsonValue>` - for `input`/`inputs` builtins

**80+ builtins** implemented in `evalBuiltinCall()` switch statement. Key groups:
- **Type/introspection:** `type`, `length`, `keys`, `values`, `has`, `in`, `contains`, `inside`
- **Array/object:** `map`, `select`, `sort_by`, `group_by`, `unique_by`, `flatten`, `transpose`, `to_entries`, `from_entries`
- **String:** `split`, `join`, `test`, `match`, `capture`, `scan`, `sub`, `gsub`, `ascii_downcase`, `ascii_upcase`, `trim`, `ltrimstr`, `rtrimstr`
- **Math:** `floor`, `ceil`, `round`, `sqrt`, `pow`, `log`, `exp`, `fabs`, `nan`, `infinite`
- **Path:** `path`, `getpath`, `setpath`, `delpaths`, `leaf_paths`
- **I/O:** `input`, `inputs`, `debug`, `stderr`, `halt`, `halt_error`
- **Iteration:** `range`, `while`, `until`, `repeat`, `recurse`, `walk`, `limit`, `first`, `last`, `nth`
- **Type filters:** `numbers`, `strings`, `booleans`, `nulls`, `arrays`, `objects`, `iterables`, `scalars`

## Limits

Separate `JqLimits` type with higher defaults than shell (jq operations tend to be more data-intensive):

| Limit | Default |
|-------|---------|
| maxLoopIterations | 100,000 |
| maxCallDepth | 200 |
| maxStringLength | 1,000,000 |
| maxArraySize | 100,000 |
| maxOutputSize | 10,000,000 |

## Error Hierarchy

```
JqError (base)
├── JqParseError      # tokenizer/parser errors → exit 3
├── JqRuntimeError    # evaluation errors → exit 5
├── JqTypeError       # type mismatch → exit 5
└── JqHaltError       # halt/halt_error → custom exit code
```

All carry optional position info (offset, line, column).

## Integration

`src/commands/jq.ts` wraps the `jq()` function as a shell command:
- Parses CLI flags (`-r`, `-R`, `-s`, `-S`, `-c`, `-e`, `-n`, `--arg`, `--argjson`, `--slurpfile`, etc.)
- Maps JqParseError to exit 3, JqHaltError to custom exit code, other errors to exit 5
- Supports `--exit-status` (exit 1 for false/null, exit 4 if empty)

## Gotchas

- **Generator semantics are central.** Every filter is a generator. `empty` yields nothing, `.[]` yields each element, `select(f)` conditionally yields. Don't use arrays to accumulate results - use `yield*`.
- **Function lookup is by name/arity.** `def foo(f): ...` and `def foo(f;g): ...` are different functions. The map key is `"foo/1"` and `"foo/2"`.
- **String interpolation uses token sequences.** `"hello \(expr) world"` tokenizes as StringStart, tokens for expr, StringEnd. The parser reconstructs the interpolation node.
- **Regex uses the same guardrails as the shell.** `checkRegexSafety()` is called for `test`, `match`, `scan`, `sub`, `gsub` patterns.
