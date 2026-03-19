/**
 * Configurable limits for script execution.
 * Prevents runaway scripts from consuming unbounded resources.
 */
export interface ExecutionLimits {
  /** Maximum iterations allowed in a single loop (for, while, until). Default: 10,000. */
  maxLoopIterations: number;
  /** Maximum depth of nested function/subshell calls. Default: 100. */
  maxCallDepth: number;
  /** Maximum total number of commands executed in a single exec() call. Default: 10,000. */
  maxCommandCount: number;
  /** Maximum length of any single string value. Default: 10,000,000 (~10MB). */
  maxStringLength: number;
  /** Maximum number of elements in an array. Default: 100,000. */
  maxArraySize: number;
  /** Maximum total size of stdout + stderr output. Default: 10,000,000 (~10MB). */
  maxOutputSize: number;
  /** Maximum depth of nested pipelines. Default: 100. */
  maxPipelineDepth: number;
}

/**
 * Default execution limits.
 * These provide reasonable bounds for typical AI agent workloads
 * while preventing resource exhaustion.
 */
export const DEFAULT_LIMITS: ExecutionLimits = {
  maxLoopIterations: 10_000,
  maxCallDepth: 100,
  maxCommandCount: 10_000,
  maxStringLength: 10_000_000,
  maxArraySize: 100_000,
  maxOutputSize: 10_000_000,
  maxPipelineDepth: 100,
};
