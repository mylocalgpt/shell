import type { Command, CommandContext, CommandResult } from './types.js';

const CHAR_CLASSES: Record<string, string> = {
  '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  '[:lower:]': 'abcdefghijklmnopqrstuvwxyz',
  '[:digit:]': '0123456789',
  '[:alpha:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  '[:alnum:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  '[:space:]': ' \t\n\r\f\v',
  '[:blank:]': ' \t',
  '[:punct:]': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};

/**
 * Expand a tr SET specification into a string of characters.
 */
function expandSet(set: string): string {
  let result = '';
  let i = 0;

  while (i < set.length) {
    // Check for character class
    if (set[i] === '[' && set[i + 1] === ':') {
      const end = set.indexOf(':]', i + 2);
      if (end >= 0) {
        const className = set.slice(i, end + 2);
        const expanded = CHAR_CLASSES[className];
        if (expanded) {
          result += expanded;
          i = end + 2;
          continue;
        }
      }
    }

    // Check for range: a-z
    if (i + 2 < set.length && set[i + 1] === '-') {
      const start = set.charCodeAt(i);
      const end = set.charCodeAt(i + 2);
      if (start <= end) {
        for (let c = start; c <= end; c++) {
          result += String.fromCharCode(c);
        }
      } else {
        for (let c = start; c >= end; c--) {
          result += String.fromCharCode(c);
        }
      }
      i += 3;
      continue;
    }

    // Escape sequences
    if (set[i] === '\\' && i + 1 < set.length) {
      switch (set[i + 1]) {
        case 'n':
          result += '\n';
          break;
        case 't':
          result += '\t';
          break;
        case 'r':
          result += '\r';
          break;
        case '\\':
          result += '\\';
          break;
        default:
          result += set[i + 1];
          break;
      }
      i += 2;
      continue;
    }

    result += set[i];
    i++;
  }

  return result;
}

export const tr: Command = {
  name: 'tr',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    let deleteMode = false;
    let squeezeMode = false;
    const sets: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('-') && arg.length > 1) {
        for (let c = 1; c < arg.length; c++) {
          switch (arg[c]) {
            case 'd':
              deleteMode = true;
              break;
            case 's':
              squeezeMode = true;
              break;
            default:
              return {
                exitCode: 1,
                stdout: '',
                stderr: `tr: invalid option -- '${arg[c]}'\n`,
              };
          }
        }
      } else {
        sets.push(arg);
      }
    }

    if (sets.length === 0) {
      return { exitCode: 1, stdout: '', stderr: 'tr: missing operand\n' };
    }

    const set1 = expandSet(sets[0]);
    const set1Chars = new Set<string>();
    for (let i = 0; i < set1.length; i++) {
      set1Chars.add(set1[i]);
    }

    const input = ctx.stdin;
    let output = '';

    if (deleteMode) {
      for (let i = 0; i < input.length; i++) {
        if (!set1Chars.has(input[i])) {
          output += input[i];
        }
      }
      if (squeezeMode && sets.length > 1) {
        const set2 = expandSet(sets[1]);
        const set2Chars = new Set<string>();
        for (let i = 0; i < set2.length; i++) set2Chars.add(set2[i]);
        output = squeezeChars(output, set2Chars);
      }
    } else if (squeezeMode && sets.length === 1) {
      output = squeezeChars(input, set1Chars);
    } else {
      // Translate mode
      if (sets.length < 2) {
        return { exitCode: 1, stdout: '', stderr: 'tr: missing operand after set1\n' };
      }
      let set2 = expandSet(sets[1]);
      // Extend set2 with its last char to match set1 length
      if (set2.length < set1.length && set2.length > 0) {
        const lastChar = set2[set2.length - 1];
        while (set2.length < set1.length) {
          set2 += lastChar;
        }
      }

      // Build translation map
      const transMap = new Map<string, string>();
      for (let i = 0; i < set1.length; i++) {
        if (i < set2.length) {
          transMap.set(set1[i], set2[i]);
        }
      }

      for (let i = 0; i < input.length; i++) {
        const mapped = transMap.get(input[i]);
        output += mapped !== undefined ? mapped : input[i];
      }

      if (squeezeMode) {
        const set2Chars = new Set<string>();
        for (let i = 0; i < set2.length; i++) set2Chars.add(set2[i]);
        output = squeezeChars(output, set2Chars);
      }
    }

    return { exitCode: 0, stdout: output, stderr: '' };
  },
};

function squeezeChars(input: string, chars: Set<string>): string {
  let result = '';
  let lastChar = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (chars.has(ch) && ch === lastChar) continue;
    result += ch;
    lastChar = ch;
  }
  return result;
}
