import type { Command, CommandContext, CommandResult } from './types.js';

function processEscapes(s: string): string {
  let result = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      switch (s[i + 1]) {
        case 'n':
          result += '\n';
          i += 2;
          break;
        case 't':
          result += '\t';
          i += 2;
          break;
        case '\\':
          result += '\\';
          i += 2;
          break;
        case 'a':
          result += '\x07';
          i += 2;
          break;
        case 'b':
          result += '\b';
          i += 2;
          break;
        case 'f':
          result += '\f';
          i += 2;
          break;
        case 'r':
          result += '\r';
          i += 2;
          break;
        case 'v':
          result += '\v';
          i += 2;
          break;
        case '0': {
          let octal = '';
          let j = i + 2;
          while (j < s.length && j < i + 5 && s[j] >= '0' && s[j] <= '7') {
            octal += s[j];
            j++;
          }
          result += octal.length > 0 ? String.fromCharCode(Number.parseInt(octal, 8)) : '\0';
          i = j;
          break;
        }
        case 'x': {
          const hex = s.slice(i + 2, i + 4);
          const code = Number.parseInt(hex, 16);
          if (!Number.isNaN(code)) {
            result += String.fromCharCode(code);
            i += 4;
          } else {
            result += '\\x';
            i += 2;
          }
          break;
        }
        default:
          result += '\\';
          result += s[i + 1];
          i += 2;
          break;
      }
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

export const echo: Command = {
  name: 'echo',
  async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
    let noNewline = false;
    let enableEscapes = false;
    let startIdx = 0;

    // Parse leading flags only
    while (startIdx < args.length) {
      const arg = args[startIdx];
      if (arg === '-n') {
        noNewline = true;
        startIdx++;
      } else if (arg === '-e') {
        enableEscapes = true;
        startIdx++;
      } else if (arg === '-en' || arg === '-ne') {
        noNewline = true;
        enableEscapes = true;
        startIdx++;
      } else if (arg === '-E') {
        enableEscapes = false;
        startIdx++;
      } else break;
    }

    let output = '';
    for (let i = startIdx; i < args.length; i++) {
      if (i > startIdx) output += ' ';
      output += args[i];
    }

    if (enableEscapes) output = processEscapes(output);
    if (!noNewline) output += '\n';

    return { exitCode: 0, stdout: output, stderr: '' };
  },
};
