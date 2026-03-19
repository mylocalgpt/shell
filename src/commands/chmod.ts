import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

/**
 * Parse a chmod mode string (octal or symbolic) and apply it to the current mode.
 * Returns the new mode, or null on error.
 */
function parseMode(modeStr: string, currentMode: number): number | null {
  // Octal: 755, 644, 0777
  if (/^[0-7]+$/.test(modeStr)) {
    return Number.parseInt(modeStr, 8);
  }

  // Symbolic: u+x, g-w, o=r, a+rwx, u+x,g-w
  let mode = currentMode;
  const clauses = modeStr.split(',');

  for (let c = 0; c < clauses.length; c++) {
    const clause = clauses[c];
    const result = parseSymbolicClause(clause, mode);
    if (result === null) return null;
    mode = result;
  }

  return mode;
}

function parseSymbolicClause(clause: string, mode: number): number | null {
  let pos = 0;

  // Parse who: u, g, o, a (default to a)
  let userMask = 0;
  let groupMask = 0;
  let otherMask = 0;
  let allMode = false;

  while (pos < clause.length && 'ugoa'.includes(clause[pos])) {
    switch (clause[pos]) {
      case 'u':
        userMask = 1;
        break;
      case 'g':
        groupMask = 1;
        break;
      case 'o':
        otherMask = 1;
        break;
      case 'a':
        allMode = true;
        break;
    }
    pos++;
  }

  // Default to 'a' if no who specified
  if (!userMask && !groupMask && !otherMask && !allMode) {
    allMode = true;
  }

  if (pos >= clause.length) return null;

  // Parse operator: +, -, =
  const operator = clause[pos];
  if (operator !== '+' && operator !== '-' && operator !== '=') return null;
  pos++;

  // Parse perms: r, w, x
  let permBits = 0;
  while (pos < clause.length && 'rwx'.includes(clause[pos])) {
    switch (clause[pos]) {
      case 'r':
        permBits |= 4;
        break;
      case 'w':
        permBits |= 2;
        break;
      case 'x':
        permBits |= 1;
        break;
    }
    pos++;
  }

  // Apply to appropriate positions
  let result = mode;

  if (allMode || userMask) {
    const shifted = permBits << 6;
    if (operator === '+') result |= shifted;
    else if (operator === '-') result &= ~shifted;
    else result = (result & ~(7 << 6)) | shifted;
  }
  if (allMode || groupMask) {
    const shifted = permBits << 3;
    if (operator === '+') result |= shifted;
    else if (operator === '-') result &= ~shifted;
    else result = (result & ~(7 << 3)) | shifted;
  }
  if (allMode || otherMask) {
    if (operator === '+') result |= permBits;
    else if (operator === '-') result &= ~permBits;
    else result = (result & ~7) | permBits;
  }

  return result;
}

export const chmod: Command = {
  name: 'chmod',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    const paths: string[] = [];
    let modeStr = '';

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        for (let j = i + 1; j < args.length; j++) paths.push(args[j]);
        break;
      }
      if (modeStr === '' && !arg.startsWith('/') && !arg.startsWith('.')) {
        modeStr = arg;
      } else {
        paths.push(arg);
      }
    }

    if (modeStr === '' || paths.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'chmod: missing operand\n',
      };
    }

    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < paths.length; i++) {
      const resolved = resolvePath(paths[i], ctx.cwd);
      try {
        const st = ctx.fs.stat(resolved);
        const newMode = parseMode(modeStr, st.mode);
        if (newMode === null) {
          stderr += `chmod: invalid mode: '${modeStr}'\n`;
          exitCode = 1;
          break;
        }
        ctx.fs.chmod(resolved, newMode);
      } catch {
        stderr += `chmod: cannot access '${paths[i]}': No such file or directory\n`;
        exitCode = 1;
      }
    }

    return { exitCode, stdout: '', stderr };
  },
};
