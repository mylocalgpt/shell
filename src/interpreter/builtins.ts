import type { CommandResult } from '../commands/types.js';
import type { ConditionalExpr } from '../parser/ast.js';
import { parse } from '../parser/parser.js';
import { checkRegexSafety, checkSubjectLength } from '../security/regex.js';
import { globMatch } from '../utils/glob.js';
import { BreakSignal, ContinueSignal, ExitSignal, ReturnSignal } from './errors.js';
import type { Interpreter, InterpreterContext } from './interpreter.js';

/** All builtin names. */
const BUILTIN_NAMES = new Set([
	'cd',
	'export',
	'unset',
	'read',
	'source',
	'.',
	'local',
	'set',
	'declare',
	'typeset',
	'eval',
	'shift',
	'test',
	'[',
	'true',
	'false',
	'return',
	'break',
	'continue',
	'exit',
	'type',
	'command',
	'builtin',
	'trap',
	'getopts',
]);

/** Check if a name is a builtin. */
export function isBuiltin(name: string): boolean {
	return BUILTIN_NAMES.has(name);
}

/** Execute a builtin command. */
export async function executeBuiltin(
	name: string,
	args: string[],
	ctx: InterpreterContext,
): Promise<CommandResult> {
	switch (name) {
		case 'cd':
			return builtinCd(args, ctx);
		case 'export':
			return builtinExport(args, ctx);
		case 'unset':
			return builtinUnset(args, ctx);
		case 'read':
			return builtinRead(args, ctx);
		case 'source':
		case '.':
			return builtinSource(args, ctx);
		case 'local':
			return builtinLocal(args, ctx);
		case 'set':
			return builtinSet(args, ctx);
		case 'declare':
		case 'typeset':
			return builtinDeclare(args, ctx);
		case 'eval':
			return builtinEval(args, ctx);
		case 'shift':
			return builtinShift(args, ctx);
		case 'test':
		case '[':
			return builtinTest(args, ctx, name === '[');
		case 'true':
			return ok('');
		case 'false':
			return { exitCode: 1, stdout: '', stderr: '' };
		case 'return':
			return builtinReturn(args);
		case 'break':
			return builtinBreak(args);
		case 'continue':
			return builtinContinue(args);
		case 'exit':
			return builtinExit(args);
		case 'type':
			return builtinType(args, ctx);
		case 'command':
			return builtinCommand(args, ctx);
		case 'builtin':
			return builtinBuiltinCmd(args, ctx);
		case 'trap':
			return err('@mylocalgpt/shell: signal traps not supported.\n');
		case 'getopts':
			return err('@mylocalgpt/shell: getopts not supported. Alternative: use case statements.\n');
		default:
			return { exitCode: 1, stdout: '', stderr: `${name}: not a builtin\n` };
	}
}

function ok(stdout: string): CommandResult {
	return { exitCode: 0, stdout, stderr: '' };
}

function err(stderr: string, code?: number): CommandResult {
	return { exitCode: code ?? 1, stdout: '', stderr };
}

/** Normalize a path relative to cwd. */
function resolvePath(path: string, cwd: string): string {
	if (path.startsWith('/')) return normalizePath(path);
	return normalizePath(cwd === '/' ? `/${path}` : `${cwd}/${path}`);
}

/** Normalize a path: resolve . and .., collapse slashes. */
function normalizePath(input: string): string {
	const segments: string[] = [];
	const parts = input.split('/');
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (segments.length > 0) segments.pop();
			continue;
		}
		segments.push(part);
	}
	return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

// ── cd ──

function builtinCd(args: string[], ctx: InterpreterContext): CommandResult {
	let target: string;

	if (args.length === 0 || args[0] === '~') {
		target = ctx.env.get('HOME') ?? '/';
	} else if (args[0] === '-') {
		target = ctx.env.get('OLDPWD') ?? ctx.cwd;
	} else {
		target = args[0];
	}

	const resolved = resolvePath(target, ctx.cwd);

	if (!ctx.fs.exists(resolved)) {
		return err(`cd: ${target}: No such file or directory\n`);
	}

	try {
		const stat = ctx.fs.stat(resolved);
		if (!stat.isDirectory()) {
			return err(`cd: ${target}: Not a directory\n`);
		}
	} catch {
		return err(`cd: ${target}: Not a directory\n`);
	}

	const oldPwd = ctx.cwd;
	ctx.interpreter.setCwd(resolved);
	ctx.env.set('OLDPWD', oldPwd);
	ctx.env.set('PWD', resolved);

	if (args[0] === '-') {
		return ok(`${resolved}\n`);
	}
	return ok('');
}

// ── export ──

function builtinExport(args: string[], ctx: InterpreterContext): CommandResult {
	if (args.length === 0) {
		return ok('');
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '-p') {
			let output = '';
			for (const [key, val] of ctx.env) {
				output += `declare -x ${key}="${val}"\n`;
			}
			return ok(output);
		}

		if (arg === '-n') {
			// Remove export attribute - we don't track this separately yet
			continue;
		}

		const eqIdx = arg.indexOf('=');
		if (eqIdx >= 0) {
			const name = arg.slice(0, eqIdx);
			const value = arg.slice(eqIdx + 1);
			ctx.interpreter.setVar(name, value);
		}
	}

	return ok('');
}

// ── unset ──

function builtinUnset(args: string[], ctx: InterpreterContext): CommandResult {
	let mode = 'v'; // -v for variables, -f for functions
	const names: string[] = [];

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '-v') {
			mode = 'v';
		} else if (args[i] === '-f') {
			mode = 'f';
		} else {
			names.push(args[i]);
		}
	}

	for (let i = 0; i < names.length; i++) {
		if (mode === 'v') {
			ctx.env.delete(names[i]);
		}
		// -f not implemented yet (no direct function access from builtins)
	}

	return ok('');
}

// ── read ──

function builtinRead(args: string[], ctx: InterpreterContext): CommandResult {
	let raw = false;
	let delimiter = '\n';
	let count = -1;
	const varNames: string[] = [];

	let i = 0;
	while (i < args.length) {
		if (args[i] === '-r') {
			raw = true;
			i++;
		} else if (args[i] === '-p') {
			i += 2; // skip prompt (non-interactive)
		} else if (args[i] === '-d' && i + 1 < args.length) {
			delimiter = args[i + 1];
			i += 2;
		} else if (args[i] === '-n' && i + 1 < args.length) {
			count = Number.parseInt(args[i + 1], 10);
			i += 2;
		} else if (args[i] === '-a' && i + 1 < args.length) {
			// Array read - simplified
			varNames.push(args[i + 1]);
			i += 2;
		} else {
			varNames.push(args[i]);
			i++;
		}
	}

	if (varNames.length === 0) {
		varNames.push('REPLY');
	}

	const input = ctx.stdin;
	if (input.length === 0) {
		return { exitCode: 1, stdout: '', stderr: '' };
	}

	// Read until delimiter
	let line = '';
	if (count >= 0) {
		line = input.slice(0, count);
	} else {
		const delimIdx = input.indexOf(delimiter);
		if (delimIdx >= 0) {
			line = input.slice(0, delimIdx);
		} else {
			line = input;
		}
	}

	// Handle backslash escaping
	if (!raw) {
		line = line.replace(/\\\n/g, '');
	}

	// Split by IFS for multiple variables
	const ifs = ctx.env.get('IFS') ?? ' \t\n';

	if (varNames.length === 1) {
		ctx.interpreter.setVar(varNames[0], line.trim());
	} else {
		const parts = splitByIFS(line, ifs, varNames.length);
		for (let j = 0; j < varNames.length; j++) {
			ctx.interpreter.setVar(varNames[j], j < parts.length ? parts[j] : '');
		}
	}

	return ok('');
}

/** Split a string by IFS into at most maxParts. */
function splitByIFS(input: string, ifs: string, maxParts: number): string[] {
	const parts: string[] = [];
	let current = '';
	const inWord = false;
	const ifsSet = new Set<string>();
	for (let i = 0; i < ifs.length; i++) ifsSet.add(ifs[i]);

	let i = 0;
	// Skip leading IFS whitespace
	while (i < input.length && ifsSet.has(input[i])) i++;

	while (i < input.length) {
		if (ifsSet.has(input[i])) {
			if (parts.length >= maxParts - 1) {
				// Last var gets everything remaining
				current += input.slice(i);
				break;
			}
			parts.push(current);
			current = '';
			// Skip consecutive IFS chars
			while (i < input.length && ifsSet.has(input[i])) i++;
			continue;
		}
		current += input[i];
		i++;
	}

	if (current.length > 0 || parts.length < maxParts) {
		parts.push(current);
	}

	return parts;
}

// ── source / . ──

async function builtinSource(args: string[], ctx: InterpreterContext): Promise<CommandResult> {
	if (args.length === 0) {
		return err('source: filename argument required\n');
	}

	const filePath = resolvePath(args[0], ctx.cwd);

	if (!ctx.fs.exists(filePath)) {
		return err(`source: ${args[0]}: No such file or directory\n`);
	}

	try {
		const content = ctx.fs.readFile(filePath);
		const text = typeof content === 'string' ? content : await content;
		return ctx.exec(text);
	} catch (e) {
		return err(`source: ${args[0]}: ${e instanceof Error ? e.message : String(e)}\n`);
	}
}

// ── local ──

function builtinLocal(args: string[], ctx: InterpreterContext): CommandResult {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '-r') continue; // readonly attribute (simplified)

		const eqIdx = arg.indexOf('=');
		if (eqIdx >= 0) {
			const name = arg.slice(0, eqIdx);
			const value = arg.slice(eqIdx + 1);
			ctx.interpreter.setLocal(name, value);
		} else {
			ctx.interpreter.setLocal(arg, '');
		}
	}
	return ok('');
}

// ── set ──

function builtinSet(args: string[], ctx: InterpreterContext): CommandResult {
	if (args.length === 0) {
		// Print all variables
		let output = '';
		const entries: Array<[string, string]> = [];
		for (const [key, val] of ctx.env) {
			entries.push([key, val]);
		}
		entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		for (const [key, val] of entries) {
			output += `${key}=${val}\n`;
		}
		return ok(output);
	}

	const opts = ctx.interpreter.getOptions();

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg === '--') {
			// Set positional parameters from remaining args
			// (simplified - would need interpreter support)
			i++;
			break;
		}

		if (arg === '-o' || arg === '+o') {
			const enable = arg[0] === '-';
			i++;
			if (i >= args.length) {
				// Print options
				let output = '';
				output += `errexit\t${opts.errexit ? 'on' : 'off'}\n`;
				output += `pipefail\t${opts.pipefail ? 'on' : 'off'}\n`;
				output += `nounset\t${opts.nounset ? 'on' : 'off'}\n`;
				output += `noglob\t${opts.noglob ? 'on' : 'off'}\n`;
				output += `noclobber\t${opts.noclobber ? 'on' : 'off'}\n`;
				return ok(output);
			}
			const optName = args[i];
			applyOption(opts, optName, enable);
			i++;
			continue;
		}

		if (arg.startsWith('-') || arg.startsWith('+')) {
			const enable = arg[0] === '-';
			for (let j = 1; j < arg.length; j++) {
				const flag = arg[j];
				if (flag === 'o') {
					// -o needs next arg
					i++;
					if (i < args.length) {
						applyOption(opts, args[i], enable);
					}
					break;
				}
				applyFlag(opts, flag, enable);
			}
			i++;
			continue;
		}

		break;
	}

	return ok('');
}

function applyOption(
	opts: ReturnType<typeof import('./interpreter.js').Interpreter.prototype.getOptions>,
	name: string,
	enable: boolean,
): void {
	switch (name) {
		case 'errexit':
			opts.errexit = enable;
			break;
		case 'pipefail':
			opts.pipefail = enable;
			break;
		case 'nounset':
			opts.nounset = enable;
			break;
		case 'noglob':
			opts.noglob = enable;
			break;
		case 'noclobber':
			opts.noclobber = enable;
			break;
		case 'allexport':
			opts.allexport = enable;
			break;
		case 'xtrace':
			opts.xtrace = enable;
			break;
		case 'verbose':
			opts.verbose = enable;
			break;
	}
}

function applyFlag(
	opts: ReturnType<typeof import('./interpreter.js').Interpreter.prototype.getOptions>,
	flag: string,
	enable: boolean,
): void {
	switch (flag) {
		case 'e':
			opts.errexit = enable;
			break;
		case 'u':
			opts.nounset = enable;
			break;
		case 'f':
			opts.noglob = enable;
			break;
		case 'C':
			opts.noclobber = enable;
			break;
		case 'a':
			opts.allexport = enable;
			break;
		case 'x':
			opts.xtrace = enable;
			break;
		case 'v':
			opts.verbose = enable;
			break;
	}
}

// ── declare / typeset ──

function builtinDeclare(args: string[], ctx: InterpreterContext): CommandResult {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '-A') {
			return err(
				'declare: -A (associative arrays) not supported; use indexed arrays or a Map-like pattern\n',
			);
		}
		if (arg === '-n') {
			return err('declare: -n (namerefs) not supported; use eval or indirect expansion instead\n');
		}
		if (arg === '-a' || arg === '-i' || arg === '-r' || arg === '-x') {
			continue; // Accept flags silently for now
		}
		if (arg === '-p') {
			// Print declarations (simplified)
			continue;
		}
		if (arg === '-f' || arg === '-F') {
			// List functions (simplified)
			continue;
		}

		const eqIdx = arg.indexOf('=');
		if (eqIdx >= 0) {
			const name = arg.slice(0, eqIdx);
			const value = arg.slice(eqIdx + 1);
			ctx.interpreter.setVar(name, value);
		} else if (!arg.startsWith('-')) {
			ctx.interpreter.setVar(arg, '');
		}
	}
	return ok('');
}

// ── eval ──

async function builtinEval(args: string[], ctx: InterpreterContext): Promise<CommandResult> {
	if (args.length === 0) return ok('');
	const cmd = args.join(' ');
	return ctx.exec(cmd);
}

// ── shift ──

function builtinShift(_args: string[], _ctx: InterpreterContext): CommandResult {
	// Simplified - would need interpreter positional params access
	return ok('');
}

// ── test / [ ──

function builtinTest(args: string[], ctx: InterpreterContext, bracketMode: boolean): CommandResult {
	let testArgs = args;

	if (bracketMode) {
		if (testArgs.length === 0 || testArgs[testArgs.length - 1] !== ']') {
			return err("[: missing `]'\n", 2);
		}
		testArgs = testArgs.slice(0, -1);
	}

	if (testArgs.length === 0) {
		return { exitCode: 1, stdout: '', stderr: '' };
	}

	const result = evaluateTestExpr(testArgs, 0, ctx);
	return { exitCode: result.value ? 0 : 1, stdout: '', stderr: '' };
}

interface TestResult {
	value: boolean;
	consumed: number;
}

function evaluateTestExpr(args: string[], pos: number, ctx: InterpreterContext): TestResult {
	if (pos >= args.length) return { value: false, consumed: 0 };

	// ! negation
	if (args[pos] === '!') {
		const inner = evaluateTestExpr(args, pos + 1, ctx);
		return { value: !inner.value, consumed: 1 + inner.consumed };
	}

	// Unary tests
	if (args[pos].startsWith('-') && args[pos].length === 2 && pos + 1 < args.length) {
		const op = args[pos];
		const operand = args[pos + 1];

		switch (op) {
			case '-z':
				return { value: operand.length === 0, consumed: 2 };
			case '-n':
				return { value: operand.length > 0, consumed: 2 };
			case '-e':
			case '-a':
				return { value: ctx.fs.exists(resolvePath(operand, ctx.cwd)), consumed: 2 };
			case '-f': {
				const path = resolvePath(operand, ctx.cwd);
				try {
					return { value: ctx.fs.stat(path).isFile(), consumed: 2 };
				} catch {
					return { value: false, consumed: 2 };
				}
			}
			case '-d': {
				const path = resolvePath(operand, ctx.cwd);
				try {
					return { value: ctx.fs.stat(path).isDirectory(), consumed: 2 };
				} catch {
					return { value: false, consumed: 2 };
				}
			}
			case '-s': {
				const path = resolvePath(operand, ctx.cwd);
				try {
					return { value: ctx.fs.stat(path).size > 0, consumed: 2 };
				} catch {
					return { value: false, consumed: 2 };
				}
			}
			case '-r':
			case '-w':
			case '-x':
				return { value: ctx.fs.exists(resolvePath(operand, ctx.cwd)), consumed: 2 };
			case '-L':
			case '-h':
				return { value: false, consumed: 2 }; // No symlinks in virtual fs
		}
	}

	// Binary tests
	if (pos + 2 < args.length) {
		const left = args[pos];
		const op = args[pos + 1];
		const right = args[pos + 2];

		switch (op) {
			case '=':
			case '==':
				return { value: left === right, consumed: 3 };
			case '!=':
				return { value: left !== right, consumed: 3 };
			case '<':
				return { value: left < right, consumed: 3 };
			case '>':
				return { value: left > right, consumed: 3 };
			case '-eq':
				return { value: Number.parseInt(left, 10) === Number.parseInt(right, 10), consumed: 3 };
			case '-ne':
				return { value: Number.parseInt(left, 10) !== Number.parseInt(right, 10), consumed: 3 };
			case '-lt':
				return { value: Number.parseInt(left, 10) < Number.parseInt(right, 10), consumed: 3 };
			case '-le':
				return { value: Number.parseInt(left, 10) <= Number.parseInt(right, 10), consumed: 3 };
			case '-gt':
				return { value: Number.parseInt(left, 10) > Number.parseInt(right, 10), consumed: 3 };
			case '-ge':
				return { value: Number.parseInt(left, 10) >= Number.parseInt(right, 10), consumed: 3 };
		}
	}

	// Single string: true if non-empty
	return { value: args[pos].length > 0, consumed: 1 };
}

// ── [[ ]] evaluator ──

export function evaluateConditionalExpr(expr: ConditionalExpr, ctx: InterpreterContext): boolean {
	switch (expr.type) {
		case 'UnaryTest': {
			const operandValue = getWordValue(expr.operand);
			return evaluateUnaryTest(expr.operator, operandValue, ctx);
		}
		case 'BinaryTest': {
			const left = getWordValue(expr.left);
			const right = getWordValue(expr.right);
			return evaluateBinaryTest(expr.operator, left, right, ctx);
		}
		case 'NotExpr':
			return !evaluateConditionalExpr(expr.expression, ctx);
		case 'AndExpr':
			return evaluateConditionalExpr(expr.left, ctx) && evaluateConditionalExpr(expr.right, ctx);
		case 'OrExpr':
			return evaluateConditionalExpr(expr.left, ctx) || evaluateConditionalExpr(expr.right, ctx);
		case 'ParenExpr':
			return evaluateConditionalExpr(expr.expression, ctx);
		default:
			return false;
	}
}

function getWordValue(word: { type: string; value?: string; name?: string }): string {
	if ('value' in word && typeof word.value === 'string') return word.value;
	if ('name' in word && typeof word.name === 'string') return word.name;
	return '';
}

function evaluateUnaryTest(op: string, operand: string, ctx: InterpreterContext): boolean {
	switch (op) {
		case '-z':
			return operand.length === 0;
		case '-n':
			return operand.length > 0;
		case '-e':
		case '-a':
			return ctx.fs.exists(resolvePath(operand, ctx.cwd));
		case '-f': {
			const path = resolvePath(operand, ctx.cwd);
			try {
				return ctx.fs.stat(path).isFile();
			} catch {
				return false;
			}
		}
		case '-d': {
			const path = resolvePath(operand, ctx.cwd);
			try {
				return ctx.fs.stat(path).isDirectory();
			} catch {
				return false;
			}
		}
		case '-s': {
			const path = resolvePath(operand, ctx.cwd);
			try {
				return ctx.fs.stat(path).size > 0;
			} catch {
				return false;
			}
		}
		case '-r':
		case '-w':
		case '-x':
			return ctx.fs.exists(resolvePath(operand, ctx.cwd));
		case '-L':
		case '-h':
			return false;
		default:
			return false;
	}
}

function evaluateBinaryTest(
	op: string,
	left: string,
	right: string,
	ctx: InterpreterContext,
): boolean {
	switch (op) {
		case '=':
		case '==':
			return globMatch(right, left); // RHS is a glob pattern in [[
		case '!=':
			return !globMatch(right, left);
		case '=~': {
			// Regex matching with guardrails: check pattern complexity before compiling
			try {
				const patternErr = checkRegexSafety(right);
				if (patternErr) return false;
				const subjectErr = checkSubjectLength(left);
				if (subjectErr) return false;
				const regex = new RegExp(right);
				const match = regex.exec(left);
				if (match) {
					// Set BASH_REMATCH
					ctx.env.set('BASH_REMATCH', match[0]);
					for (let i = 1; i < match.length; i++) {
						ctx.env.set(`BASH_REMATCH_${i}`, match[i] ?? '');
					}
					return true;
				}
				return false;
			} catch {
				return false;
			}
		}
		case '<':
			return left < right;
		case '>':
			return left > right;
		case '-eq':
			return Number.parseInt(left, 10) === Number.parseInt(right, 10);
		case '-ne':
			return Number.parseInt(left, 10) !== Number.parseInt(right, 10);
		case '-lt':
			return Number.parseInt(left, 10) < Number.parseInt(right, 10);
		case '-le':
			return Number.parseInt(left, 10) <= Number.parseInt(right, 10);
		case '-gt':
			return Number.parseInt(left, 10) > Number.parseInt(right, 10);
		case '-ge':
			return Number.parseInt(left, 10) >= Number.parseInt(right, 10);
		default:
			return false;
	}
}

// ── flow control ──

function builtinReturn(args: string[]): never {
	const code = args.length > 0 ? Number.parseInt(args[0], 10) : 0;
	throw new ReturnSignal(Number.isNaN(code) ? 0 : code);
}

function builtinBreak(args: string[]): never {
	const levels = args.length > 0 ? Number.parseInt(args[0], 10) : 1;
	throw new BreakSignal(Number.isNaN(levels) ? 1 : levels);
}

function builtinContinue(args: string[]): never {
	const levels = args.length > 0 ? Number.parseInt(args[0], 10) : 1;
	throw new ContinueSignal(Number.isNaN(levels) ? 1 : levels);
}

function builtinExit(args: string[]): never {
	const code = args.length > 0 ? Number.parseInt(args[0], 10) : 0;
	throw new ExitSignal(Number.isNaN(code) ? 0 : code);
}

// ── type ──

function builtinType(args: string[], ctx: InterpreterContext): CommandResult {
	if (args.length === 0) return ok('');
	const tFlag = args[0] === '-t';
	const names = tFlag ? args.slice(1) : args;

	let output = '';
	for (let i = 0; i < names.length; i++) {
		const name = names[i];
		if (isBuiltin(name)) {
			output += tFlag ? 'builtin\n' : `${name} is a shell builtin\n`;
		} else {
			output += tFlag ? '\n' : `${name}: not found\n`;
		}
	}
	return ok(output);
}

// ── command ──

async function builtinCommand(args: string[], ctx: InterpreterContext): Promise<CommandResult> {
	if (args.length === 0) return ok('');

	if (args[0] === '-v' || args[0] === '-V') {
		const name = args[1] ?? '';
		if (isBuiltin(name)) {
			return ok(`${name}\n`);
		}
		return { exitCode: 1, stdout: '', stderr: '' };
	}

	// Execute bypassing functions
	return ctx.exec(args.join(' '));
}

// ── builtin ──

async function builtinBuiltinCmd(args: string[], ctx: InterpreterContext): Promise<CommandResult> {
	if (args.length === 0) return ok('');
	const name = args[0];
	if (!isBuiltin(name)) {
		return err(`builtin: ${name}: not a shell builtin\n`);
	}
	return executeBuiltin(name, args.slice(1), ctx);
}

/**
 * Register all builtins into an interpreter instance.
 */
export function registerBuiltins(interpreter: Interpreter): void {
	for (const name of BUILTIN_NAMES) {
		interpreter.registerBuiltin(name, (args: string[], ctx: InterpreterContext) =>
			executeBuiltin(name, args, ctx),
		);
	}
}
