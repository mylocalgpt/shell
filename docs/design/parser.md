# Parser

Hand-written recursive descent parser targeting "the bash that LLMs write." Not full POSIX - focuses on the subset AI agents actually generate.

## Files

| File | Lines | Role |
|------|-------|------|
| `src/parser/ast.ts` | 379 | AST node types, type unions |
| `src/parser/lexer.ts` | 972 | Tokenizer, heredoc collection |
| `src/parser/parser.ts` | 1,855 | Recursive descent parser |

## AST Structure

**Hierarchy:** `Program > List > ListEntry > Pipeline > CommandNode`

**Word types** (9 in `WordPart` union + `ConcatWord`):
- LiteralWord, QuotedWord, VariableWord, CommandSubstitution
- ArithmeticExpansion, GlobWord, BraceExpansion, TildeWord, ArraySubscript
- ConcatWord wraps multiple WordParts into a single compound word

**Command types** (12 in `CommandNode` union):
- SimpleCommand, FunctionDefinition
- Subshell, BraceGroup
- IfStatement, ForStatement, ForCStatement, WhileStatement, UntilStatement
- CaseStatement, ConditionalExpression, ArithmeticCommand

**Conditional expression types** (6 in `ConditionalExpr` union, for `[[ ]]`):
- UnaryTest, BinaryTest, NotExpr, AndExpr, OrExpr, ParenExpr

## Lexer

- **47 token types** including 17 reserved words
- **Context-sensitive reserved words:** lexer always emits reserved word tokens; parser decides whether they're in reserved position
- **Heredoc deferral:** `<<` queues a `PendingHeredoc`, content collected after the next newline, stored in a `Map<Token, string>` keyed by the redirect token

Key reserved words: `if then else elif fi for while until do done case esac in function select coproc`

`select` and `coproc` are tokenized but rejected by parser with helpful errors.

## Parser

- **Recursive descent**, single-pass, no backtracking
- **2-token lookahead** via `peek(0)` and `peek(1)` - used for function definition detection (`name ( )`) and arithmetic vs subshell disambiguation
- **Lookahead buffer** grows dynamically but never exceeds offset 1 in practice

Parse chain: `parseProgram()` > `parseList()` > `parsePipeline()` > `parseCommand()` > specific command parsers

## Intentionally Unsupported

| Feature | Error message |
|---------|--------------|
| `coproc` | "coproc is not supported; use pipes or background processes instead" |
| `select` | "select is not supported; use a for loop with a menu instead" |
| Process substitution `<()` `>()` | Not tokenized (parsed as redirection + subshell) |

## Gotchas

- **Word parsing is the most complex part.** Adding a new word type requires changes in all three files: ast.ts (type), lexer.ts (tokenization), parser.ts (parsing).
- **Reserved words are position-dependent.** `if` is reserved at command position but a plain word in `echo if`. The parser handles this, not the lexer.
- **Heredoc content is deferred.** The lexer collects heredoc bodies after newlines, not inline. Parser retrieves content via `getHeredocContent(token)`.
- **ConcatWord vs WordPart.** A bare `hello` is a LiteralWord. `"hello"${x}world` is a ConcatWord containing QuotedWord + VariableWord + LiteralWord. Always handle both in word processing code.
