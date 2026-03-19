import { globMatch } from '../utils/glob.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith('/')) return p;
  return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

function joinPath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

interface Predicate {
  type: string;
  value?: string;
  numValue?: number;
  sizeOp?: '+' | '-' | '=';
  negated?: boolean;
}

interface FindAction {
  type: 'print' | 'exec' | 'exec-batch';
  cmd?: string;
}

function parseSizeSpec(spec: string): { op: '+' | '-' | '='; bytes: number } {
  let op: '+' | '-' | '=' = '=';
  let s = spec;
  if (s[0] === '+') {
    op = '+';
    s = s.slice(1);
  } else if (s[0] === '-') {
    op = '-';
    s = s.slice(1);
  }

  let multiplier = 512; // default: 512-byte blocks
  if (s.endsWith('c')) {
    multiplier = 1;
    s = s.slice(0, -1);
  } else if (s.endsWith('k')) {
    multiplier = 1024;
    s = s.slice(0, -1);
  } else if (s.endsWith('M')) {
    multiplier = 1024 * 1024;
    s = s.slice(0, -1);
  } else if (s.endsWith('G')) {
    multiplier = 1024 * 1024 * 1024;
    s = s.slice(0, -1);
  }

  return { op, bytes: Number.parseInt(s, 10) * multiplier };
}

export const find: Command = {
  name: 'find',
  async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
    const searchRoots: string[] = [];
    const predicates: Predicate[] = [];
    const actions: FindAction[] = [];
    let maxDepth = Number.POSITIVE_INFINITY;
    let negateNext = false;

    let i = 0;
    // Collect search roots (args before first predicate)
    while (i < args.length && !args[i].startsWith('-') && args[i] !== '(' && args[i] !== '!') {
      searchRoots.push(args[i]);
      i++;
    }

    if (searchRoots.length === 0) {
      searchRoots.push('.');
    }

    // Parse predicates and actions
    while (i < args.length) {
      const arg = args[i];
      i++;

      if (arg === '!' || arg === '-not') {
        negateNext = !negateNext;
        continue;
      }

      if (arg === '-o' || arg === '-or') {
        // OR - simplified: we don't fully implement boolean logic
        continue;
      }

      if (arg === '-and' || arg === '-a') {
        continue;
      }

      if (arg === '-maxdepth' && i < args.length) {
        maxDepth = Number.parseInt(args[i], 10);
        i++;
        continue;
      }

      if (arg === '-name' && i < args.length) {
        predicates.push({ type: 'name', value: args[i], negated: negateNext });
        negateNext = false;
        i++;
        continue;
      }

      if (arg === '-path' && i < args.length) {
        predicates.push({ type: 'path', value: args[i], negated: negateNext });
        negateNext = false;
        i++;
        continue;
      }

      if (arg === '-type' && i < args.length) {
        predicates.push({ type: 'type', value: args[i], negated: negateNext });
        negateNext = false;
        i++;
        continue;
      }

      if (arg === '-size' && i < args.length) {
        const spec = parseSizeSpec(args[i]);
        predicates.push({
          type: 'size',
          numValue: spec.bytes,
          sizeOp: spec.op,
          negated: negateNext,
        });
        negateNext = false;
        i++;
        continue;
      }

      if (arg === '-newer' && i < args.length) {
        predicates.push({ type: 'newer', value: args[i], negated: negateNext });
        negateNext = false;
        i++;
        continue;
      }

      if (arg === '-print') {
        actions.push({ type: 'print' });
        continue;
      }

      if (arg === '-exec' && i < args.length) {
        const cmdParts: string[] = [];
        let batch = false;
        while (i < args.length) {
          if (args[i] === ';' || args[i] === '\\;') {
            i++;
            break;
          }
          if (args[i] === '+') {
            batch = true;
            i++;
            break;
          }
          cmdParts.push(args[i]);
          i++;
        }
        actions.push({
          type: batch ? 'exec-batch' : 'exec',
          cmd: cmdParts.join(' '),
        });
      }
    }

    // Default action
    if (actions.length === 0) {
      actions.push({ type: 'print' });
    }

    // Walk and collect matches
    const matches: string[] = [];
    let stderr = '';

    for (let r = 0; r < searchRoots.length; r++) {
      const root = resolvePath(searchRoots[r], ctx.cwd);
      const displayRoot = searchRoots[r];

      if (!ctx.fs.exists(root)) {
        stderr += `find: '${searchRoots[r]}': No such file or directory\n`;
        continue;
      }
      walkDir(root, displayRoot, 0, maxDepth, predicates, ctx, matches);
    }

    // Execute actions
    let stdout = '';
    const batchPaths: string[] = [];

    for (let m = 0; m < matches.length; m++) {
      for (let a = 0; a < actions.length; a++) {
        const action = actions[a];
        if (action.type === 'print') {
          stdout += `${matches[m]}\n`;
        } else if (action.type === 'exec' && action.cmd) {
          const cmd = action.cmd.replace(/\{}/g, shellQuote(matches[m]));
          const result = await ctx.exec(cmd);
          stdout += result.stdout;
          stderr += result.stderr;
        } else if (action.type === 'exec-batch') {
          batchPaths.push(matches[m]);
        }
      }
    }

    // Execute batch actions
    if (batchPaths.length > 0) {
      for (let a = 0; a < actions.length; a++) {
        const action = actions[a];
        if (action.type === 'exec-batch' && action.cmd) {
          const quotedPaths = batchPaths.map(shellQuote).join(' ');
          const cmd = action.cmd.replace(/\{}/g, quotedPaths);
          const result = await ctx.exec(cmd);
          stdout += result.stdout;
          stderr += result.stderr;
        }
      }
    }

    return { exitCode: stderr.length > 0 ? 1 : 0, stdout, stderr };
  },
};

function walkDir(
  absPath: string,
  displayPath: string,
  depth: number,
  maxDepth: number,
  predicates: Predicate[],
  ctx: CommandContext,
  matches: string[],
): void {
  if (depth > maxDepth) return;

  // Test current path against predicates
  if (matchesPredicates(absPath, displayPath, predicates, ctx)) {
    matches.push(displayPath);
  }

  if (depth >= maxDepth) return;

  // Recurse into directories
  try {
    const st = ctx.fs.stat(absPath);
    if (!st.isDirectory()) return;
  } catch {
    return;
  }

  let entries: string[];
  try {
    entries = ctx.fs.readdir(absPath);
  } catch {
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const childAbs = joinPath(absPath, entries[i]);
    const childDisplay =
      displayPath === '.' ? `./${entries[i]}` : joinPath(displayPath, entries[i]);
    walkDir(childAbs, childDisplay, depth + 1, maxDepth, predicates, ctx, matches);
  }
}

function matchesPredicates(
  absPath: string,
  displayPath: string,
  predicates: Predicate[],
  ctx: CommandContext,
): boolean {
  if (predicates.length === 0) return true;

  for (let i = 0; i < predicates.length; i++) {
    const pred = predicates[i];
    let result = testPredicate(pred, absPath, displayPath, ctx);
    if (pred.negated) result = !result;
    if (!result) return false;
  }
  return true;
}

function testPredicate(
  pred: Predicate,
  absPath: string,
  displayPath: string,
  ctx: CommandContext,
): boolean {
  switch (pred.type) {
    case 'name':
      return globMatch(pred.value ?? '', basename(absPath));
    case 'path':
      return globMatch(pred.value ?? '', displayPath);
    case 'type': {
      try {
        const st = ctx.fs.stat(absPath);
        if (pred.value === 'f') return st.isFile();
        if (pred.value === 'd') return st.isDirectory();
      } catch {
        return false;
      }
      return false;
    }
    case 'size': {
      try {
        const st = ctx.fs.stat(absPath);
        if (!st.isFile()) return false;
        const bytes = pred.numValue ?? 0;
        if (pred.sizeOp === '+') return st.size > bytes;
        if (pred.sizeOp === '-') return st.size < bytes;
        return st.size === bytes;
      } catch {
        return false;
      }
    }
    case 'newer': {
      try {
        const refPath = resolvePath(pred.value ?? '', '/');
        const refSt = ctx.fs.stat(refPath);
        const st = ctx.fs.stat(absPath);
        return st.mtime > refSt.mtime;
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}
