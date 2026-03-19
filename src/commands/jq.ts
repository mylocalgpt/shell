/**
 * jq command - JSON processor.
 *
 * Thin wrapper around the jq engine (src/jq/). Handles CLI flag
 * parsing, input reading, and output formatting.
 */

import { JqHaltError, JqParseError } from '../jq/errors.js';
import type { JsonValue } from '../jq/evaluator.js';
import { jq as jqEngine } from '../jq/index.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(cwd: string, path: string): string {
  if (path.startsWith('/')) return path;
  if (cwd === '/') return `/${path}`;
  return `${cwd}/${path}`;
}

export const jqCommand: Command = {
  name: 'jq',

  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    // Parse flags
    let rawOutput = false;
    let rawInput = false;
    let compact = false;
    let slurp = false;
    let nullInput = false;
    let exitStatus = false;
    let joinOutput = false;
    let sortKeys = false;
    let tab = false;
    const userArgs: Record<string, string> = {};
    const userArgjson: Record<string, JsonValue> = {};
    let jsonArgs = false;
    const positionalJsonArgs: JsonValue[] = [];
    let filter: string | null = null;
    const inputFiles: string[] = [];

    let i = 0;
    while (i < args.length) {
      const arg = args[i];

      if (arg === '--') {
        i++;
        break;
      }

      if (arg === '--raw-output' || arg === '-r') {
        rawOutput = true;
        i++;
        continue;
      }
      if (arg === '--raw-input' || arg === '-R') {
        rawInput = true;
        i++;
        continue;
      }
      if (arg === '--compact-output' || arg === '-c') {
        compact = true;
        i++;
        continue;
      }
      if (arg === '--slurp' || arg === '-s') {
        slurp = true;
        i++;
        continue;
      }
      if (arg === '--null-input' || arg === '-n') {
        nullInput = true;
        i++;
        continue;
      }
      if (arg === '--exit-status' || arg === '-e') {
        exitStatus = true;
        i++;
        continue;
      }
      if (arg === '--join-output' || arg === '-j') {
        joinOutput = true;
        rawOutput = true;
        i++;
        continue;
      }
      if (arg === '--sort-keys' || arg === '-S') {
        sortKeys = true;
        i++;
        continue;
      }
      if (arg === '--tab') {
        tab = true;
        i++;
        continue;
      }
      if (arg === '--arg') {
        if (i + 2 >= args.length) {
          return { exitCode: 2, stdout: '', stderr: 'jq: --arg requires name and value\n' };
        }
        userArgs[args[i + 1]] = args[i + 2];
        i += 3;
        continue;
      }
      if (arg === '--argjson') {
        if (i + 2 >= args.length) {
          return { exitCode: 2, stdout: '', stderr: 'jq: --argjson requires name and value\n' };
        }
        try {
          userArgjson[args[i + 1]] = JSON.parse(args[i + 2]) as JsonValue;
        } catch {
          return {
            exitCode: 2,
            stdout: '',
            stderr: `jq: invalid JSON for --argjson ${args[i + 1]}: ${args[i + 2]}\n`,
          };
        }
        i += 3;
        continue;
      }
      if (arg === '--slurpfile') {
        if (i + 2 >= args.length) {
          return { exitCode: 2, stdout: '', stderr: 'jq: --slurpfile requires name and file\n' };
        }
        const sfName = args[i + 1];
        const sfPath = resolvePath(ctx.cwd, args[i + 2]);
        try {
          const content = ctx.fs.readFile(sfPath);
          const text = typeof content === 'string' ? content : await content;
          userArgjson[sfName] = JSON.parse(text) as JsonValue;
        } catch {
          return {
            exitCode: 2,
            stdout: '',
            stderr: `jq: could not read --slurpfile ${sfPath}\n`,
          };
        }
        i += 3;
        continue;
      }
      if (arg === '--jsonargs') {
        jsonArgs = true;
        i++;
        continue;
      }

      // Combined short flags: -rc, -rn, etc.
      if (arg.startsWith('-') && arg.length > 2 && !arg.startsWith('--')) {
        for (let j = 1; j < arg.length; j++) {
          const ch = arg[j];
          if (ch === 'r') rawOutput = true;
          else if (ch === 'R') rawInput = true;
          else if (ch === 'c') compact = true;
          else if (ch === 's') slurp = true;
          else if (ch === 'n') nullInput = true;
          else if (ch === 'e') exitStatus = true;
          else if (ch === 'j') {
            joinOutput = true;
            rawOutput = true;
          } else if (ch === 'S') sortKeys = true;
          else {
            return { exitCode: 2, stdout: '', stderr: `jq: unknown flag: -${ch}\n` };
          }
        }
        i++;
        continue;
      }

      // Unknown long flag
      if (arg.startsWith('--')) {
        return { exitCode: 2, stdout: '', stderr: `jq: unknown flag: ${arg}\n` };
      }

      // First non-flag is filter, rest are input files or jsonargs
      if (filter === null) {
        filter = arg;
      } else if (jsonArgs) {
        try {
          positionalJsonArgs.push(JSON.parse(arg) as JsonValue);
        } catch {
          return { exitCode: 2, stdout: '', stderr: `jq: invalid JSON argument: ${arg}\n` };
        }
      } else {
        inputFiles.push(arg);
      }
      i++;
    }

    // Handle remaining args after --
    while (i < args.length) {
      if (filter === null) {
        filter = args[i];
      } else if (jsonArgs) {
        try {
          positionalJsonArgs.push(JSON.parse(args[i]) as JsonValue);
        } catch {
          return { exitCode: 2, stdout: '', stderr: `jq: invalid JSON argument: ${args[i]}\n` };
        }
      } else {
        inputFiles.push(args[i]);
      }
      i++;
    }

    if (filter === null) {
      return { exitCode: 2, stdout: '', stderr: 'jq: no filter provided\n' };
    }

    // Build $ARGS
    const argsNamed: Record<string, string> = {};
    const argKeys = Object.keys(userArgs);
    for (let k = 0; k < argKeys.length; k++) {
      argsNamed[argKeys[k]] = userArgs[argKeys[k]];
    }

    // Gather input
    let inputText: string;
    if (nullInput) {
      inputText = '';
    } else if (inputFiles.length > 0) {
      const parts: string[] = [];
      for (let f = 0; f < inputFiles.length; f++) {
        const fPath = resolvePath(ctx.cwd, inputFiles[f]);
        try {
          const content = ctx.fs.readFile(fPath);
          const text = typeof content === 'string' ? content : await content;
          parts.push(text);
        } catch {
          return { exitCode: 2, stdout: '', stderr: `jq: could not read file: ${fPath}\n` };
        }
      }
      inputText = parts.join('\n');
    } else {
      inputText = ctx.stdin;
    }

    // Raw input mode: each line becomes a JSON string
    if (rawInput && !nullInput) {
      const lines = inputText.split('\n');
      // Remove trailing empty line
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      inputText = lines.map((l) => JSON.stringify(l)).join('\n');
    }

    // Merge all user variables
    const mergedArgs = { ...userArgs };
    const mergedArgjson = { ...userArgjson };

    // Add $ARGS
    mergedArgjson.ARGS = {
      positional: positionalJsonArgs,
      named: argsNamed,
    };

    try {
      const output = jqEngine(inputText, filter, {
        rawOutput,
        compactOutput: compact,
        sortKeys,
        tab,
        nullInput,
        slurp,
        args: mergedArgs,
        argjson: mergedArgjson,
        env: ctx.env,
      });

      let stdout: string;
      if (joinOutput) {
        stdout = output;
      } else {
        stdout = output.length > 0 ? `${output}\n` : '';
      }

      // Exit status handling
      if (exitStatus) {
        if (output.length === 0) {
          return { exitCode: 4, stdout, stderr: '' };
        }
        // Check last output
        const trimmed = output.trim();
        if (trimmed === 'false' || trimmed === 'null') {
          return { exitCode: 1, stdout, stderr: '' };
        }
      }

      return { exitCode: 0, stdout, stderr: '' };
    } catch (e) {
      if (e instanceof JqHaltError) {
        return {
          exitCode: e.exitCode,
          stdout: '',
          stderr: e.message ? `${e.message}\n` : '',
        };
      }
      if (e instanceof JqParseError) {
        return {
          exitCode: 3,
          stdout: '',
          stderr: `jq: compile error: ${e.message}\n`,
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { exitCode: 5, stdout: '', stderr: `jq: ${msg}\n` };
    }
  },
};
