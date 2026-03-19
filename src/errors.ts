/**
 * Error formatting utilities for consistent, LLM-friendly error messages.
 *
 * Shell-level errors use the format:
 *   @mylocalgpt/shell: <component>: <message>
 *   [Alternative: <suggested fix>]
 *
 * Command-level errors use coreutils format:
 *   <command>: <message>
 */

const PREFIX = '@mylocalgpt/shell';

/**
 * Format a shell-level error message.
 *
 * @param message - The error message
 * @param alternative - Optional suggested fix
 * @returns Formatted error string (includes trailing newline)
 */
export function shellError(message: string, alternative?: string): string {
  let result = `${PREFIX}: ${message}\n`;
  if (alternative) {
    result += `Alternative: ${alternative}\n`;
  }
  return result;
}

/**
 * Format a command-level error message (coreutils style).
 *
 * @param command - The command name
 * @param message - The error message
 * @returns Formatted error string (includes trailing newline)
 */
export function commandError(command: string, message: string): string {
  return `${command}: ${message}\n`;
}

/**
 * Format a human-readable limit name from the internal limit key.
 *
 * @param limitName - Internal limit key (e.g. 'maxLoopIterations')
 * @returns Human-readable description and config key
 */
export function formatLimitError(limitName: string, maxValue: number): string {
  const descriptions: Record<string, string> = {
    maxLoopIterations: `maximum loop iterations (${maxValue}) exceeded. Increase with limits.maxLoopIterations`,
    maxCallDepth: `maximum call depth (${maxValue}) exceeded. Increase with limits.maxCallDepth`,
    maxCommandCount: `maximum command count (${maxValue}) exceeded. Increase with limits.maxCommandCount`,
    maxStringLength: `maximum string length (${maxValue}) exceeded. Increase with limits.maxStringLength`,
    maxArraySize: `maximum array size (${maxValue}) exceeded. Increase with limits.maxArraySize`,
    maxOutputSize: `maximum output size (${maxValue}) exceeded. Increase with limits.maxOutputSize`,
    maxPipelineDepth: `maximum pipeline depth (${maxValue}) exceeded. Increase with limits.maxPipelineDepth`,
  };
  return descriptions[limitName] ?? `limit exceeded: ${limitName} (${maxValue})`;
}

/**
 * Find similar command names using simple prefix and substring matching.
 *
 * @param name - The unknown command name
 * @param available - List of available command names
 * @param maxSuggestions - Maximum number of suggestions to return
 * @returns Array of similar command names
 */
export function findSimilarCommands(
  name: string,
  available: string[],
  maxSuggestions = 3,
): string[] {
  if (available.length === 0) return [];

  const scored: Array<{ cmd: string; score: number }> = [];

  for (let i = 0; i < available.length; i++) {
    const cmd = available[i];
    let score = 0;

    // Exact prefix match scores highest
    if (cmd.startsWith(name) || name.startsWith(cmd)) {
      score += 3;
    }

    // Substring match
    if (cmd.includes(name) || name.includes(cmd)) {
      score += 2;
    }

    // Edit distance for short names (Levenshtein-like)
    const dist = simpleDistance(name, cmd);
    if (dist <= 2) {
      score += 3 - dist;
    }

    if (score > 0) {
      scored.push({ cmd, score });
    }
  }

  // Sort by score descending, then alphabetically
  scored.sort((a, b) => b.score - a.score || a.cmd.localeCompare(b.cmd));

  const result: string[] = [];
  for (let i = 0; i < Math.min(scored.length, maxSuggestions); i++) {
    result.push(scored[i].cmd);
  }
  return result;
}

/**
 * Simple edit distance (Levenshtein) for short strings.
 * Only computes for strings where |len_a - len_b| <= 3 to avoid
 * expensive computations on very different strings.
 */
function simpleDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  if (a.length > 20 || b.length > 20) return 99;

  const m = a.length;
  const n = b.length;

  // Use single array DP
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[n];
}
