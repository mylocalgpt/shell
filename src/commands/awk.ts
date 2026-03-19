/**
 * awk - Field extraction subset.
 *
 * Supported: BEGIN/END blocks, /regex/ patterns, expression patterns,
 * {print}, field references ($0..$NF), NR/NF/FS/OFS/RS/ORS/FILENAME,
 * arithmetic, comparisons, string concat, length/substr/index/split/sub/gsub/
 * tolower/toupper/sprintf, -F flag.
 *
 * Not supported: associative arrays, user-defined functions, getline,
 * multiple input files, pipes in awk. These produce actionable errors.
 */

import { checkRegexSafety } from '../security/regex.js';
import { formatPrintf } from '../utils/printf.js';
import type { Command, CommandContext, CommandResult } from './types.js';

function resolvePath(p: string, cwd: string): string {
	if (p.startsWith('/')) return p;
	return cwd === '/' ? `/${p}` : `${cwd}/${p}`;
}

interface AwkRule {
	type: 'begin' | 'end' | 'pattern';
	pattern?: string; // regex pattern string or expression
	patternRegex?: RegExp;
	action: string;
}

function parseAwkProgram(program: string): AwkRule[] {
	const rules: AwkRule[] = [];
	let i = 0;

	const skipWs = (): void => {
		while (
			i < program.length &&
			(program[i] === ' ' || program[i] === '\t' || program[i] === '\n' || program[i] === '\r')
		) {
			i++;
		}
	};

	while (i < program.length) {
		skipWs();
		if (i >= program.length) break;

		// Check for BEGIN
		if (program.slice(i, i + 5) === 'BEGIN') {
			i += 5;
			skipWs();
			const action = extractBlock(program, i);
			i = action.end;
			rules.push({ type: 'begin', action: action.body });
			continue;
		}

		// Check for END
		if (program.slice(i, i + 3) === 'END') {
			i += 3;
			skipWs();
			const action = extractBlock(program, i);
			i = action.end;
			rules.push({ type: 'end', action: action.body });
			continue;
		}

		// Check for /regex/ pattern
		if (program[i] === '/') {
			let pat = '';
			i++; // skip /
			while (i < program.length && program[i] !== '/') {
				if (program[i] === '\\' && i + 1 < program.length) {
					pat += program[i] + program[i + 1];
					i += 2;
				} else {
					pat += program[i];
					i++;
				}
			}
			if (i < program.length) i++; // skip /
			skipWs();
			const action = extractBlock(program, i);
			i = action.end;
			let regex: RegExp | undefined;
			const regexSafety = checkRegexSafety(pat);
			if (regexSafety) {
				// unsafe regex - skip this rule
			} else {
				try {
					regex = new RegExp(pat);
				} catch {
					// invalid regex
				}
			}
			rules.push({ type: 'pattern', pattern: pat, patternRegex: regex, action: action.body });
			continue;
		}

		// Check for bare action block
		if (program[i] === '{') {
			const action = extractBlock(program, i);
			i = action.end;
			rules.push({ type: 'pattern', action: action.body });
			continue;
		}

		// Expression pattern (e.g., NR==1, $1>5)
		let expr = '';
		while (i < program.length && program[i] !== '{') {
			expr += program[i];
			i++;
		}
		const action = extractBlock(program, i);
		i = action.end;
		rules.push({ type: 'pattern', pattern: expr.trim(), action: action.body });
	}

	return rules;
}

function extractBlock(program: string, pos: number): { body: string; end: number } {
	if (pos >= program.length || program[pos] !== '{') {
		return { body: 'print', end: pos };
	}

	let depth = 1;
	let i = pos + 1;
	let body = '';

	while (i < program.length && depth > 0) {
		if (program[i] === '{') depth++;
		else if (program[i] === '}') depth--;

		if (depth > 0) body += program[i];
		i++;
	}

	return { body: body.trim(), end: i };
}

interface AwkState {
	nr: number;
	nf: number;
	fs: string;
	ofs: string;
	rs: string;
	ors: string;
	filename: string;
	fields: string[];
	line: string;
	output: string;
	vars: Map<string, string>;
}

function splitFields(line: string, fs: string): string[] {
	if (fs === ' ') {
		// Default: split on whitespace, trim leading/trailing
		const parts = line.trim().split(/\s+/);
		return parts.length === 1 && parts[0] === '' ? [] : parts;
	}
	return line.split(fs);
}

function getField(state: AwkState, n: number): string {
	if (n === 0) return state.line;
	if (n > 0 && n <= state.fields.length) return state.fields[n - 1];
	return '';
}

function executeAction(action: string, state: AwkState): void {
	// Split action into statements
	const statements = splitStatements(action);
	for (let i = 0; i < statements.length; i++) {
		executeStatement(statements[i].trim(), state);
	}
}

function splitStatements(action: string): string[] {
	const stmts: string[] = [];
	let current = '';
	let depth = 0;
	let inStr = false;
	let strChar = '';

	for (let i = 0; i < action.length; i++) {
		const ch = action[i];

		if (inStr) {
			current += ch;
			if (ch === '\\' && i + 1 < action.length) {
				i++;
				current += action[i];
				continue;
			}
			if (ch === strChar) inStr = false;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inStr = true;
			strChar = ch;
			current += ch;
			continue;
		}

		if (ch === '(' || ch === '{') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === ')' || ch === '}') {
			depth--;
			current += ch;
			continue;
		}

		if (depth === 0 && (ch === ';' || ch === '\n')) {
			if (current.trim().length > 0) stmts.push(current);
			current = '';
			continue;
		}

		current += ch;
	}

	if (current.trim().length > 0) stmts.push(current);
	return stmts;
}

function executeStatement(stmt: string, state: AwkState): void {
	const trimmed = stmt.trim();
	if (trimmed.length === 0) return;

	// print statement
	if (trimmed === 'print' || trimmed === 'print $0') {
		state.output += state.line + state.ors;
		return;
	}

	if (trimmed.startsWith('print ') || trimmed.startsWith('print\t')) {
		const expr = trimmed.slice(6).trim();
		const parts = splitPrintArgs(expr);
		const values: string[] = [];
		for (let i = 0; i < parts.length; i++) {
			values.push(evaluateExpr(parts[i].trim(), state));
		}
		state.output += values.join(state.ofs) + state.ors;
		return;
	}

	// Compound assignment operators (+=, -=, *=, /=)
	const compoundMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*(\+=|-=|\*=|\/=)\s*(.+)$/);
	if (compoundMatch) {
		const varName = compoundMatch[1];
		const op = compoundMatch[2];
		const rhs = Number.parseFloat(evaluateExpr(compoundMatch[3], state)) || 0;
		const current = Number.parseFloat(resolveAwkVar(varName, state)) || 0;
		let result: number;
		switch (op) {
			case '+=':
				result = current + rhs;
				break;
			case '-=':
				result = current - rhs;
				break;
			case '*=':
				result = current * rhs;
				break;
			case '/=':
				result = rhs === 0 ? 0 : current / rhs;
				break;
			default:
				result = current;
		}
		setAwkVar(varName, String(result), state);
		return;
	}

	// Variable assignment (= but not ==)
	const assignMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*=(?!=)\s*(.+)$/);
	if (assignMatch) {
		const varName = assignMatch[1];
		const val = evaluateExpr(assignMatch[2], state);
		setAwkVar(varName, val, state);
		return;
	}

	// sub/gsub calls as statements
	if (trimmed.startsWith('sub(') || trimmed.startsWith('gsub(')) {
		evaluateExpr(trimmed, state);
		return;
	}

	// If-else (very basic)
	if (trimmed.startsWith('if ') || trimmed.startsWith('if(')) {
		executeIf(trimmed, state);
		return;
	}

	// Fallback: evaluate as expression (for side effects like function calls)
	evaluateExpr(trimmed, state);
}

function executeIf(stmt: string, state: AwkState): void {
	// Very basic if parsing
	let pos = 2; // skip "if"
	while (pos < stmt.length && stmt[pos] === ' ') pos++;
	if (stmt[pos] !== '(') return;

	// Find matching )
	let depth = 1;
	const condStart = pos + 1;
	pos++;
	while (pos < stmt.length && depth > 0) {
		if (stmt[pos] === '(') depth++;
		else if (stmt[pos] === ')') depth--;
		pos++;
	}
	const condition = stmt.slice(condStart, pos - 1);
	const condResult = evaluateExpr(condition, state);

	let thenBody = '';
	let elseBody = '';

	const rest = stmt.slice(pos).trim();
	if (rest.startsWith('{')) {
		const block = extractBlock(rest, 0);
		thenBody = block.body;
		const afterBlock = rest.slice(block.end).trim();
		if (afterBlock.startsWith('else')) {
			const elseRest = afterBlock.slice(4).trim();
			if (elseRest.startsWith('{')) {
				const eBlock = extractBlock(elseRest, 0);
				elseBody = eBlock.body;
			} else {
				elseBody = elseRest;
			}
		}
	} else {
		thenBody = rest;
	}

	if (isTruthy(condResult)) {
		executeAction(thenBody, state);
	} else if (elseBody) {
		executeAction(elseBody, state);
	}
}

function isTruthy(val: string): boolean {
	if (val === '' || val === '0') return false;
	return true;
}

function splitPrintArgs(expr: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let inStr = false;
	let strChar = '';

	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];

		if (inStr) {
			current += ch;
			if (ch === '\\' && i + 1 < expr.length) {
				i++;
				current += expr[i];
				continue;
			}
			if (ch === strChar) inStr = false;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inStr = true;
			strChar = ch;
			current += ch;
			continue;
		}

		if (ch === '(') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === ')') {
			depth--;
			current += ch;
			continue;
		}

		if (depth === 0 && ch === ',') {
			parts.push(current);
			current = '';
			continue;
		}

		current += ch;
	}

	if (current.trim().length > 0) parts.push(current);
	return parts;
}

function resolveAwkVar(name: string, state: AwkState): string {
	switch (name) {
		case 'NR':
			return String(state.nr);
		case 'NF':
			return String(state.nf);
		case 'FS':
			return state.fs;
		case 'OFS':
			return state.ofs;
		case 'RS':
			return state.rs;
		case 'ORS':
			return state.ors;
		case 'FILENAME':
			return state.filename;
		default:
			return state.vars.get(name) ?? '0';
	}
}

function setAwkVar(name: string, value: string, state: AwkState): void {
	switch (name) {
		case 'OFS':
			state.ofs = value;
			break;
		case 'ORS':
			state.ors = value;
			break;
		case 'FS':
			state.fs = value;
			break;
		case 'RS':
			state.rs = value;
			break;
		default:
			state.vars.set(name, value);
	}
}

function evaluateExpr(expr: string, state: AwkState): string {
	const trimmed = expr.trim();

	// String literal
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return processStringEscapes(trimmed.slice(1, -1));
	}

	// Parenthesized expression (check early)
	if (trimmed.startsWith('(') && findMatchingParen(trimmed, 0) === trimmed.length - 1) {
		return evaluateExpr(trimmed.slice(1, -1), state);
	}

	// Compound assignment operators (+=, -=, *=, /=) and simple assignment in expressions
	// Use (?!=) negative lookahead to avoid matching == as assignment
	const exprAssignMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*(\+=|-=|\*=|\/=|=(?!=))\s*(.+)$/);
	if (exprAssignMatch) {
		const varName = exprAssignMatch[1];
		const op = exprAssignMatch[2];
		const rhsVal = evaluateExpr(exprAssignMatch[3], state);
		if (op === '=') {
			setAwkVar(varName, rhsVal, state);
			return rhsVal;
		}
		const rhs = Number.parseFloat(rhsVal) || 0;
		const current = Number.parseFloat(resolveAwkVar(varName, state)) || 0;
		let result: number;
		switch (op) {
			case '+=':
				result = current + rhs;
				break;
			case '-=':
				result = current - rhs;
				break;
			case '*=':
				result = current * rhs;
				break;
			case '/=':
				result = rhs === 0 ? 0 : current / rhs;
				break;
			default:
				result = current;
		}
		const resultStr = String(result);
		setAwkVar(varName, resultStr, state);
		return resultStr;
	}

	// Check for comparison operators FIRST (before atomics)
	for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
		const opIdx = findOperator(trimmed, op);
		if (opIdx >= 0) {
			const left = evaluateExpr(trimmed.slice(0, opIdx), state);
			const right = evaluateExpr(trimmed.slice(opIdx + op.length), state);
			const numL = Number.parseFloat(left);
			const numR = Number.parseFloat(right);
			const useNumeric = !Number.isNaN(numL) && !Number.isNaN(numR);
			let result = false;
			switch (op) {
				case '==':
					result = useNumeric ? numL === numR : left === right;
					break;
				case '!=':
					result = useNumeric ? numL !== numR : left !== right;
					break;
				case '>':
					result = useNumeric ? numL > numR : left > right;
					break;
				case '<':
					result = useNumeric ? numL < numR : left < right;
					break;
				case '>=':
					result = useNumeric ? numL >= numR : left >= right;
					break;
				case '<=':
					result = useNumeric ? numL <= numR : left <= right;
					break;
			}
			return result ? '1' : '0';
		}
	}

	// Check for arithmetic operators BEFORE atomics
	for (const op of ['+', '-']) {
		const opIdx = findArithOperator(trimmed, op);
		if (opIdx >= 0) {
			const left = Number.parseFloat(evaluateExpr(trimmed.slice(0, opIdx), state)) || 0;
			const right = Number.parseFloat(evaluateExpr(trimmed.slice(opIdx + 1), state)) || 0;
			return String(op === '+' ? left + right : left - right);
		}
	}
	for (const op of ['*', '/', '%']) {
		const opIdx = findArithOperator(trimmed, op);
		if (opIdx >= 0) {
			const left = Number.parseFloat(evaluateExpr(trimmed.slice(0, opIdx), state)) || 0;
			const right = Number.parseFloat(evaluateExpr(trimmed.slice(opIdx + 1), state)) || 0;
			let result: number;
			switch (op) {
				case '*':
					result = left * right;
					break;
				case '/':
					result = right === 0 ? 0 : left / right;
					break;
				case '%':
					result = right === 0 ? 0 : left % right;
					break;
				default:
					result = 0;
			}
			return String(result);
		}
	}

	// Ternary
	const ternIdx = findOperator(trimmed, '?');
	if (ternIdx >= 0) {
		const colonIdx = findOperator(trimmed.slice(ternIdx + 1), ':');
		if (colonIdx >= 0) {
			const cond = evaluateExpr(trimmed.slice(0, ternIdx), state);
			const trueExpr = trimmed.slice(ternIdx + 1, ternIdx + 1 + colonIdx);
			const falseExpr = trimmed.slice(ternIdx + 1 + colonIdx + 1);
			return isTruthy(cond) ? evaluateExpr(trueExpr, state) : evaluateExpr(falseExpr, state);
		}
	}

	// String concatenation
	const concatParts = splitConcat(trimmed);
	if (concatParts.length > 1) {
		let result = '';
		for (let i = 0; i < concatParts.length; i++) {
			result += evaluateExpr(concatParts[i], state);
		}
		return result;
	}

	// === Atomic values below ===

	// Field reference $N (only when it's a pure field reference)
	if (trimmed[0] === '$') {
		const rest = trimmed.slice(1);
		if (rest === 'NF') return getField(state, state.nf);
		if (/^\d+$/.test(rest)) return getField(state, Number.parseInt(rest, 10));
		// $(expr)
		const val = evaluateExpr(rest, state);
		const fieldNum = Number.parseInt(val, 10);
		return Number.isNaN(fieldNum) ? '' : getField(state, fieldNum);
	}

	// Built-in variables
	if (trimmed === 'NR') return String(state.nr);
	if (trimmed === 'NF') return String(state.nf);
	if (trimmed === 'FS') return state.fs;
	if (trimmed === 'OFS') return state.ofs;
	if (trimmed === 'RS') return state.rs;
	if (trimmed === 'ORS') return state.ors;
	if (trimmed === 'FILENAME') return state.filename;

	// Number literal
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

	// Function calls
	if (trimmed.startsWith('length(')) {
		const argStr = trimmed.slice(7, -1);
		if (argStr.length === 0) return String(state.line.length);
		return String(evaluateExpr(argStr, state).length);
	}
	if (trimmed === 'length') return String(state.line.length);

	if (trimmed.startsWith('substr(')) {
		const argParts = splitPrintArgs(trimmed.slice(7, -1));
		const str = evaluateExpr(argParts[0], state);
		const start = Number.parseInt(evaluateExpr(argParts[1] || '1', state), 10) - 1;
		if (argParts.length > 2) {
			const len = Number.parseInt(evaluateExpr(argParts[2], state), 10);
			return str.slice(Math.max(0, start), start + len);
		}
		return str.slice(Math.max(0, start));
	}

	if (trimmed.startsWith('index(')) {
		const argParts = splitPrintArgs(trimmed.slice(6, -1));
		const str = evaluateExpr(argParts[0], state);
		const target = evaluateExpr(argParts[1], state);
		return String(str.indexOf(target) + 1);
	}

	if (trimmed.startsWith('split(')) {
		const argParts = splitPrintArgs(trimmed.slice(6, -1));
		const str = evaluateExpr(argParts[0], state);
		const sep = argParts.length > 2 ? evaluateExpr(argParts[2], state) : state.fs;
		const parts = str.split(sep);
		return String(parts.length);
	}

	if (trimmed.startsWith('tolower(')) {
		return evaluateExpr(trimmed.slice(8, -1), state).toLowerCase();
	}
	if (trimmed.startsWith('toupper(')) {
		return evaluateExpr(trimmed.slice(8, -1), state).toUpperCase();
	}

	if (trimmed.startsWith('sprintf(')) {
		const argParts = splitPrintArgs(trimmed.slice(8, -1));
		const fmt = evaluateExpr(argParts[0], state);
		const spArgs: string[] = [];
		for (let i = 1; i < argParts.length; i++) {
			spArgs.push(evaluateExpr(argParts[i], state));
		}
		return formatPrintf(fmt, spArgs);
	}

	if (trimmed.startsWith('sub(') || trimmed.startsWith('gsub(')) {
		const isGlobal = trimmed.startsWith('gsub(');
		const argParts = splitPrintArgs(trimmed.slice(isGlobal ? 5 : 4, -1));
		const pat = evaluateExpr(argParts[0], state);
		const repl = evaluateExpr(argParts[1], state);
		const flags = isGlobal ? 'g' : '';
		const subSafety = checkRegexSafety(pat);
		if (subSafety) {
			// unsafe regex - skip substitution
		} else {
			try {
				const regex = new RegExp(pat, flags);
				state.fields[0] = state.line;
				const newLine = state.line.replace(regex, repl);
				state.line = newLine;
				state.fields = splitFields(newLine, state.fs);
				state.nf = state.fields.length;
			} catch {
				// invalid regex
			}
		}
		return '';
	}

	// User variable
	if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
		return state.vars.get(trimmed) ?? '0';
	}

	// Unknown - return as-is (could be an unquoted string)
	return trimmed;
}

function findMatchingParen(expr: string, start: number): number {
	let depth = 0;
	for (let i = start; i < expr.length; i++) {
		if (expr[i] === '(') depth++;
		else if (expr[i] === ')') {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function findOperator(expr: string, op: string): number {
	let depth = 0;
	let inStr = false;
	let strChar = '';

	for (let i = 0; i < expr.length - op.length + 1; i++) {
		const ch = expr[i];
		if (inStr) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === strChar) inStr = false;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inStr = true;
			strChar = ch;
			continue;
		}
		if (ch === '(') {
			depth++;
			continue;
		}
		if (ch === ')') {
			depth--;
			continue;
		}
		if (depth === 0 && expr.slice(i, i + op.length) === op) {
			return i;
		}
	}
	return -1;
}

function findArithOperator(expr: string, op: string): number {
	let depth = 0;
	let inStr = false;
	let strChar = '';

	// For + and -, search left-to-right but skip position 0 for unary minus
	if (op === '+' || op === '-') {
		for (let i = 1; i < expr.length; i++) {
			const ch = expr[i];
			if (inStr) {
				if (ch === '\\') {
					i++;
					continue;
				}
				if (ch === strChar) inStr = false;
				continue;
			}
			if (ch === '"' || ch === "'") {
				inStr = true;
				strChar = ch;
				continue;
			}
			if (ch === '(') {
				depth++;
				continue;
			}
			if (ch === ')') {
				depth--;
				continue;
			}
			if (depth === 0 && ch === op) {
				// Make sure it's not part of $1, ==, etc.
				const prev = expr[i - 1];
				if (prev === 'e' || prev === 'E') continue; // scientific notation
				return i;
			}
		}
		return -1;
	}

	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];
		if (inStr) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === strChar) inStr = false;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inStr = true;
			strChar = ch;
			continue;
		}
		if (ch === '(') {
			depth++;
			continue;
		}
		if (ch === ')') {
			depth--;
			continue;
		}
		if (depth === 0 && ch === op) return i;
	}
	return -1;
}

function splitConcat(expr: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let inStr = false;
	let strChar = '';
	let lastWasValue = false;

	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i];

		if (inStr) {
			current += ch;
			if (ch === '\\' && i + 1 < expr.length) {
				i++;
				current += expr[i];
				continue;
			}
			if (ch === strChar) {
				inStr = false;
				lastWasValue = true;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			if (lastWasValue && current.length > 0) {
				// Concatenation point
				parts.push(current);
				current = '';
			}
			inStr = true;
			strChar = ch;
			current += ch;
			continue;
		}

		if (ch === '(') {
			depth++;
			current += ch;
			lastWasValue = false;
			continue;
		}
		if (ch === ')') {
			depth--;
			current += ch;
			lastWasValue = true;
			continue;
		}

		if (ch === ' ' && depth === 0 && current.length > 0) {
			// Check if this is concatenation
			const rest = expr.slice(i + 1).trimStart();
			if (
				rest.length > 0 &&
				(rest[0] === '"' ||
					rest[0] === '$' ||
					rest[0] === '(' ||
					(rest[0] >= '0' && rest[0] <= '9'))
			) {
				parts.push(current);
				current = '';
				lastWasValue = false;
				continue;
			}
		}

		current += ch;
		if (ch !== ' ' && ch !== '\t') lastWasValue = true;
	}

	if (current.trim().length > 0) parts.push(current);
	return parts;
}

function processStringEscapes(s: string): string {
	let result = '';
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '\\' && i + 1 < s.length) {
			switch (s[i + 1]) {
				case 'n':
					result += '\n';
					break;
				case 't':
					result += '\t';
					break;
				case '\\':
					result += '\\';
					break;
				case '"':
					result += '"';
					break;
				default:
					result += s[i + 1];
					break;
			}
			i++;
		} else {
			result += s[i];
		}
	}
	return result;
}

function evaluatePattern(rule: AwkRule, state: AwkState): boolean {
	if (!rule.pattern) return true; // No pattern = always matches

	if (rule.patternRegex) {
		return rule.patternRegex.test(state.line);
	}

	// Expression pattern
	const result = evaluateExpr(rule.pattern, state);
	return isTruthy(result);
}

export const awk: Command = {
	name: 'awk',
	async execute(args: string[], ctx: CommandContext): Promise<CommandResult> {
		let fieldSep = ' ';
		let program = '';
		const files: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg === '-F' && i + 1 < args.length) {
				i++;
				fieldSep = args[i];
				continue;
			}
			if (arg.startsWith('-F') && arg.length > 2) {
				fieldSep = arg.slice(2);
				continue;
			}
			if (program === '') {
				program = arg;
			} else {
				files.push(arg);
			}
		}

		if (program === '') {
			return { exitCode: 1, stdout: '', stderr: 'awk: no program given\n' };
		}

		// Check for unsupported features
		if (
			program.includes('function ') &&
			program.includes('(') &&
			program.includes(')') &&
			program.includes('{')
		) {
			// Heuristic: might be user-defined function
		}

		let rules: AwkRule[];
		try {
			rules = parseAwkProgram(program);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exitCode: 2, stdout: '', stderr: `awk: ${msg}\n` };
		}

		let content = '';
		let stderr = '';
		let filename = '';

		if (files.length === 0) {
			content = ctx.stdin;
			filename = '';
		} else {
			const path = resolvePath(files[0], ctx.cwd);
			try {
				const data = ctx.fs.readFile(path);
				content = typeof data === 'string' ? data : await data;
				filename = files[0];
			} catch {
				stderr = `awk: can't open file ${files[0]}: No such file or directory\n`;
				return { exitCode: 2, stdout: '', stderr };
			}
		}

		const state: AwkState = {
			nr: 0,
			nf: 0,
			fs: fieldSep,
			ofs: ' ',
			rs: '\n',
			ors: '\n',
			filename,
			fields: [],
			line: '',
			output: '',
			vars: new Map(),
		};

		// Execute BEGIN rules
		for (let i = 0; i < rules.length; i++) {
			if (rules[i].type === 'begin') {
				executeAction(rules[i].action, state);
			}
		}

		// Process input lines
		if (content.length > 0) {
			const lines = content.split(state.rs);
			if (lines.length > 0 && lines[lines.length - 1] === '' && content.endsWith(state.rs)) {
				lines.pop();
			}

			for (let i = 0; i < lines.length; i++) {
				state.nr++;
				state.line = lines[i];
				state.fields = splitFields(lines[i], state.fs);
				state.nf = state.fields.length;

				for (let r = 0; r < rules.length; r++) {
					if (rules[r].type === 'pattern') {
						if (evaluatePattern(rules[r], state)) {
							executeAction(rules[r].action, state);
						}
					}
				}
			}
		}

		// Execute END rules
		for (let i = 0; i < rules.length; i++) {
			if (rules[i].type === 'end') {
				executeAction(rules[i].action, state);
			}
		}

		return { exitCode: stderr.length > 0 ? 2 : 0, stdout: state.output, stderr };
	},
};
