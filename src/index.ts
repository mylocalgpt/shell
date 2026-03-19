// Types - filesystem
export type { FileStat, FileSystem, LazyFileContent } from './fs/types.js';

// Types - commands
export type {
  Command,
  CommandContext,
  CommandResult,
  LazyCommandDef,
  NetworkConfig,
  NetworkRequest,
  NetworkResponse,
} from './commands/types.js';

// Types - security
export type { ExecutionLimits } from './security/limits.js';

// Types - parser
export type {
  AST,
  ASTNode,
  Assignment,
  BaseNode,
  BraceGroup,
  CaseItem,
  CaseStatement,
  CommandNode,
  CompoundCommand,
  ConcatWord,
  ConditionalExpr,
  ConditionalExpression,
  ForCStatement,
  ForStatement,
  FunctionDefinition,
  HereDoc,
  IfStatement,
  List,
  ListEntry,
  Pipeline,
  Program,
  Redirection,
  SimpleCommand,
  SourcePosition,
  Subshell,
  UntilStatement,
  WhileStatement,
  Word,
  WordPart,
} from './parser/ast.js';
export type { Token, TokenType } from './parser/lexer.js';

// Values - filesystem
export { FsError, InMemoryFs } from './fs/memory.js';

// Values - commands
export { CommandRegistry } from './commands/registry.js';

// Values - security
export { DEFAULT_LIMITS } from './security/limits.js';

// Values - parser
export { Lexer, LexerError, tokenize } from './parser/lexer.js';
export { ParseError, parse } from './parser/parser.js';

// Values - interpreter
export { Interpreter } from './interpreter/interpreter.js';
export {
  BreakSignal,
  ContinueSignal,
  ErrexitError,
  ExitSignal,
  LimitExceededError,
  ReturnSignal,
} from './interpreter/errors.js';
export { registerBuiltins } from './interpreter/builtins.js';

import { registerDefaultCommands } from './commands/defaults.js';
import { CommandRegistry } from './commands/registry.js';
import type { Command, CommandContext, CommandResult, NetworkConfig } from './commands/types.js';
import { InMemoryFs } from './fs/memory.js';
import type { FileSystem, LazyFileContent } from './fs/types.js';
import { registerBuiltins } from './interpreter/builtins.js';
import { Interpreter } from './interpreter/interpreter.js';
import { parse as parseInput } from './parser/parser.js';
import type { ExecutionLimits } from './security/limits.js';

/** Default environment variables for a new shell. */
const DEFAULT_ENV: Record<string, string> = {
  HOME: '/root',
  USER: 'root',
  PATH: '/usr/bin:/bin',
  SHELL: '/bin/bash',
  PWD: '/',
  TERM: 'xterm',
  LANG: 'en_US.UTF-8',
  IFS: ' \t\n',
  BASH_VERSION: '5.2.0(1)-release',
};

/**
 * Handler function for a custom command.
 * Receives the command arguments and context, returns a result.
 *
 * @example
 * ```typescript
 * const handler: CommandHandler = async (args, ctx) => ({
 *   stdout: `Hello ${args[0]}\n`,
 *   stderr: '',
 *   exitCode: 0,
 * });
 * ```
 */
export type CommandHandler = (
  args: string[],
  ctx: CommandContext,
) => Promise<CommandResult> | CommandResult;

/**
 * Options for creating a Shell instance.
 *
 * @example
 * ```typescript
 * const shell = new Shell({
 *   files: {
 *     '/workspace/data.json': '{"key": "value"}',
 *     '/workspace/big.csv': () => fetch('...').then(r => r.text()),
 *   },
 *   env: { HOME: '/home/agent', USER: 'agent' },
 *   limits: { maxLoopIterations: 5000 },
 * });
 * ```
 */
export interface ShellOptions {
  /**
   * Custom filesystem implementation to use instead of the default InMemoryFs.
   * When provided, the `files` option is ignored.
   * Enables injecting any FileSystem implementation (e.g. OverlayFs).
   */
  fs?: FileSystem;
  /**
   * Initial files to populate in the filesystem.
   * Values can be strings (immediate content) or functions (lazy-loaded on first read).
   * Ignored when `fs` is provided.
   */
  files?: Record<string, string | (() => string | Promise<string>)>;
  /** Initial environment variables. Merged with defaults (HOME, USER, PATH, etc.). */
  env?: Record<string, string>;
  /** Execution limits. Merged with DEFAULT_LIMITS. */
  limits?: Partial<ExecutionLimits>;
  /**
   * Custom commands to register.
   * Keys are command names, values are handler functions.
   *
   * @example
   * ```typescript
   * commands: {
   *   'my-tool': async (args, ctx) => ({
   *     stdout: `Ran with ${args.join(' ')}\n`,
   *     stderr: '',
   *     exitCode: 0,
   *   }),
   * }
   * ```
   */
  commands?: Record<string, CommandHandler>;
  /**
   * Callback invoked when a command is not found in the registry.
   * Return a result to handle the command, or let it fall through to the default "not found" error.
   */
  onUnknownCommand?: (
    name: string,
    args: string[],
    ctx: CommandContext,
  ) => Promise<CommandResult> | CommandResult;
  /**
   * Post-processing hook called after each exec() call.
   * Receives the result and returns a (possibly modified) result.
   * Synchronous to prevent unhandled promise rejections.
   *
   * @example
   * ```typescript
   * onOutput: (result) => ({
   *   ...result,
   *   stdout: result.stdout.slice(0, 10000), // truncate
   * })
   * ```
   */
  onOutput?: (result: ExecResult) => ExecResult;
  /**
   * Hook called before each command executes (including each stage of a pipeline).
   * Receives the command name and arguments after word expansion.
   * Return `false` to block the command (exit code 126, "permission denied").
   * Async-capable for external policy checks.
   */
  onBeforeCommand?: (
    cmd: string,
    args: string[],
  ) => boolean | undefined | Promise<boolean | undefined>;
  /**
   * Hook called after each command executes (including each stage of a pipeline).
   * Receives the command name and result. Return a (possibly modified) result.
   * Synchronous to prevent unhandled promise rejections in pipe chains.
   */
  onCommandResult?: (cmd: string, result: CommandResult) => CommandResult;
  /** Hostname for the virtual shell (used by the hostname command). */
  hostname?: string;
  /** Username for the virtual shell (used by the whoami command). */
  username?: string;
  /**
   * Restrict available commands to this allowlist.
   * When set, only the listed commands are available; all others are removed from the registry.
   */
  enabledCommands?: string[];
  /**
   * Network configuration for commands like curl.
   * Provides a handler function for HTTP requests and an optional hostname allowlist.
   * The shell never makes real HTTP requests; all network access is delegated to this handler.
   */
  network?: NetworkConfig;
}

/**
 * Per-call options for Shell.exec().
 *
 * @example
 * ```typescript
 * const result = await shell.exec('echo $INPUT', {
 *   env: { INPUT: 'hello' },
 *   cwd: '/workspace',
 *   timeout: 5000,
 * });
 * ```
 */
export interface ExecOptions {
  /** Additional environment variables for this call only. */
  env?: Record<string, string>;
  /** Override working directory for this call. */
  cwd?: string;
  /** Provide stdin to the command. */
  stdin?: string;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Timeout in milliseconds. Creates an internal AbortSignal. */
  timeout?: number;
}

/**
 * Result of executing a shell command.
 */
export interface ExecResult {
  /** Standard output produced by the command. */
  stdout: string;
  /** Standard error output produced by the command. */
  stderr: string;
  /** Exit code: 0 for success, non-zero for failure. */
  exitCode: number;
}

/**
 * Virtual bash interpreter for AI agents.
 *
 * Executes shell commands against an in-memory filesystem.
 * The filesystem, environment exports, functions, and working directory
 * persist across exec() calls. Shell options (set -e, etc.) reset per call.
 *
 * @example
 * ```typescript
 * import { Shell } from '@mylocalgpt/shell';
 *
 * const shell = new Shell({
 *   files: { '/data.json': '{"name": "alice"}' },
 * });
 *
 * const result = await shell.exec('cat /data.json | jq .name');
 * console.log(result.stdout); // "alice"\n
 * ```
 */
export class Shell {
  private readonly _fs: FileSystem;
  private readonly initialEnv: Map<string, string>;
  private readonly initialCwd: string;
  private readonly _limits: Partial<ExecutionLimits>;
  private readonly registry: CommandRegistry;
  private readonly _onOutput: ((result: ExecResult) => ExecResult) | undefined;
  private readonly _onBeforeCommand:
    | ((cmd: string, args: string[]) => boolean | undefined | Promise<boolean | undefined>)
    | undefined;
  private readonly _onCommandResult:
    | ((cmd: string, result: CommandResult) => CommandResult)
    | undefined;
  private readonly _network: NetworkConfig | undefined;
  private interpreter: Interpreter | null = null;

  constructor(options?: ShellOptions) {
    // Initialize filesystem: use provided fs or create InMemoryFs
    if (options?.fs) {
      this._fs = options.fs;
    } else {
      const fsInstance = new InMemoryFs();
      this._fs = fsInstance;

      // Populate files (supports both string and lazy content)
      if (options?.files) {
        const paths = Object.keys(options.files);
        for (let i = 0; i < paths.length; i++) {
          const filePath = paths[i];
          const content = options.files[filePath];
          if (typeof content === 'function') {
            fsInstance.addLazyFile(filePath, content as () => string | Promise<string>);
          } else {
            fsInstance.writeFile(filePath, content);
          }
        }
      }
    }
    this.initialCwd = '/';
    this._limits = options?.limits ?? {};
    this._onOutput = options?.onOutput;
    this._onBeforeCommand = options?.onBeforeCommand;
    this._onCommandResult = options?.onCommandResult;
    this._network = options?.network;

    // Set up command registry
    this.registry = new CommandRegistry();
    registerDefaultCommands(this.registry);

    // Register custom commands
    if (options?.commands) {
      const names = Object.keys(options.commands);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const handler = options.commands[name];
        this.registry.defineCommand({
          name,
          execute: async (args: string[], ctx: CommandContext) => handler(args, ctx),
        });
      }
    }

    // Wire onUnknownCommand callback
    if (options?.onUnknownCommand) {
      const userCallback = options.onUnknownCommand;
      this.registry.onUnknownCommand = (name: string): Command | undefined => {
        // Create an adapter Command that delegates to the user callback
        return {
          name,
          execute: async (args: string[], ctx: CommandContext) => userCallback(name, args, ctx),
        };
      };
    }

    // Filter to enabled commands only
    if (options?.enabledCommands) {
      const allowed = new Set(options.enabledCommands);
      this.registry.retainOnly(allowed);
    }

    // Build initial env from defaults + user overrides
    this.initialEnv = new Map<string, string>();
    const keys = Object.keys(DEFAULT_ENV);
    for (let i = 0; i < keys.length; i++) {
      this.initialEnv.set(keys[i], DEFAULT_ENV[keys[i]]);
    }

    // Apply hostname and username to env
    if (options?.hostname) {
      this.initialEnv.set('HOSTNAME', options.hostname);
    }
    if (options?.username) {
      this.initialEnv.set('USER', options.username);
    }

    if (options?.env) {
      const userKeys = Object.keys(options.env);
      for (let i = 0; i < userKeys.length; i++) {
        this.initialEnv.set(userKeys[i], options.env[userKeys[i]]);
      }
    }
    // Set PWD to match cwd
    this.initialEnv.set('PWD', this.initialCwd);
  }

  /**
   * Get the filesystem used by this shell.
   * Allows direct read/write access to the virtual filesystem.
   *
   * @example
   * ```typescript
   * shell.fs.writeFile('/test.txt', 'hello');
   * const content = shell.fs.readFile('/test.txt');
   * ```
   */
  get fs(): FileSystem {
    return this._fs;
  }

  /**
   * Get the current working directory.
   */
  get cwd(): string {
    if (this.interpreter) {
      return this.interpreter.getCwd();
    }
    return this.initialCwd;
  }

  /**
   * Get the environment variables as a Map.
   */
  get env(): Map<string, string> {
    if (this.interpreter) {
      return this.interpreter.getEnv();
    }
    return new Map(this.initialEnv);
  }

  /**
   * Get the command registry for registering custom commands.
   *
   * @returns The command registry instance
   */
  getRegistry(): CommandRegistry {
    return this.registry;
  }

  /**
   * Get the filesystem used by this shell.
   *
   * @returns The filesystem instance
   * @deprecated Use the `fs` getter property instead.
   */
  getFs(): FileSystem {
    return this._fs;
  }

  /**
   * Execute a shell command string and return the result.
   * Never throws to the caller. All errors are returned as
   * { stdout, stderr, exitCode }.
   *
   * State persistence: environment exports, functions, working directory,
   * and filesystem persist across calls. Shell options (set -e, etc.)
   * reset to defaults for each call.
   *
   * @param command - The shell command to execute
   * @param options - Per-call options (env, cwd, stdin, signal, timeout)
   * @returns stdout, stderr, and exit code
   *
   * @example
   * ```typescript
   * const result = await shell.exec('echo hello | wc -c');
   * console.log(result.stdout); // "6\n"
   * ```
   */
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    // Check abort signal before parsing
    const signal = this.resolveSignal(options?.signal, options?.timeout);
    if (signal?.aborted) {
      return { exitCode: 130, stdout: '', stderr: '@mylocalgpt/shell: execution aborted\n' };
    }

    // Parse
    let ast: import('./parser/ast.js').Program;
    try {
      ast = parseInput(command);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { exitCode: 2, stdout: '', stderr: `@mylocalgpt/shell: ${msg}\n` };
    }

    // Get or create persistent interpreter
    const interp = this.getOrCreateInterpreter();

    // Reset per-execution counters and shell options
    interp.resetExecution();

    // Apply per-call env overrides
    const env = interp.getEnv();
    const addedKeys: string[] = [];
    const savedValues: Map<string, string | undefined> = new Map();
    if (options?.env) {
      const overrideKeys = Object.keys(options.env);
      for (let i = 0; i < overrideKeys.length; i++) {
        const key = overrideKeys[i];
        savedValues.set(key, env.get(key));
        env.set(key, options.env[key]);
        addedKeys.push(key);
      }
    }

    // Apply per-call cwd override
    const savedCwd = interp.getCwd();
    if (options?.cwd) {
      interp.setCwd(options.cwd);
      env.set('PWD', options.cwd);
    }

    // Execute
    let result: ExecResult;
    try {
      // Check signal before execution
      if (signal?.aborted) {
        return { exitCode: 130, stdout: '', stderr: '@mylocalgpt/shell: execution aborted\n' };
      }
      result = await interp.execute(ast);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = { exitCode: 1, stdout: '', stderr: `@mylocalgpt/shell: ${msg}\n` };
    } finally {
      // Restore per-call env overrides (keep only vars that were exported)
      for (let i = 0; i < addedKeys.length; i++) {
        const key = addedKeys[i];
        const saved = savedValues.get(key);
        if (saved === undefined) {
          // Only remove if it was not exported during execution
          if (!interp.getExportedVars().has(key)) {
            env.delete(key);
          }
        } else {
          // Only restore if it was not modified by the script
          if (!interp.getExportedVars().has(key)) {
            env.set(key, saved);
          }
        }
      }

      // Restore cwd if it was overridden per-call and wasn't changed by the script
      if (options?.cwd && interp.getCwd() === options.cwd) {
        // Script didn't cd, so don't persist the override
        interp.setCwd(savedCwd);
        env.set('PWD', savedCwd);
      }
    }

    // Apply onOutput hook
    if (this._onOutput) {
      result = this._onOutput(result);
    }

    return result;
  }

  /**
   * Register a custom command after construction.
   * The command participates in pipes, redirections, and all shell features.
   *
   * @param name - The command name
   * @param handler - The command handler function
   *
   * @example
   * ```typescript
   * shell.defineCommand('greet', async (args, ctx) => ({
   *   stdout: `Hello ${args[0] ?? 'world'}\n`,
   *   stderr: '',
   *   exitCode: 0,
   * }));
   * await shell.exec('greet Alice | cat');
   * ```
   */
  defineCommand(name: string, handler: CommandHandler): void {
    this.registry.defineCommand({
      name,
      execute: async (args: string[], ctx: CommandContext) => handler(args, ctx),
    });
  }

  /**
   * Reset shell state: clear env to initial values, clear functions,
   * reset cwd to initial. Filesystem is kept intact.
   */
  reset(): void {
    this.interpreter = null;
  }

  /**
   * Create or return the persistent interpreter instance.
   */
  private getOrCreateInterpreter(): Interpreter {
    if (!this.interpreter) {
      const env = new Map(this.initialEnv);
      this.interpreter = new Interpreter(
        this._fs,
        this.registry,
        env,
        this.initialCwd,
        this._limits,
        {
          onBeforeCommand: this._onBeforeCommand,
          onCommandResult: this._onCommandResult,
        },
        this._network,
      );
      registerBuiltins(this.interpreter);
    }
    return this.interpreter;
  }

  /**
   * Resolve the effective AbortSignal from user-provided signal and/or timeout.
   */
  private resolveSignal(userSignal?: AbortSignal, timeout?: number): AbortSignal | undefined {
    if (!userSignal && timeout === undefined) {
      return undefined;
    }

    if (timeout !== undefined && timeout > 0) {
      const timeoutSignal = AbortSignal.timeout(timeout);
      if (userSignal) {
        // Compose: abort when either fires
        return AbortSignal.any([userSignal, timeoutSignal]);
      }
      return timeoutSignal;
    }

    return userSignal;
  }
}

declare const __PACKAGE_VERSION__: string;
export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '0.0.0';
