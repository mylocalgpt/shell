import type { FileSystem } from '../fs/types.js';

/**
 * Result of executing a command.
 */
export interface CommandResult {
  /** Standard output produced by the command. */
  stdout: string;
  /** Standard error output produced by the command. */
  stderr: string;
  /** Exit code: 0 for success, non-zero for failure. */
  exitCode: number;
}

/**
 * Context provided to a command during execution.
 * Contains the filesystem, environment, and ability to execute subcommands.
 */
export interface CommandContext {
  /** The virtual filesystem for file operations. */
  fs: FileSystem;
  /** Current working directory (absolute path). */
  cwd: string;
  /**
   * Environment variables.
   * Uses Map instead of a plain object to prevent prototype pollution.
   */
  env: Map<string, string>;
  /** Standard input available to the command. */
  stdin: string;
  /**
   * Execute a subcommand string and return its result.
   * Enables command implementations to invoke other commands.
   */
  exec: (cmd: string) => Promise<CommandResult>;
}

/**
 * A command that can be executed in the virtual shell.
 * This is a first-class public type that third parties can implement
 * to register custom commands.
 */
export interface Command {
  /** The command name (e.g. "cat", "grep", "jq"). */
  name: string;
  /**
   * Execute the command with the given arguments and context.
   *
   * @param args - Command-line arguments (does not include the command name)
   * @param ctx - Execution context with filesystem, env, stdin, etc.
   * @returns The command result with stdout, stderr, and exit code
   */
  execute(args: string[], ctx: CommandContext): Promise<CommandResult>;
}

/**
 * A lazy-loaded command definition.
 * The command module is loaded only on first use via the load() function,
 * enabling dynamic import and reducing initial bundle evaluation cost.
 */
export interface LazyCommandDef {
  /** The command name. Must be unique within a registry. */
  name: string;
  /**
   * Load the command implementation.
   * Called once on first use; the result is cached by the registry.
   */
  load: () => Promise<Command>;
}
