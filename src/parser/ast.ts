/**
 * Base interface for all AST nodes.
 * Every node has a type discriminator string.
 */
export interface BaseNode {
	/** Discriminator identifying the node kind. */
	type: string;
}

/**
 * Root AST type. Will be expanded with all node types in p2.
 */
export type AST = BaseNode;
