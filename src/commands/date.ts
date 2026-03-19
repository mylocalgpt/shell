import type { Command, CommandContext, CommandResult } from './types.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function applyFormat(fmt: string, d: Date): string {
  let result = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === '%' && i + 1 < fmt.length) {
      i++;
      switch (fmt[i]) {
        case 'Y':
          result += String(d.getFullYear());
          break;
        case 'm':
          result += pad2(d.getMonth() + 1);
          break;
        case 'd':
          result += pad2(d.getDate());
          break;
        case 'H':
          result += pad2(d.getHours());
          break;
        case 'M':
          result += pad2(d.getMinutes());
          break;
        case 'S':
          result += pad2(d.getSeconds());
          break;
        case 's':
          result += String(Math.floor(d.getTime() / 1000));
          break;
        case 'A':
          result += DAYS[d.getDay()];
          break;
        case 'B':
          result += MONTHS[d.getMonth()];
          break;
        case 'Z':
          result += 'UTC';
          break;
        case 'F':
          result += `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
          break;
        case 'T':
          result += `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
          break;
        case 'n':
          result += '\n';
          break;
        case 't':
          result += '\t';
          break;
        case '%':
          result += '%';
          break;
        default:
          result += `%${fmt[i]}`;
          break;
      }
      i++;
    } else {
      result += fmt[i];
      i++;
    }
  }
  return result;
}

export const date: Command = {
  name: 'date',
  async execute(args: string[], _ctx: CommandContext): Promise<CommandResult> {
    const now = new Date();
    if (args.length > 0 && args[0].startsWith('+')) {
      const fmt = args[0].slice(1);
      return { exitCode: 0, stdout: `${applyFormat(fmt, now)}\n`, stderr: '' };
    }
    // Default format
    const output = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${now.getDate()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} UTC ${now.getFullYear()}`;
    return { exitCode: 0, stdout: `${output}\n`, stderr: '' };
  },
};
