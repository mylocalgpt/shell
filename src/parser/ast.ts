/**
 * Source position for error reporting.
 */
export interface SourcePosition {
	line: number;
	col: number;
}

// ── Word types (discriminated union) ──

export interface LiteralWord {
	type: 'LiteralWord';
	value: string;
	pos: SourcePosition;
}

export interface QuotedWord {
	type: 'QuotedWord';
	parts: WordPart[];
	quoteType: 'single' | 'double' | 'ansi-c';
	pos: SourcePosition;
}

export interface VariableWord {
	type: 'VariableWord';
	name: string;
	operator: string | null;
	operand: Word | null;
	indirect: boolean;
	length: boolean;
	pos: SourcePosition;
}

export interface CommandSubstitution {
	type: 'CommandSubstitution';
	body: Program;
	backtick: boolean;
	pos: SourcePosition;
}

export interface ArithmeticExpansion {
	type: 'ArithmeticExpansion';
	expression: string;
	pos: SourcePosition;
}

export interface GlobWord {
	type: 'GlobWord';
	pattern: string;
	pos: SourcePosition;
}

export interface BraceExpansion {
	type: 'BraceExpansion';
	parts: BraceExpansionPart[];
	pos: SourcePosition;
}

export interface TildeWord {
	type: 'TildeWord';
	suffix: string;
	pos: SourcePosition;
}

export interface ArraySubscript {
	type: 'ArraySubscript';
	array: string;
	index: Word;
	pos: SourcePosition;
}

export interface ConcatWord {
	type: 'ConcatWord';
	parts: WordPart[];
	pos: SourcePosition;
}

/** Any single word segment. */
export type WordPart =
	| LiteralWord
	| QuotedWord
	| VariableWord
	| CommandSubstitution
	| ArithmeticExpansion
	| GlobWord
	| BraceExpansion
	| TildeWord
	| ArraySubscript;

/** A word (single or compound). */
export type Word = WordPart | ConcatWord;

/** Brace expansion part: either a comma-separated list or a sequence range. */
export type BraceExpansionPart =
	| { type: 'list'; items: Word[] }
	| { type: 'range'; start: string; end: string; incr: number | null };

// ── Conditional expression types (for [[ ]]) ──

export interface UnaryTest {
	type: 'UnaryTest';
	operator: string;
	operand: Word;
	pos: SourcePosition;
}

export interface BinaryTest {
	type: 'BinaryTest';
	operator: string;
	left: Word;
	right: Word;
	pos: SourcePosition;
}

export interface NotExpr {
	type: 'NotExpr';
	expression: ConditionalExpr;
	pos: SourcePosition;
}

export interface AndExpr {
	type: 'AndExpr';
	left: ConditionalExpr;
	right: ConditionalExpr;
	pos: SourcePosition;
}

export interface OrExpr {
	type: 'OrExpr';
	left: ConditionalExpr;
	right: ConditionalExpr;
	pos: SourcePosition;
}

export interface ParenExpr {
	type: 'ParenExpr';
	expression: ConditionalExpr;
	pos: SourcePosition;
}

/** Conditional expression for [[ ]] internals. */
export type ConditionalExpr = UnaryTest | BinaryTest | NotExpr | AndExpr | OrExpr | ParenExpr;

// ── Redirections and heredocs ──

/** Heredoc content. */
export interface HereDoc {
	delimiter: string;
	content: string;
	quoted: boolean;
	stripTabs: boolean;
}

/** I/O redirection. */
export interface Redirection {
	type: 'Redirection';
	operator: string;
	fd: number | null;
	target: Word;
	heredoc: HereDoc | null;
	pos: SourcePosition;
}

// ── Assignment ──

/** Variable assignment (VAR=value or VAR+=value). */
export interface Assignment {
	type: 'Assignment';
	name: string;
	value: Word | ArrayExpression | null;
	append: boolean;
	pos: SourcePosition;
}

// ── Command types ──

/** Simple command: assignments, words, and redirections. */
export interface SimpleCommand {
	type: 'SimpleCommand';
	assignments: Assignment[];
	words: Word[];
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Subshell: ( list ). */
export interface Subshell {
	type: 'Subshell';
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Brace group: { list; }. */
export interface BraceGroup {
	type: 'BraceGroup';
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** If/elif/else/fi. */
export interface IfStatement {
	type: 'IfStatement';
	condition: List;
	then: List;
	elifs: Array<{ condition: List; then: List }>;
	else: List | null;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** For-in loop. */
export interface ForStatement {
	type: 'ForStatement';
	variable: string;
	words: Word[];
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** C-style for loop. */
export interface ForCStatement {
	type: 'ForCStatement';
	init: ArithmeticExpansion;
	test: ArithmeticExpansion;
	update: ArithmeticExpansion;
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** While loop. */
export interface WhileStatement {
	type: 'WhileStatement';
	condition: List;
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Until loop. */
export interface UntilStatement {
	type: 'UntilStatement';
	condition: List;
	body: List;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Single case item (pattern + body). */
export interface CaseItem {
	type: 'CaseItem';
	patterns: Word[];
	body: List | null;
	terminator: ';;' | ';&' | ';;&';
	pos: SourcePosition;
}

/** Case/in/esac. */
export interface CaseStatement {
	type: 'CaseStatement';
	word: Word;
	items: CaseItem[];
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Function definition. */
export interface FunctionDefinition {
	type: 'FunctionDefinition';
	name: string;
	body: CompoundCommand;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** [[ conditional expression ]]. */
export interface ConditionalExpression {
	type: 'ConditionalExpression';
	expression: ConditionalExpr;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Arithmetic command: (( expression )). */
export interface ArithmeticCommand {
	type: 'ArithmeticCommand';
	expression: string;
	redirections: Redirection[];
	pos: SourcePosition;
}

/** Array expression: (word...). */
export interface ArrayExpression {
	type: 'ArrayExpression';
	elements: Word[];
	pos: SourcePosition;
}

/** Any compound command. */
export type CompoundCommand =
	| Subshell
	| BraceGroup
	| IfStatement
	| ForStatement
	| ForCStatement
	| WhileStatement
	| UntilStatement
	| CaseStatement
	| ConditionalExpression
	| ArithmeticCommand;

/** Any command node in the AST. Named CommandNode to avoid conflict with the Command interface. */
export type CommandNode =
	| SimpleCommand
	| Subshell
	| BraceGroup
	| IfStatement
	| ForStatement
	| ForCStatement
	| WhileStatement
	| UntilStatement
	| CaseStatement
	| FunctionDefinition
	| ConditionalExpression
	| ArithmeticCommand;

// ── Pipeline and List ──

/** A pipeline of commands connected by |. */
export interface Pipeline {
	type: 'Pipeline';
	commands: CommandNode[];
	negated: boolean;
	pos: SourcePosition;
}

/** List entry: a pipeline with a connecting operator. */
export interface ListEntry {
	pipeline: Pipeline;
	operator: '&&' | '||' | ';' | '&' | '\n';
}

/** A list of pipelines connected by operators. */
export interface List {
	type: 'List';
	entries: ListEntry[];
	pos: SourcePosition;
}

// ── Program ──

/** Top-level AST node representing a complete bash input. */
export interface Program {
	type: 'Program';
	body: List;
	pos: SourcePosition;
}

/** Base interface for all AST nodes (preserved for backward compatibility). */
export interface BaseNode {
	type: string;
}

/** Root AST type. */
export type AST = Program;

/** Any AST node. */
export type ASTNode =
	| Program
	| List
	| Pipeline
	| CommandNode
	| Assignment
	| Redirection
	| CaseItem
	| ArrayExpression;
