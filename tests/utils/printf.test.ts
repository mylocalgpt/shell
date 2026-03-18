import { describe, expect, it } from 'vitest';
import { formatPrintf } from '../../src/utils/printf.js';

describe('formatPrintf', () => {
	describe('string specifier %s', () => {
		it('substitutes a string', () => {
			expect(formatPrintf('%s', ['hello'])).toBe('hello');
		});

		it('substitutes multiple strings', () => {
			expect(formatPrintf('%s %s', ['hello', 'world'])).toBe('hello world');
		});

		it('uses empty string for missing arg', () => {
			expect(formatPrintf('%s', [])).toBe('');
		});

		it('right-aligns with width', () => {
			expect(formatPrintf('%10s', ['hi'])).toBe('        hi');
		});

		it('left-aligns with -', () => {
			expect(formatPrintf('%-10s', ['hi'])).toBe('hi        ');
		});

		it('truncates with precision', () => {
			expect(formatPrintf('%.3s', ['hello'])).toBe('hel');
		});
	});

	describe('integer specifier %d', () => {
		it('formats an integer', () => {
			expect(formatPrintf('%d', ['42'])).toBe('42');
		});

		it('formats negative integer', () => {
			expect(formatPrintf('%d', ['-7'])).toBe('-7');
		});

		it('zero-pads with 0 flag', () => {
			expect(formatPrintf('%05d', ['42'])).toBe('00042');
		});

		it('zero-pads negative numbers correctly', () => {
			expect(formatPrintf('%05d', ['-7'])).toBe('-0007');
		});

		it('force sign with + flag', () => {
			expect(formatPrintf('%+d', ['42'])).toBe('+42');
		});

		it('space sign for positive', () => {
			expect(formatPrintf('% d', ['42'])).toBe(' 42');
		});

		it('treats empty string as 0', () => {
			expect(formatPrintf('%d', [''])).toBe('0');
		});

		it('treats non-numeric as 0', () => {
			expect(formatPrintf('%d', ['abc'])).toBe('0');
		});
	});

	describe('float specifier %f', () => {
		it('formats a float with default precision', () => {
			expect(formatPrintf('%f', ['3.14'])).toBe('3.140000');
		});

		it('formats with explicit precision', () => {
			expect(formatPrintf('%.2f', ['3.14159'])).toBe('3.14');
		});

		it('formats with zero precision', () => {
			expect(formatPrintf('%.0f', ['3.7'])).toBe('4');
		});

		it('zero-pads float', () => {
			expect(formatPrintf('%010.2f', ['3.14'])).toBe('0000003.14');
		});

		it('treats empty string as 0', () => {
			expect(formatPrintf('%f', [''])).toBe('0.000000');
		});
	});

	describe('hex specifier %x/%X', () => {
		it('formats lowercase hex', () => {
			expect(formatPrintf('%x', ['255'])).toBe('ff');
		});

		it('formats uppercase hex', () => {
			expect(formatPrintf('%X', ['255'])).toBe('FF');
		});

		it('zero-pads hex', () => {
			expect(formatPrintf('%04x', ['10'])).toBe('000a');
		});
	});

	describe('octal specifier %o', () => {
		it('formats octal', () => {
			expect(formatPrintf('%o', ['8'])).toBe('10');
		});

		it('formats octal with width', () => {
			expect(formatPrintf('%04o', ['8'])).toBe('0010');
		});
	});

	describe('literal percent %%', () => {
		it('outputs a single %', () => {
			expect(formatPrintf('%%', [])).toBe('%');
		});

		it('mixes %% with specifiers', () => {
			expect(formatPrintf('%d%%', ['50'])).toBe('50%');
		});
	});

	describe('escape sequences', () => {
		it('handles \\n', () => {
			expect(formatPrintf('a\\nb', [])).toBe('a\nb');
		});

		it('handles \\t', () => {
			expect(formatPrintf('a\\tb', [])).toBe('a\tb');
		});

		it('handles \\\\', () => {
			expect(formatPrintf('a\\\\b', [])).toBe('a\\b');
		});

		it('handles \\xHH', () => {
			expect(formatPrintf('\\x41', [])).toBe('A');
		});

		it('handles \\0NNN', () => {
			expect(formatPrintf('\\0101', [])).toBe('A');
		});
	});

	describe('argument recycling', () => {
		it('repeats format for extra args', () => {
			expect(formatPrintf('%s\n', ['a', 'b', 'c'])).toBe('a\nb\nc\n');
		});

		it('does not recycle if no specifiers', () => {
			expect(formatPrintf('hello', ['a', 'b'])).toBe('hello');
		});
	});

	describe('edge cases', () => {
		it('handles empty format', () => {
			expect(formatPrintf('', [])).toBe('');
		});

		it('handles format with no specifiers', () => {
			expect(formatPrintf('hello world', [])).toBe('hello world');
		});

		it('handles character syntax for %d', () => {
			expect(formatPrintf('%d', ["'A"])).toBe('65');
		});

		it('handles hex input for %d', () => {
			expect(formatPrintf('%d', ['0xff'])).toBe('255');
		});

		it('handles octal input for %d', () => {
			expect(formatPrintf('%d', ['010'])).toBe('8');
		});
	});
});
