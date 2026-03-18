import { describe, expect, it } from 'vitest';
import { ParseError, parse } from '../../src/parser/parser.js';

describe('Parser', () => {
	describe('simple commands', () => {
		it('parses a single word command', () => {
			const ast = parse('echo');
			expect(ast.type).toBe('Program');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('SimpleCommand');
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.words).toHaveLength(1);
				expect(cmd.words[0].type).toBe('LiteralWord');
			}
		});

		it('parses command with arguments', () => {
			const ast = parse('echo hello world');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.words).toHaveLength(3);
			}
		});

		it('parses empty input', () => {
			const ast = parse('');
			expect(ast.body.entries).toHaveLength(0);
		});

		it('parses whitespace-only input', () => {
			const ast = parse('   ');
			expect(ast.body.entries).toHaveLength(0);
		});
	});

	describe('pipes', () => {
		it('parses a simple pipe', () => {
			const ast = parse('echo hello | cat');
			const pipeline = ast.body.entries[0].pipeline;
			expect(pipeline.commands).toHaveLength(2);
		});

		it('parses multi-stage pipe', () => {
			const ast = parse('echo hello | grep h | wc -l');
			const pipeline = ast.body.entries[0].pipeline;
			expect(pipeline.commands).toHaveLength(3);
		});

		it('parses negated pipeline', () => {
			const ast = parse('! cmd');
			const pipeline = ast.body.entries[0].pipeline;
			expect(pipeline.negated).toBe(true);
		});
	});

	describe('redirections', () => {
		it('parses output redirection', () => {
			const ast = parse('echo hello > file');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.redirections).toHaveLength(1);
				expect(cmd.redirections[0].operator).toBe('>');
			}
		});

		it('parses append redirection', () => {
			const ast = parse('echo hello >> file');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.redirections[0].operator).toBe('>>');
			}
		});

		it('parses input redirection', () => {
			const ast = parse('cmd < file');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.redirections[0].operator).toBe('<');
			}
		});

		it('parses stderr redirection 2>&1', () => {
			const ast = parse('cmd 2>&1');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.redirections).toHaveLength(1);
				expect(cmd.redirections[0].operator).toBe('>&');
				expect(cmd.redirections[0].fd).toBe(2);
			}
		});
	});

	describe('control flow', () => {
		it('parses if/then/fi', () => {
			const ast = parse('if true; then echo yes; fi');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('IfStatement');
		});

		it('parses if/then/else/fi', () => {
			const ast = parse('if true; then echo yes; else echo no; fi');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('IfStatement');
			if (cmd.type === 'IfStatement') {
				expect(cmd.else).not.toBeNull();
			}
		});

		it('parses if/elif/else/fi', () => {
			const ast = parse('if a; then b; elif c; then d; else e; fi');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'IfStatement') {
				expect(cmd.elifs).toHaveLength(1);
				expect(cmd.else).not.toBeNull();
			}
		});

		it('parses for-in loop', () => {
			const ast = parse('for x in a b c; do echo $x; done');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('ForStatement');
			if (cmd.type === 'ForStatement') {
				expect(cmd.variable).toBe('x');
				expect(cmd.words).toHaveLength(3);
			}
		});

		it('parses while loop', () => {
			const ast = parse('while true; do echo loop; done');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('WhileStatement');
		});

		it('parses until loop', () => {
			const ast = parse('until false; do echo loop; done');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('UntilStatement');
		});

		it('parses case statement', () => {
			const ast = parse('case $x in a) echo a;; b) echo b;; esac');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('CaseStatement');
			if (cmd.type === 'CaseStatement') {
				expect(cmd.items).toHaveLength(2);
			}
		});
	});

	describe('functions', () => {
		it('parses function with keyword syntax', () => {
			const ast = parse('function foo { echo bar; }');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('FunctionDefinition');
			if (cmd.type === 'FunctionDefinition') {
				expect(cmd.name).toBe('foo');
			}
		});

		it('parses function with () syntax', () => {
			const ast = parse('foo() { echo bar; }');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('FunctionDefinition');
			if (cmd.type === 'FunctionDefinition') {
				expect(cmd.name).toBe('foo');
			}
		});

		it('parses function with keyword and () syntax', () => {
			const ast = parse('function foo() { echo bar; }');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('FunctionDefinition');
		});
	});

	describe('conditional expressions [[ ]]', () => {
		it('parses unary test', () => {
			const ast = parse('[[ -f file ]]');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('ConditionalExpression');
			if (cmd.type === 'ConditionalExpression') {
				expect(cmd.expression.type).toBe('UnaryTest');
			}
		});

		it('parses binary test ==', () => {
			const ast = parse('[[ $a == hello ]]');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'ConditionalExpression') {
				expect(cmd.expression.type).toBe('BinaryTest');
				if (cmd.expression.type === 'BinaryTest') {
					expect(cmd.expression.operator).toBe('==');
				}
			}
		});

		it('parses logical && in conditional', () => {
			const ast = parse('[[ -f file && -d dir ]]');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'ConditionalExpression') {
				expect(cmd.expression.type).toBe('AndExpr');
			}
		});

		it('parses ! negation in conditional', () => {
			const ast = parse('[[ ! -f file ]]');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'ConditionalExpression') {
				expect(cmd.expression.type).toBe('NotExpr');
			}
		});
	});

	describe('subshells and brace groups', () => {
		it('parses subshell', () => {
			const ast = parse('(echo hello)');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('Subshell');
		});

		it('parses brace group', () => {
			const ast = parse('{ echo hello; }');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			expect(cmd.type).toBe('BraceGroup');
		});
	});

	describe('lists', () => {
		it('parses && list', () => {
			const ast = parse('cmd1 && cmd2');
			expect(ast.body.entries).toHaveLength(2);
			expect(ast.body.entries[0].operator).toBe('&&');
		});

		it('parses || list', () => {
			const ast = parse('cmd1 || cmd2');
			expect(ast.body.entries).toHaveLength(2);
			expect(ast.body.entries[0].operator).toBe('||');
		});

		it('parses semicolon-separated list', () => {
			const ast = parse('cmd1; cmd2; cmd3');
			expect(ast.body.entries.length).toBeGreaterThanOrEqual(2);
		});

		it('parses background operator', () => {
			const ast = parse('cmd &');
			expect(ast.body.entries[0].operator).toBe('&');
		});
	});

	describe('assignments', () => {
		it('parses simple assignment', () => {
			const ast = parse('VAR=hello');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.assignments).toHaveLength(1);
				expect(cmd.assignments[0].name).toBe('VAR');
			}
		});

		it('parses assignment before command', () => {
			const ast = parse('VAR=hello echo $VAR');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.assignments).toHaveLength(1);
				expect(cmd.words).toHaveLength(2);
			}
		});

		it('parses multiple assignments', () => {
			const ast = parse('A=1 B=2 cmd');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.assignments).toHaveLength(2);
				expect(cmd.words).toHaveLength(1);
			}
		});

		it('parses += append assignment', () => {
			const ast = parse('VAR+=more');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				expect(cmd.assignments[0].append).toBe(true);
			}
		});
	});

	describe('words and expansions', () => {
		it('parses variable expansion $VAR', () => {
			const ast = parse('echo $HOME');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('VariableWord');
				if (word.type === 'VariableWord') {
					expect(word.name).toBe('HOME');
				}
			}
		});

		it('parses parameter expansion ${VAR:-default}', () => {
			const ast = parse('echo ${VAR:-default}');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('VariableWord');
				if (word.type === 'VariableWord') {
					expect(word.name).toBe('VAR');
					expect(word.operator).toBe(':-');
				}
			}
		});

		it('parses command substitution $(cmd)', () => {
			const ast = parse('echo $(whoami)');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('CommandSubstitution');
			}
		});

		it('parses arithmetic expansion $((1+2))', () => {
			const ast = parse('echo $((1+2))');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('ArithmeticExpansion');
				if (word.type === 'ArithmeticExpansion') {
					expect(word.expression).toBe('1+2');
				}
			}
		});

		it('parses double-quoted string with variable', () => {
			const ast = parse('echo "hello $name"');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('QuotedWord');
				if (word.type === 'QuotedWord') {
					expect(word.quoteType).toBe('double');
					expect(word.parts.length).toBeGreaterThanOrEqual(2);
				}
			}
		});

		it('parses single-quoted string', () => {
			const ast = parse("echo 'hello world'");
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('QuotedWord');
				if (word.type === 'QuotedWord') {
					expect(word.quoteType).toBe('single');
				}
			}
		});

		it('parses tilde expansion', () => {
			const ast = parse('cd ~');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('TildeWord');
			}
		});

		it('parses glob pattern', () => {
			const ast = parse('ls *.txt');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				// Could be ConcatWord with GlobWord + LiteralWord, or just contain a GlobWord
				expect(
					word.type === 'GlobWord' || word.type === 'ConcatWord' || word.type === 'LiteralWord',
				).toBe(true);
			}
		});

		it('parses brace expansion', () => {
			const ast = parse('echo {a,b,c}');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('BraceExpansion');
			}
		});

		it('parses backtick command substitution', () => {
			const ast = parse('echo `whoami`');
			const cmd = ast.body.entries[0].pipeline.commands[0];
			if (cmd.type === 'SimpleCommand') {
				const word = cmd.words[1];
				expect(word.type).toBe('CommandSubstitution');
				if (word.type === 'CommandSubstitution') {
					expect(word.backtick).toBe(true);
				}
			}
		});
	});

	describe('error cases', () => {
		it('errors on unterminated if', () => {
			expect(() => parse('if true; then echo yes')).toThrow(ParseError);
		});

		it('errors on missing do in for', () => {
			expect(() => parse('for x in a b; echo $x; done')).toThrow(ParseError);
		});

		it('errors on coproc (unsupported)', () => {
			expect(() => parse('coproc cmd')).toThrow(ParseError);
			expect(() => parse('coproc cmd')).toThrow(/coproc/);
		});

		it('errors on select (unsupported)', () => {
			expect(() => parse('select x in a b; do echo $x; done')).toThrow(ParseError);
			expect(() => parse('select x in a b; do echo $x; done')).toThrow(/select/);
		});
	});

	describe('complex scripts', () => {
		it('parses a multi-line script', () => {
			const script = `
set -euo pipefail

for file in *.txt; do
  if [[ -f "$file" ]]; then
    echo "Processing $file"
    cat "$file" | grep pattern > output.txt
  fi
done
`;
			const ast = parse(script);
			expect(ast.type).toBe('Program');
			expect(ast.body.entries.length).toBeGreaterThan(0);
		});

		it('parses nested control flow', () => {
			const script = 'if true; then for x in a b; do echo $x; done; fi';
			const ast = parse(script);
			const ifStmt = ast.body.entries[0].pipeline.commands[0];
			expect(ifStmt.type).toBe('IfStatement');
		});

		it('parses compound && || list', () => {
			const ast = parse('cmd1 && cmd2 || cmd3');
			expect(ast.body.entries.length).toBeGreaterThanOrEqual(2);
		});
	});
});
