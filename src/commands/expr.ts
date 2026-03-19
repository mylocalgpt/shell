import { checkRegexSafety } from '../security/regex.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const expr: Command = {
  name: 'expr',
  async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
    if (args.length === 0) {
      return { exitCode: 2, stdout: '', stderr: 'expr: missing operand\n' };
    }

    try {
      const result = evaluate(args, { pos: 0 });
      const isZeroOrEmpty = result === '' || result === '0';
      return { exitCode: isZeroOrEmpty ? 1 : 0, stdout: `${result}\n`, stderr: '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { exitCode: 2, stdout: '', stderr: `expr: ${msg}\n` };
    }
  },
};

interface ParseState {
  pos: number;
}

function evaluate(args: string[], state: ParseState): string {
  return parseOr(args, state);
}

function parseOr(args: string[], state: ParseState): string {
  let left = parseAnd(args, state);
  while (state.pos < args.length && args[state.pos] === '|') {
    state.pos++;
    const right = parseAnd(args, state);
    left = left !== '' && left !== '0' ? left : right;
  }
  return left;
}

function parseAnd(args: string[], state: ParseState): string {
  let left = parseComparison(args, state);
  while (state.pos < args.length && args[state.pos] === '&') {
    state.pos++;
    const right = parseComparison(args, state);
    if (left === '' || left === '0' || right === '' || right === '0') {
      left = '0';
    }
  }
  return left;
}

function parseComparison(args: string[], state: ParseState): string {
  const left = parseAddSub(args, state);
  if (state.pos < args.length) {
    const op = args[state.pos];
    if (op === '=' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      state.pos++;
      const right = parseAddSub(args, state);
      const lNum = Number.parseInt(left, 10);
      const rNum = Number.parseInt(right, 10);
      const numeric = !Number.isNaN(lNum) && !Number.isNaN(rNum);
      let result = false;
      switch (op) {
        case '=':
          result = left === right;
          break;
        case '!=':
          result = left !== right;
          break;
        case '<':
          result = numeric ? lNum < rNum : left < right;
          break;
        case '<=':
          result = numeric ? lNum <= rNum : left <= right;
          break;
        case '>':
          result = numeric ? lNum > rNum : left > right;
          break;
        case '>=':
          result = numeric ? lNum >= rNum : left >= right;
          break;
      }
      return result ? '1' : '0';
    }
  }
  return left;
}

function parseAddSub(args: string[], state: ParseState): string {
  let left = parseMulDiv(args, state);
  while (state.pos < args.length && (args[state.pos] === '+' || args[state.pos] === '-')) {
    const op = args[state.pos];
    state.pos++;
    const right = parseMulDiv(args, state);
    const l = Number.parseInt(left, 10) || 0;
    const r = Number.parseInt(right, 10) || 0;
    left = String(op === '+' ? l + r : l - r);
  }
  return left;
}

function parseMulDiv(args: string[], state: ParseState): string {
  let left = parseUnary(args, state);
  while (
    state.pos < args.length &&
    (args[state.pos] === '*' || args[state.pos] === '/' || args[state.pos] === '%')
  ) {
    const op = args[state.pos];
    state.pos++;
    const right = parseUnary(args, state);
    const l = Number.parseInt(left, 10) || 0;
    const r = Number.parseInt(right, 10) || 0;
    if ((op === '/' || op === '%') && r === 0) throw new Error('division by zero');
    if (op === '*') left = String(l * r);
    else if (op === '/') left = String(Math.trunc(l / r));
    else left = String(l % r);
  }
  return left;
}

function parseUnary(args: string[], state: ParseState): string {
  if (state.pos < args.length) {
    // Parentheses: \( expr \)
    if (args[state.pos] === '(') {
      state.pos++;
      const result = evaluate(args, state);
      if (state.pos < args.length && args[state.pos] === ')') state.pos++;
      return result;
    }

    // String functions
    if (args[state.pos] === 'match' && state.pos + 2 < args.length) {
      state.pos++;
      const str = args[state.pos++];
      const regex = args[state.pos++];
      try {
        if (checkRegexSafety(regex)) return '0';
        const re = new RegExp(`^${regex}`);
        const m = re.exec(str);
        if (m) return m[1] ?? String(m[0].length);
        return '0';
      } catch {
        return '0';
      }
    }

    if (args[state.pos] === 'substr' && state.pos + 3 < args.length) {
      state.pos++;
      const str = args[state.pos++];
      const pos = Number.parseInt(args[state.pos++], 10);
      const len = Number.parseInt(args[state.pos++], 10);
      return str.slice(pos - 1, pos - 1 + len);
    }

    if (args[state.pos] === 'length' && state.pos + 1 < args.length) {
      state.pos++;
      return String(args[state.pos++].length);
    }

    return args[state.pos++];
  }
  return '';
}
