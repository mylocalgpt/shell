import type { CommandResult } from '../src/commands/types.js';
import { InMemoryFs } from '../src/fs/memory.js';

/**
 * A test shell wrapper providing a clean filesystem and exec method.
 */
export interface TestShell {
  /** Execute a shell command and return the result. */
  exec(cmd: string): Promise<CommandResult>;
  /** The in-memory filesystem used by this test shell. */
  fs: InMemoryFs;
}

/**
 * Create a test shell instance with an in-memory filesystem.
 * The exec method is a stub that throws "not implemented" until p2
 * provides a real interpreter.
 *
 * @param options - Optional initial files to populate the filesystem
 * @returns A TestShell with fs and exec
 */
export function createTestShell(options?: { files?: Record<string, string> }): TestShell {
  const fs = new InMemoryFs(options?.files);

  return {
    fs,
    async exec(_cmd: string): Promise<CommandResult> {
      throw new Error('not implemented: TestShell.exec (interpreter not yet available)');
    },
  };
}
