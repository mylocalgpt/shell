/**
 * Map of built-in shell commands (cd, export, set, etc.).
 * These are handled directly by the interpreter rather than
 * going through the command registry.
 *
 * Empty for now - will be populated in p2.
 */
export const BUILTINS: Map<string, (...args: unknown[]) => unknown> = new Map();
