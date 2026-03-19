/** Options for creating an OverlayFs instance. */
export interface OverlayFsOptions {
  /** If set, only these path patterns (glob) are readable from host. */
  allowPaths?: string[];
  /** If set, these path patterns (glob) are blocked from host reads. */
  denyPaths?: string[];
}

/** A single file change with its content. */
export interface FileChange {
  path: string;
  content: string;
}

/** Summary of all changes made in the overlay. */
export interface ChangeSet {
  created: FileChange[];
  modified: FileChange[];
  deleted: string[];
}
