import type { FileSystem } from '../fs/types.js';

/**
 * Test whether a text string matches a glob pattern.
 * Supports: *, ?, [...], [!...], [^...], [a-z] ranges.
 * By default does NOT match / for * and ? (segment-level).
 * Pass slashMatch=true for parameter expansion patterns.
 *
 * @param pattern - The glob pattern
 * @param text - The text to test
 * @param slashMatch - When true, * and ? match / (for parameter expansion)
 * @returns true if the text matches the pattern
 */
export function globMatch(pattern: string, text: string, slashMatch?: boolean): boolean {
  return matchAt(pattern, 0, text, 0, slashMatch ?? false);
}

function matchAt(
  pattern: string,
  startPi: number,
  text: string,
  startTi: number,
  slashMatch: boolean,
): boolean {
  let pi = startPi;
  let ti = startTi;

  while (pi < pattern.length) {
    const pc = pattern[pi];

    if (pc === '*') {
      // Skip consecutive *
      while (pi < pattern.length && pattern[pi] === '*') {
        pi++;
      }

      // Trailing * matches everything (except / when not slashMatch)
      if (pi >= pattern.length) {
        if (!slashMatch) {
          for (let k = ti; k < text.length; k++) {
            if (text[k] === '/') return false;
          }
        }
        return true;
      }

      // Try matching * against 0, 1, 2, ... characters
      for (let k = ti; k <= text.length; k++) {
        if (!slashMatch && k > ti && text[k - 1] === '/') break;
        if (matchAt(pattern, pi, text, k, slashMatch)) return true;
      }
      return false;
    }

    if (pc === '?') {
      if (ti >= text.length || (!slashMatch && text[ti] === '/')) return false;
      pi++;
      ti++;
      continue;
    }

    if (pc === '[') {
      if (ti >= text.length) return false;
      const tc = text[ti];

      pi++; // skip [
      let negated = false;
      if (pi < pattern.length && (pattern[pi] === '!' || pattern[pi] === '^')) {
        negated = true;
        pi++;
      }

      let matched = false;
      let first = true;
      while (pi < pattern.length && (pattern[pi] !== ']' || first)) {
        first = false;
        const rangeStart = pattern[pi];
        pi++;

        // Range: a-z
        if (pi + 1 < pattern.length && pattern[pi] === '-' && pattern[pi + 1] !== ']') {
          const rangeEnd = pattern[pi + 1];
          pi += 2;
          const startCode = rangeStart.charCodeAt(0);
          const endCode = rangeEnd.charCodeAt(0);
          const tcCode = tc.charCodeAt(0);
          if (startCode <= endCode) {
            if (tcCode >= startCode && tcCode <= endCode) matched = true;
          } else {
            if (tcCode >= endCode && tcCode <= startCode) matched = true;
          }
        } else {
          if (tc === rangeStart) matched = true;
        }
      }

      if (pi < pattern.length) pi++; // skip ]

      if (negated ? matched : !matched) return false;
      ti++;
      continue;
    }

    // Literal character
    if (ti >= text.length) return false;
    if (pc !== text[ti]) return false;
    pi++;
    ti++;
  }

  return ti >= text.length;
}

/**
 * Test whether a path matches a glob pattern with ** (globstar) support.
 * ** matches zero or more path segments (directories).
 *
 * @param pattern - Glob pattern possibly containing **
 * @param path - The path to test
 * @returns true if the path matches
 */
export function globMatchPath(pattern: string, path: string): boolean {
  if (!pattern.includes('**')) {
    return globMatch(pattern, path);
  }

  // Split pattern on ** to get segments between globstars
  // For /src/**/*.ts, segments are ['/src/', '/*.ts']
  // but we need to handle the boundaries correctly.
  // Strategy: split pattern and path into /-separated parts, and match with
  // ** consuming zero or more path parts.
  const patParts = splitPathSegments(pattern);
  const pathParts = splitPathSegments(path);
  return matchPathParts(patParts, 0, pathParts, 0);
}

/**
 * Split a path-like string into segments separated by /.
 * Leading / produces an empty first segment.
 */
function splitPathSegments(s: string): string[] {
  if (s.length === 0) return [''];
  return s.split('/');
}

/**
 * Recursively match pattern parts against path parts, with ** support.
 */
function matchPathParts(
  patParts: string[],
  startPi: number,
  pathParts: string[],
  startTi: number,
): boolean {
  let pi = startPi;
  let ti = startTi;

  while (pi < patParts.length && ti < pathParts.length) {
    const pp = patParts[pi];

    if (pp === '**') {
      // ** can match zero or more path segments
      // Try matching zero segments (skip **)
      if (matchPathParts(patParts, pi + 1, pathParts, ti)) return true;
      // Try matching one or more segments (consume one path part, keep **)
      if (matchPathParts(patParts, pi, pathParts, ti + 1)) return true;
      return false;
    }

    // Non-globstar: match this segment with globMatch
    if (!globMatch(pp, pathParts[ti])) return false;
    pi++;
    ti++;
  }

  // Skip trailing ** (they can match zero segments)
  while (pi < patParts.length && patParts[pi] === '**') {
    pi++;
  }

  return pi >= patParts.length && ti >= pathParts.length;
}

/**
 * Expand brace expressions in a pattern into multiple patterns.
 * Handles nested braces: {a,{b,c}} becomes [a, b, c].
 *
 * @param pattern - Pattern potentially containing brace expressions
 * @returns Array of expanded patterns
 */
export function expandBraces(pattern: string): string[] {
  // Find the first top-level { ... } pair
  let depth = 0;
  let braceStart = -1;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (ch === '{') {
      if (depth === 0) braceStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && braceStart >= 0) {
        const prefix = pattern.slice(0, braceStart);
        const suffix = pattern.slice(i + 1);
        const inner = pattern.slice(braceStart + 1, i);

        // Split inner on top-level commas
        const alternatives = splitBraceAlternatives(inner);
        if (alternatives.length <= 1) {
          // Not a valid brace expansion (no commas), treat as literal
          return [pattern];
        }

        const results: string[] = [];
        for (let a = 0; a < alternatives.length; a++) {
          // Recursively expand each alternative
          const expanded = expandBraces(prefix + alternatives[a] + suffix);
          for (let e = 0; e < expanded.length; e++) {
            results.push(expanded[e]);
          }
        }
        return results;
      }
    }
  }

  return [pattern];
}

/**
 * Split brace content on top-level commas, respecting nested braces.
 */
function splitBraceAlternatives(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/**
 * Check if a filename is a dot file (starts with `.`).
 */
function isDotFile(name: string): boolean {
  return name.length > 0 && name[0] === '.';
}

/**
 * Check if a glob pattern segment explicitly targets dot files.
 * A segment targets dot files if it starts with `.` or a char class/brace that includes `.`.
 */
function segmentTargetsDot(segment: string): boolean {
  if (segment.length === 0) return false;
  if (segment[0] === '.') return true;
  if (segment[0] === '[') {
    // Check if char class could match `.`
    return true; // Conservative: if pattern starts with char class, allow dot files
  }
  return false;
}

/**
 * Join path segments, ensuring no double slashes and proper root handling.
 */
function joinPath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

/**
 * Expand a glob pattern against a virtual filesystem.
 * Returns sorted array of matching absolute paths.
 *
 * @param pattern - Glob pattern (absolute path with wildcards)
 * @param fs - Virtual filesystem to walk
 * @param cwd - Current working directory for resolving relative patterns
 * @returns Sorted array of matching paths
 */
export function globExpand(pattern: string, fs: FileSystem, cwd: string): string[] {
  if (pattern.length === 0) return [];

  // Expand braces first
  const patterns = expandBraces(pattern);
  const resultSet = new Set<string>();

  for (let p = 0; p < patterns.length; p++) {
    let pat = patterns[p];
    // Make pattern absolute
    if (!pat.startsWith('/')) {
      pat = cwd === '/' ? `/${pat}` : `${cwd}/${pat}`;
    }

    const matches = expandSinglePattern(pat, fs);
    for (let m = 0; m < matches.length; m++) {
      resultSet.add(matches[m]);
    }
  }

  const result = Array.from(resultSet);
  result.sort();
  return result;
}

/**
 * Expand a single absolute glob pattern (no braces) against the FS.
 */
function expandSinglePattern(pattern: string, fs: FileSystem): string[] {
  // If no wildcards, just check if the path exists
  if (!hasGlobChars(pattern)) {
    if (fs.exists(pattern)) return [pattern];
    return [];
  }

  // For globstar patterns, use recursive walk + globMatchPath
  if (pattern.includes('**')) {
    return expandGlobstar(pattern, fs);
  }

  // Split pattern into segments and walk directory-by-directory
  const segments = pattern.split('/');
  // segments[0] is '' (from leading /)
  return expandSegments(segments, 1, '/', fs);
}

/**
 * Check if a string contains glob special characters.
 */
function hasGlobChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*' || c === '?' || c === '[') return true;
  }
  return false;
}

/**
 * Recursively expand glob segments against the FS.
 */
function expandSegments(
  segments: string[],
  index: number,
  currentPath: string,
  fs: FileSystem,
): string[] {
  if (index >= segments.length) {
    return [currentPath];
  }

  const segment = segments[index];
  const isLast = index === segments.length - 1;

  // If no wildcards in this segment, just append and continue
  if (!hasGlobChars(segment)) {
    const nextPath = joinPath(currentPath, segment);
    if (!fs.exists(nextPath)) return [];
    if (isLast) return [nextPath];
    return expandSegments(segments, index + 1, nextPath, fs);
  }

  // Wildcard segment: list directory and filter
  let entries: string[];
  try {
    entries = fs.readdir(currentPath);
  } catch {
    return [];
  }

  const allowDot = segmentTargetsDot(segment);
  const results: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Skip dot files unless pattern explicitly targets them
    if (isDotFile(entry) && !allowDot) continue;

    if (globMatch(segment, entry)) {
      const nextPath = joinPath(currentPath, entry);
      if (isLast) {
        results.push(nextPath);
      } else {
        // Need to recurse into directories
        try {
          const st = fs.stat(nextPath);
          if (st.isDirectory()) {
            const sub = expandSegments(segments, index + 1, nextPath, fs);
            for (let s = 0; s < sub.length; s++) {
              results.push(sub[s]);
            }
          }
        } catch {
          // stat failed, skip
        }
      }
    }
  }

  return results;
}

/**
 * Expand a pattern containing ** by walking the entire tree
 * and testing each path with globMatchPath.
 */
function expandGlobstar(pattern: string, fs: FileSystem): string[] {
  // Find the common prefix (the part before any wildcards)
  const segments = pattern.split('/');
  let baseDir = '/';
  let segIdx = 1; // skip leading empty segment

  // Walk non-wildcard segments to find the base directory
  while (segIdx < segments.length && !hasGlobChars(segments[segIdx])) {
    baseDir = joinPath(baseDir, segments[segIdx]);
    segIdx++;
  }

  if (!fs.exists(baseDir)) return [];

  // Walk the entire tree from baseDir
  const allPaths: string[] = [];
  collectPaths(baseDir, fs, allPaths);

  // Match each path against the full pattern
  const results: string[] = [];
  for (let i = 0; i < allPaths.length; i++) {
    if (globMatchPath(pattern, allPaths[i])) {
      // Check dot-file visibility for each path component under the wildcard portion
      if (shouldIncludePath(allPaths[i], baseDir, pattern)) {
        results.push(allPaths[i]);
      }
    }
  }

  return results;
}

/**
 * Check if a matched path should be included based on dot-file rules.
 * Parts of the path below the wildcard base must not be dot files
 * unless the pattern explicitly targets them.
 */
function shouldIncludePath(path: string, baseDir: string, pattern: string): boolean {
  // Get the part of the path beyond the base directory
  let relativePart: string;
  if (baseDir === '/') {
    relativePart = path.slice(1);
  } else {
    relativePart = path.slice(baseDir.length + 1);
  }

  if (relativePart.length === 0) return true;

  const pathParts = relativePart.split('/');
  // Get pattern segments after the base
  const patternAfterBase = pattern.slice(baseDir === '/' ? 1 : baseDir.length + 1);
  const patternParts = patternAfterBase.split('/');

  for (let i = 0; i < pathParts.length; i++) {
    if (isDotFile(pathParts[i])) {
      // Find corresponding pattern part
      const patIdx = i < patternParts.length ? i : patternParts.length - 1;
      const patPart = patternParts[patIdx];
      if (patPart !== '**' && !segmentTargetsDot(patPart)) {
        return false;
      }
      if (patPart === '**') {
        // ** does not match dot files by default
        return false;
      }
    }
  }
  return true;
}

/**
 * Recursively collect all paths under a directory.
 */
function collectPaths(dir: string, fs: FileSystem, results: string[]): void {
  results.push(dir);

  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const childPath = joinPath(dir, entries[i]);
    results.push(childPath);

    try {
      const st = fs.stat(childPath);
      if (st.isDirectory()) {
        // Recurse into subdirectories (readdir already done above via collectPaths)
        collectPathsRecursive(childPath, fs, results);
      }
    } catch {
      // skip
    }
  }
}

/**
 * Collect paths recursively (for nested directories).
 */
function collectPathsRecursive(dir: string, fs: FileSystem, results: string[]): void {
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const childPath = joinPath(dir, entries[i]);
    results.push(childPath);

    try {
      const st = fs.stat(childPath);
      if (st.isDirectory()) {
        collectPathsRecursive(childPath, fs, results);
      }
    } catch {
      // skip
    }
  }
}
