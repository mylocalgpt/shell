import { describe, expect, it } from 'vitest';
import { InMemoryFs } from '../../src/fs/memory.js';
import {
	type ExpansionOpts,
	type ShellState,
	evaluateArithmetic,
	expandWord,
	splitOnIFS,
} from '../../src/interpreter/expansion.js';
import type { Word } from '../../src/parser/ast.js';

/** Create a default shell state for testing. */
function makeState(overrides?: Partial<ShellState>): ShellState {
	return {
		env: new Map<string, string>(),
		positionalParams: [],
		arrays: new Map<string, string[]>(),
		lastExitCode: 0,
		pid: 1234,
		bgPid: 0,
		cwd: '/',
		options: { nounset: false },
		fs: new InMemoryFs(),
		...overrides,
	};
}

/** Create default expansion opts. */
function makeOpts(overrides?: Partial<ExpansionOpts>): ExpansionOpts {
	return {
		doubleQuoted: false,
		assignmentContext: false,
		casePattern: false,
		executor: async () => '',
		...overrides,
	};
}

/** Helper to expand a word and return the result. */
async function expand(word: Word, state?: ShellState, opts?: ExpansionOpts): Promise<string[]> {
	return expandWord(word, state ?? makeState(), opts ?? makeOpts());
}

/** Quick literal word. */
function lit(value: string): Word {
	return { type: 'LiteralWord', value, pos: { line: 1, col: 1 } };
}

/** Quick variable word. */
function varWord(name: string, operator?: string | null, operand?: Word | null): Word {
	return {
		type: 'VariableWord',
		name,
		operator: operator ?? null,
		operand: operand ?? null,
		indirect: false,
		length: false,
		pos: { line: 1, col: 1 },
	};
}

describe('Expansion Engine', () => {
	describe('variable expansion', () => {
		it('expands $VAR', async () => {
			const state = makeState({ env: new Map([['HOME', '/home/user']]) });
			const result = await expand(varWord('HOME'), state);
			expect(result).toEqual(['/home/user']);
		});

		it('returns empty for unset variable (unquoted drops empty)', async () => {
			const result = await expand(varWord('UNSET'));
			// Unquoted empty expansion is removed by word splitting (bash behavior)
			expect(result).toEqual([]);
		});

		it('expands ${VAR:-default}', async () => {
			const result = await expand(varWord('UNSET', ':-', lit('fallback')));
			expect(result).toEqual(['fallback']);
		});

		it('expands ${VAR:-default} with set var', async () => {
			const state = makeState({ env: new Map([['VAR', 'value']]) });
			const result = await expand(varWord('VAR', ':-', lit('fallback')), state);
			expect(result).toEqual(['value']);
		});

		it('expands ${VAR:+alt} with set var', async () => {
			const state = makeState({ env: new Map([['VAR', 'value']]) });
			const result = await expand(varWord('VAR', ':+', lit('alt')), state);
			expect(result).toEqual(['alt']);
		});

		it('expands ${VAR:+alt} with unset var', async () => {
			const result = await expand(varWord('VAR', ':+', lit('alt')));
			// Unquoted empty expansion removed by word splitting
			expect(result).toEqual([]);
		});

		it('expands ${#VAR} for length', async () => {
			const state = makeState({ env: new Map([['VAR', 'hello']]) });
			const word: Word = {
				type: 'VariableWord',
				name: 'VAR',
				operator: null,
				operand: null,
				indirect: false,
				length: true,
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word, state);
			expect(result).toEqual(['5']);
		});

		it('expands ${VAR#pattern} for prefix strip', async () => {
			const state = makeState({ env: new Map([['VAR', 'hello_world']]) });
			const result = await expand(varWord('VAR', '#', lit('hello')), state);
			expect(result).toEqual(['_world']);
		});

		it('expands ${VAR%pattern} for suffix strip', async () => {
			const state = makeState({ env: new Map([['VAR', 'hello_world']]) });
			const result = await expand(varWord('VAR', '%', lit('_world')), state);
			expect(result).toEqual(['hello']);
		});

		it('expands ${VAR:?error} throws on unset', async () => {
			await expect(expand(varWord('VAR', ':?', lit('not set')))).rejects.toThrow('not set');
		});
	});

	describe('special variables', () => {
		it('expands $?', async () => {
			const state = makeState({ lastExitCode: 42 });
			const result = await expand(varWord('?'), state);
			expect(result).toEqual(['42']);
		});

		it('expands $$', async () => {
			const state = makeState({ pid: 5678 });
			const result = await expand(varWord('$'), state);
			expect(result).toEqual(['5678']);
		});

		it('expands $#', async () => {
			const state = makeState({ positionalParams: ['a', 'b', 'c'] });
			const result = await expand(varWord('#'), state);
			expect(result).toEqual(['3']);
		});

		it('expands $1', async () => {
			const state = makeState({ positionalParams: ['first', 'second'] });
			const result = await expand(varWord('1'), state);
			expect(result).toEqual(['first']);
		});

		it('expands $@ as joined', async () => {
			const state = makeState({ positionalParams: ['a', 'b', 'c'] });
			const result = await expand(varWord('@'), state);
			expect(result).toEqual(['a', 'b', 'c']);
		});
	});

	describe('arithmetic expansion', () => {
		it('evaluates simple addition', () => {
			const state = makeState();
			expect(evaluateArithmetic('1 + 2', state)).toBe(3);
		});

		it('evaluates multiplication', () => {
			const state = makeState();
			expect(evaluateArithmetic('3 * 4', state)).toBe(12);
		});

		it('respects operator precedence', () => {
			const state = makeState();
			expect(evaluateArithmetic('2 + 3 * 4', state)).toBe(14);
		});

		it('evaluates parenthesized expressions', () => {
			const state = makeState();
			expect(evaluateArithmetic('(2 + 3) * 4', state)).toBe(20);
		});

		it('evaluates variable references', () => {
			const state = makeState({ env: new Map([['x', '5']]) });
			expect(evaluateArithmetic('x + 1', state)).toBe(6);
		});

		it('evaluates comparison operators', () => {
			const state = makeState();
			expect(evaluateArithmetic('5 > 3', state)).toBe(1);
			expect(evaluateArithmetic('3 > 5', state)).toBe(0);
		});

		it('evaluates logical operators', () => {
			const state = makeState();
			expect(evaluateArithmetic('1 && 1', state)).toBe(1);
			expect(evaluateArithmetic('1 && 0', state)).toBe(0);
			expect(evaluateArithmetic('0 || 1', state)).toBe(1);
		});

		it('evaluates ternary', () => {
			const state = makeState();
			expect(evaluateArithmetic('1 ? 10 : 20', state)).toBe(10);
			expect(evaluateArithmetic('0 ? 10 : 20', state)).toBe(20);
		});

		it('throws on division by zero', () => {
			const state = makeState();
			expect(() => evaluateArithmetic('1 / 0', state)).toThrow('division by zero');
		});

		it('wraps to 32-bit', () => {
			const state = makeState();
			const result = evaluateArithmetic('2147483647 + 1', state);
			expect(result).toBe(-2147483648);
		});

		it('evaluates exponentiation', () => {
			const state = makeState();
			expect(evaluateArithmetic('2 ** 10', state)).toBe(1024);
		});

		it('evaluates bitwise operators', () => {
			const state = makeState();
			expect(evaluateArithmetic('5 & 3', state)).toBe(1);
			expect(evaluateArithmetic('5 | 3', state)).toBe(7);
			expect(evaluateArithmetic('5 ^ 3', state)).toBe(6);
		});

		it('evaluates unary operators', () => {
			const state = makeState();
			expect(evaluateArithmetic('-5', state)).toBe(-5);
			expect(evaluateArithmetic('!0', state)).toBe(1);
			expect(evaluateArithmetic('!1', state)).toBe(0);
		});

		it('returns 0 for empty expression', () => {
			const state = makeState();
			expect(evaluateArithmetic('', state)).toBe(0);
		});
	});

	describe('tilde expansion', () => {
		it('expands ~ to HOME', async () => {
			const state = makeState({ env: new Map([['HOME', '/home/user']]) });
			const word: Word = { type: 'TildeWord', suffix: '', pos: { line: 1, col: 1 } };
			const result = await expand(word, state);
			expect(result).toEqual(['/home/user']);
		});

		it('expands ~+ to PWD', async () => {
			const state = makeState({ env: new Map([['PWD', '/current']]) });
			const word: Word = { type: 'TildeWord', suffix: '+', pos: { line: 1, col: 1 } };
			const result = await expand(word, state);
			expect(result).toEqual(['/current']);
		});

		it('expands ~- to OLDPWD', async () => {
			const state = makeState({ env: new Map([['OLDPWD', '/previous']]) });
			const word: Word = { type: 'TildeWord', suffix: '-', pos: { line: 1, col: 1 } };
			const result = await expand(word, state);
			expect(result).toEqual(['/previous']);
		});
	});

	describe('word splitting', () => {
		it('splits on default IFS', () => {
			const state = makeState();
			expect(splitOnIFS('hello world', state)).toEqual(['hello', 'world']);
		});

		it('collapses consecutive whitespace', () => {
			const state = makeState();
			expect(splitOnIFS('  hello   world  ', state)).toEqual(['hello', 'world']);
		});

		it('splits on custom IFS', () => {
			const state = makeState({ env: new Map([['IFS', ':']]) });
			expect(splitOnIFS('a:b:c', state)).toEqual(['a', 'b', 'c']);
		});

		it('returns whole string for empty IFS', () => {
			const state = makeState({ env: new Map([['IFS', '']]) });
			expect(splitOnIFS('hello world', state)).toEqual(['hello world']);
		});

		it('handles empty string', () => {
			const state = makeState();
			expect(splitOnIFS('', state)).toEqual([]);
		});

		it('handles non-whitespace IFS delimiters', () => {
			const state = makeState({ env: new Map([['IFS', ':']]) });
			expect(splitOnIFS(':a::b:', state)).toEqual(['', 'a', '', 'b']);
		});
	});

	describe('glob matching', () => {
		it('matches *', async () => {
			const fs = new InMemoryFs();
			fs.writeFile('/file1.txt', '');
			fs.writeFile('/file2.txt', '');
			fs.writeFile('/other.log', '');
			const state = makeState({ fs, cwd: '/' });
			const word: Word = { type: 'GlobWord', pattern: '*.txt', pos: { line: 1, col: 1 } };
			const result = await expand(word, state);
			expect(result).toEqual(['file1.txt', 'file2.txt']);
		});

		it('returns literal when no match', async () => {
			const state = makeState();
			const word: Word = { type: 'GlobWord', pattern: '*.xyz', pos: { line: 1, col: 1 } };
			const result = await expand(word, state);
			expect(result).toEqual(['*.xyz']);
		});
	});

	describe('brace expansion', () => {
		it('expands comma-separated list', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [
					{
						type: 'list',
						items: [lit('a'), lit('b'), lit('c')],
					},
				],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['a', 'b', 'c']);
		});

		it('expands numeric range', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [{ type: 'range', start: '1', end: '5', incr: null }],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['1', '2', '3', '4', '5']);
		});

		it('expands character range', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [{ type: 'range', start: 'a', end: 'e', incr: null }],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
		});

		it('expands reverse range', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [{ type: 'range', start: '5', end: '1', incr: null }],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['5', '4', '3', '2', '1']);
		});

		it('expands range with step', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [{ type: 'range', start: '1', end: '10', incr: 3 }],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['1', '4', '7', '10']);
		});

		it('expands zero-padded range', async () => {
			const word: Word = {
				type: 'BraceExpansion',
				parts: [{ type: 'range', start: '01', end: '03', incr: null }],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word);
			expect(result).toEqual(['01', '02', '03']);
		});
	});

	describe('quoted words', () => {
		it('expands single-quoted as literal (double-quoted context)', async () => {
			const word: Word = {
				type: 'QuotedWord',
				parts: [lit('hello world')],
				quoteType: 'single',
				pos: { line: 1, col: 1 },
			};
			// Single-quoted words are typically inside double-quoted context to suppress splitting
			const result = await expand(word, makeState(), makeOpts({ doubleQuoted: true }));
			expect(result).toEqual(['hello world']);
		});

		it('expands double-quoted with variable', async () => {
			const state = makeState({ env: new Map([['NAME', 'world']]) });
			const word: Word = {
				type: 'QuotedWord',
				parts: [lit('hello '), varWord('NAME')],
				quoteType: 'double',
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word, state, makeOpts({ doubleQuoted: true }));
			expect(result).toEqual(['hello world']);
		});
	});

	describe('nounset', () => {
		it('throws on unset variable when nounset is enabled', async () => {
			const state = makeState({ options: { nounset: true } });
			await expect(expand(varWord('UNSET'), state)).rejects.toThrow('unbound variable');
		});

		it('allows ${VAR:-} with nounset (empty result removed by splitting)', async () => {
			const state = makeState({ options: { nounset: true } });
			// With nounset, ${VAR:-} doesn't throw because :- is a default operator
			const result = await expand(varWord('UNSET', ':-', lit('')), state);
			expect(result).toEqual([]);
		});
	});

	describe('concat word', () => {
		it('concatenates parts', async () => {
			const state = makeState({ env: new Map([['NAME', 'world']]) });
			const word: Word = {
				type: 'ConcatWord',
				parts: [lit('hello_'), varWord('NAME')],
				pos: { line: 1, col: 1 },
			};
			const result = await expand(word, state);
			expect(result).toEqual(['hello_world']);
		});
	});

	describe('command substitution', () => {
		it('calls executor and trims trailing newline', async () => {
			const word: Word = {
				type: 'CommandSubstitution',
				body: {
					type: 'Program',
					body: { type: 'List', entries: [], pos: { line: 1, col: 1 } },
					pos: { line: 1, col: 1 },
				},
				backtick: false,
				pos: { line: 1, col: 1 },
			};
			const opts = makeOpts({ executor: async () => 'hello\n' });
			const result = await expand(word, makeState(), opts);
			expect(result).toEqual(['hello']);
		});
	});
});
