import type { Command, LazyCommandDef } from './types.js';

/**
 * Registry for shell commands with lazy loading support.
 *
 * Commands can be registered as lazy definitions (loaded on first use)
 * or as pre-loaded instances. Third-party commands can be added via
 * defineCommand() for immediate use or register() for lazy loading.
 */
export class CommandRegistry {
  /** Registered lazy command definitions, keyed by name. */
  private readonly definitions: Map<string, LazyCommandDef> = new Map();

  /** Loaded and cached command instances, keyed by name. */
  private readonly cache: Map<string, Command> = new Map();

  /**
   * Callback invoked when a command is not found in definitions or cache.
   * Set this to handle unknown commands (e.g. PATH lookup, aliases).
   * Defaults to null (unknown commands return undefined).
   */
  onUnknownCommand: ((name: string) => Command | undefined) | null = null;

  /**
   * Register a lazy-loaded command definition.
   * The command module is not loaded until the first call to get().
   *
   * @param def - Lazy command definition with name and load function
   */
  register(def: LazyCommandDef): void {
    this.definitions.set(def.name, def);
  }

  /**
   * Load (or return cached) command by name.
   * Checks cache first, then lazy definitions, then onUnknownCommand callback.
   *
   * @param name - Command name to look up
   * @returns The command instance, or undefined if not registered
   */
  async get(name: string): Promise<Command | undefined> {
    // Check cache first
    const cached = this.cache.get(name);
    if (cached) {
      return cached;
    }

    // Check lazy definitions
    const def = this.definitions.get(name);
    if (def) {
      const command = await def.load();
      this.cache.set(name, command);
      return command;
    }

    // Try unknown command callback
    if (this.onUnknownCommand) {
      const command = this.onUnknownCommand(name);
      if (command) {
        this.cache.set(name, command);
        return command;
      }
    }

    return undefined;
  }

  /**
   * Check if a command is registered (without loading it).
   * Returns true if the command is in the cache or in the lazy definitions.
   *
   * @param name - Command name to check
   * @returns true if the command is registered
   */
  has(name: string): boolean {
    return this.cache.has(name) || this.definitions.has(name);
  }

  /**
   * Return a sorted list of all registered command names.
   * Includes both cached and lazy-defined commands.
   *
   * @returns Sorted array of command names
   */
  list(): string[] {
    const names = new Set<string>();
    for (const key of this.definitions.keys()) {
      names.add(key);
    }
    for (const key of this.cache.keys()) {
      names.add(key);
    }
    const result = Array.from(names);
    result.sort();
    return result;
  }

  /**
   * Register a pre-loaded command for immediate use.
   * Bypasses lazy loading and stores directly in the cache.
   * This is the primary API for third-party command registration.
   *
   * @param command - A fully constructed Command instance
   */
  defineCommand(command: Command): void {
    this.cache.set(command.name, command);
  }

  /**
   * Remove all commands except those in the given allowlist.
   * Applies to both lazy definitions and cached commands.
   *
   * @param names - Set of command names to keep
   */
  retainOnly(names: Set<string>): void {
    for (const key of Array.from(this.definitions.keys())) {
      if (!names.has(key)) {
        this.definitions.delete(key);
      }
    }
    for (const key of Array.from(this.cache.keys())) {
      if (!names.has(key)) {
        this.cache.delete(key);
      }
    }
  }
}
