/**
 * Myers diff algorithm producing unified diff output.
 * Line-based comparison: splits on \n, compares line by line.
 */

/**
 * Options for unified diff output.
 */
export interface DiffOptions {
  /** Number of context lines around changes (default: 3). */
  context?: number;
  /** Label for the original file (default: "a"). */
  labelA?: string;
  /** Label for the modified file (default: "b"). */
  labelB?: string;
}

/**
 * Compute a unified diff between two strings.
 * Returns empty string if files are identical.
 *
 * @param a - The original string
 * @param b - The modified string
 * @param opts - Output options (context lines, labels)
 * @returns Unified diff output
 */
export function unifiedDiff(a: string, b: string, opts?: DiffOptions): string {
  if (a === b) return '';

  const context = opts?.context ?? 3;
  const labelA = opts?.labelA ?? 'a';
  const labelB = opts?.labelB ?? 'b';

  const aLines = splitLines(a);
  const bLines = splitLines(b);

  const edits = computeEdits(aLines, bLines);
  const hunks = buildHunks(edits, aLines, bLines, context);

  if (hunks.length === 0) return '';

  let output = `--- ${labelA}\n`;
  output += `+++ ${labelB}\n`;

  for (let h = 0; h < hunks.length; h++) {
    output += hunks[h];
  }

  // Handle no trailing newline markers
  const aEndsNewline = a.length > 0 && a[a.length - 1] === '\n';
  const bEndsNewline = b.length > 0 && b[b.length - 1] === '\n';

  if (!aEndsNewline || !bEndsNewline) {
    output += '\\ No newline at end of file\n';
  }

  return output;
}

/**
 * Check if two strings differ.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if the strings are different
 */
export function briefDiff(a: string, b: string): boolean {
  return a !== b;
}

/**
 * Compute a unified diff between two strings.
 * Legacy export for backward compatibility.
 *
 * @param a - The first string (original)
 * @param b - The second string (modified)
 * @returns Unified diff output
 */
export function diff(a: string, b: string): string {
  return unifiedDiff(a, b);
}

/** Edit operation type. */
const KEEP = 0;
const INSERT = 1;
const DELETE = 2;

interface EditEntry {
  type: number;
  aIdx: number; // line index in a (-1 for insert)
  bIdx: number; // line index in b (-1 for delete)
}

/**
 * Split a string into lines. Trailing newline does not produce an extra element.
 */
function splitLines(s: string): string[] {
  if (s.length === 0) return [];
  const lines = s.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Compute the shortest edit script using Myers' algorithm.
 * Returns a sequence of KEEP/INSERT/DELETE operations.
 */
function computeEdits(aLines: string[], bLines: string[]): EditEntry[] {
  const n = aLines.length;
  const m = bLines.length;

  if (n === 0 && m === 0) return [];

  if (n === 0) {
    const edits: EditEntry[] = [];
    for (let i = 0; i < m; i++) {
      edits.push({ type: INSERT, aIdx: -1, bIdx: i });
    }
    return edits;
  }

  if (m === 0) {
    const edits: EditEntry[] = [];
    for (let i = 0; i < n; i++) {
      edits.push({ type: DELETE, aIdx: i, bIdx: -1 });
    }
    return edits;
  }

  // Myers algorithm
  const max = n + m;
  const offset = max;
  const size = 2 * max + 1;

  // Current V array
  const v = new Array<number>(size).fill(0);
  v[offset + 1] = 0;

  // Store trace for backtracking
  const trace: Array<Int32Array> = [];

  for (let d = 0; d <= max; d++) {
    // Save V state
    const snap = new Int32Array(size);
    for (let i = 0; i < size; i++) snap[i] = v[i];
    trace.push(snap);

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // down move (insert)
      } else {
        x = v[k - 1 + offset] + 1; // right move (delete)
      }
      let y = x - k;

      // Follow diagonal (equal lines)
      while (x < n && y < m && aLines[x] === bLines[y]) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) {
        // Found the shortest path - backtrack
        return backtrack(trace, d, aLines, bLines, offset);
      }
    }
  }

  // Should never reach here
  return [];
}

/**
 * Backtrack through the trace to recover the edit script.
 */
function backtrack(
  trace: Array<Int32Array>,
  d: number,
  aLines: string[],
  bLines: string[],
  offset: number,
): EditEntry[] {
  const n = aLines.length;
  const m = bLines.length;

  let x = n;
  let y = m;
  const edits: EditEntry[] = [];

  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const k = x - y;

    let prevK: number;
    if (k === -step || (k !== step && v[k - 1 + offset] < v[k + 1 + offset])) {
      prevK = k + 1; // came from insert (down)
    } else {
      prevK = k - 1; // came from delete (right)
    }

    const prevX = v[prevK + offset];
    const prevY = prevX - prevK;

    // Diagonal moves (equal lines)
    let cx = x;
    let cy = y;
    while (cx > prevX && cy > prevY) {
      cx--;
      cy--;
      edits.push({ type: KEEP, aIdx: cx, bIdx: cy });
    }

    // The actual edit
    if (prevK === k + 1) {
      // Insert: y decreased by 1, x stayed
      edits.push({ type: INSERT, aIdx: -1, bIdx: prevY });
    } else {
      // Delete: x decreased by 1, y stayed
      edits.push({ type: DELETE, aIdx: prevX, bIdx: -1 });
    }

    x = prevX;
    y = prevY;
  }

  // Remaining diagonal at the start
  while (x > 0 && y > 0) {
    x--;
    y--;
    edits.push({ type: KEEP, aIdx: x, bIdx: y });
  }

  edits.reverse();
  return edits;
}

/**
 * Build hunks from the edit script.
 * Returns an array of formatted hunk strings.
 */
function buildHunks(
  edits: EditEntry[],
  aLines: string[],
  bLines: string[],
  context: number,
): string[] {
  // Find indices of changes
  const changeIndices: number[] = [];
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== KEEP) {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) return [];

  // Group changes into ranges with context
  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = Math.max(0, changeIndices[0] - context);
  let groupEnd = Math.min(edits.length, changeIndices[0] + 1 + context);

  for (let i = 1; i < changeIndices.length; i++) {
    const rangeStart = Math.max(0, changeIndices[i] - context);
    const rangeEnd = Math.min(edits.length, changeIndices[i] + 1 + context);

    if (rangeStart <= groupEnd) {
      // Merge with current group
      groupEnd = rangeEnd;
    } else {
      groups.push({ start: groupStart, end: groupEnd });
      groupStart = rangeStart;
      groupEnd = rangeEnd;
    }
  }
  groups.push({ start: groupStart, end: groupEnd });

  // Build hunk strings
  const hunks: string[] = [];
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    let aStart = -1;
    let bStart = -1;
    let aCount = 0;
    let bCount = 0;
    let body = '';

    for (let i = group.start; i < group.end; i++) {
      const edit = edits[i];
      switch (edit.type) {
        case KEEP: {
          const line = aLines[edit.aIdx];
          body += ` ${line}\n`;
          if (aStart === -1) aStart = edit.aIdx;
          if (bStart === -1) bStart = edit.bIdx;
          aCount++;
          bCount++;
          break;
        }
        case DELETE: {
          const line = aLines[edit.aIdx];
          body += `-${line}\n`;
          if (aStart === -1) aStart = edit.aIdx;
          if (bStart === -1) {
            // Find next b index
            for (let j = i + 1; j < group.end; j++) {
              if (edits[j].bIdx >= 0) {
                bStart = edits[j].bIdx;
                break;
              }
            }
            if (bStart === -1) bStart = edit.aIdx;
          }
          aCount++;
          break;
        }
        case INSERT: {
          const line = bLines[edit.bIdx];
          body += `+${line}\n`;
          if (bStart === -1) bStart = edit.bIdx;
          if (aStart === -1) {
            // Find next a index
            for (let j = i + 1; j < group.end; j++) {
              if (edits[j].aIdx >= 0) {
                aStart = edits[j].aIdx;
                break;
              }
            }
            if (aStart === -1) aStart = 0;
          }
          bCount++;
          break;
        }
      }
    }

    const aRange = aCount === 1 ? String(aStart + 1) : `${String(aStart + 1)},${String(aCount)}`;
    const bRange = bCount === 1 ? String(bStart + 1) : `${String(bStart + 1)},${String(bCount)}`;

    hunks.push(`@@ -${aRange} +${bRange} @@\n${body}`);
  }

  return hunks;
}
