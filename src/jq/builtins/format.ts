/**
 * Format string implementations for jq.
 *
 * @base64, @base64d, @uri, @csv, @tsv, @json, @html, @sh, @text
 * All hand-written, zero dependencies.
 */

import type { JsonValue } from '../evaluator.js';
import { jsonStringify } from '../evaluator.js';

// ---------------------------------------------------------------------------
// Base64 (hand-written, no btoa/atob dependency)
// ---------------------------------------------------------------------------

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a UTF-8 string to base64. */
export function base64Encode(input: string): string {
	const bytes = utf8Encode(input);
	let result = '';
	let i = 0;
	while (i < bytes.length) {
		const b0 = bytes[i++] ?? 0;
		const b1 = i < bytes.length ? bytes[i++] : -1;
		const b2 = i < bytes.length ? bytes[i++] : -1;

		result += B64_CHARS[b0 >> 2];
		result += B64_CHARS[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
		result += b1 >= 0 ? B64_CHARS[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)] : '=';
		result += b2 >= 0 ? B64_CHARS[b2 & 63] : '=';
	}
	return result;
}

/** Decode a base64 string to UTF-8. */
export function base64Decode(input: string): string {
	const clean = input.replace(/[\s\r\n]/g, '');
	const bytes: number[] = [];
	let i = 0;

	while (i < clean.length) {
		const c0 = b64Index(clean[i++]);
		const c1 = b64Index(clean[i++]);
		const c2 = i < clean.length && clean[i] !== '=' ? b64Index(clean[i]) : -1;
		i++;
		const c3 = i < clean.length && clean[i] !== '=' ? b64Index(clean[i]) : -1;
		i++;

		bytes.push((c0 << 2) | (c1 >> 4));
		if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
		if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
	}

	return utf8Decode(bytes);
}

function b64Index(ch: string): number {
	if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 65;
	if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 97 + 26;
	if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48 + 52;
	if (ch === '+') return 62;
	if (ch === '/') return 63;
	return 0;
}

function utf8Encode(str: string): number[] {
	const bytes: number[] = [];
	for (let i = 0; i < str.length; i++) {
		let code = str.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
			const next = str.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
				i++;
			}
		}
		if (code <= 0x7f) {
			bytes.push(code);
		} else if (code <= 0x7ff) {
			bytes.push(0xc0 | (code >> 6));
			bytes.push(0x80 | (code & 0x3f));
		} else if (code <= 0xffff) {
			bytes.push(0xe0 | (code >> 12));
			bytes.push(0x80 | ((code >> 6) & 0x3f));
			bytes.push(0x80 | (code & 0x3f));
		} else {
			bytes.push(0xf0 | (code >> 18));
			bytes.push(0x80 | ((code >> 12) & 0x3f));
			bytes.push(0x80 | ((code >> 6) & 0x3f));
			bytes.push(0x80 | (code & 0x3f));
		}
	}
	return bytes;
}

function utf8Decode(bytes: number[]): string {
	let result = '';
	let i = 0;
	while (i < bytes.length) {
		const b = bytes[i++];
		if (b <= 0x7f) {
			result += String.fromCharCode(b);
		} else if (b <= 0xdf) {
			const b2 = bytes[i++] & 0x3f;
			result += String.fromCharCode(((b & 0x1f) << 6) | b2);
		} else if (b <= 0xef) {
			const b2 = bytes[i++] & 0x3f;
			const b3 = bytes[i++] & 0x3f;
			result += String.fromCharCode(((b & 0x0f) << 12) | (b2 << 6) | b3);
		} else {
			const b2 = bytes[i++] & 0x3f;
			const b3 = bytes[i++] & 0x3f;
			const b4 = bytes[i++] & 0x3f;
			const code = ((b & 0x07) << 18) | (b2 << 12) | (b3 << 6) | b4;
			// Encode as surrogate pair
			const hi = ((code - 0x10000) >> 10) + 0xd800;
			const lo = ((code - 0x10000) & 0x3ff) + 0xdc00;
			result += String.fromCharCode(hi, lo);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// URI encoding
// ---------------------------------------------------------------------------

/** Percent-encode a string (jq @uri semantics). */
export function uriEncode(input: string): string {
	let result = '';
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		const code = input.charCodeAt(i);
		// Unreserved chars per RFC 3986
		if (
			(code >= 0x41 && code <= 0x5a) || // A-Z
			(code >= 0x61 && code <= 0x7a) || // a-z
			(code >= 0x30 && code <= 0x39) || // 0-9
			ch === '-' ||
			ch === '_' ||
			ch === '.' ||
			ch === '~'
		) {
			result += ch;
		} else {
			// Encode each UTF-8 byte
			const bytes = utf8Encode(ch);
			for (let j = 0; j < bytes.length; j++) {
				result += `%${bytes[j].toString(16).toUpperCase().padStart(2, '0')}`;
			}
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** Format a value for CSV output. Input must be an array. */
export function csvFormat(input: JsonValue): string {
	if (!Array.isArray(input)) {
		return typeof input === 'string' ? input : jsonStringify(input);
	}
	const fields: string[] = [];
	for (let i = 0; i < input.length; i++) {
		const v = input[i];
		if (typeof v === 'string') {
			// Quote if contains comma, quote, or newline
			if (v.includes(',') || v.includes('"') || v.includes('\n')) {
				fields.push(`"${v.replace(/"/g, '""')}"`);
			} else {
				fields.push(v);
			}
		} else if (v === null) {
			fields.push('');
		} else {
			fields.push(String(v));
		}
	}
	return fields.join(',');
}

/** Format a value for TSV output. Input must be an array. */
export function tsvFormat(input: JsonValue): string {
	if (!Array.isArray(input)) {
		return typeof input === 'string' ? input : jsonStringify(input);
	}
	const fields: string[] = [];
	for (let i = 0; i < input.length; i++) {
		const v = input[i];
		if (typeof v === 'string') {
			// Escape tabs, newlines, backslashes
			let escaped = '';
			for (let j = 0; j < v.length; j++) {
				const ch = v[j];
				if (ch === '\t') escaped += '\\t';
				else if (ch === '\n') escaped += '\\n';
				else if (ch === '\r') escaped += '\\r';
				else if (ch === '\\') escaped += '\\\\';
				else escaped += ch;
			}
			fields.push(escaped);
		} else if (v === null) {
			fields.push('');
		} else {
			fields.push(String(v));
		}
	}
	return fields.join('\t');
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export function htmlEscape(input: string): string {
	let result = '';
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === '<') result += '&lt;';
		else if (ch === '>') result += '&gt;';
		else if (ch === '&') result += '&amp;';
		else if (ch === "'") result += '&#39;';
		else if (ch === '"') result += '&quot;';
		else result += ch;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Shell escape
// ---------------------------------------------------------------------------

export function shEscape(input: string): string {
	return `'${input.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Date/time helpers
// ---------------------------------------------------------------------------

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];
const MONTHS_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function pad3(n: number): string {
	if (n < 10) return `00${n}`;
	if (n < 100) return `0${n}`;
	return String(n);
}

function dayOfYear(d: Date): number {
	const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

/** Hand-written strftime. Operates on UTC. */
export function strftime(format: string, timestamp: number): string {
	const d = new Date(timestamp * 1000);
	let result = '';
	let i = 0;
	while (i < format.length) {
		if (format[i] === '%' && i + 1 < format.length) {
			const spec = format[i + 1];
			i += 2;
			switch (spec) {
				case 'Y':
					result += String(d.getUTCFullYear());
					break;
				case 'm':
					result += pad2(d.getUTCMonth() + 1);
					break;
				case 'd':
					result += pad2(d.getUTCDate());
					break;
				case 'H':
					result += pad2(d.getUTCHours());
					break;
				case 'M':
					result += pad2(d.getUTCMinutes());
					break;
				case 'S':
					result += pad2(d.getUTCSeconds());
					break;
				case 'z':
					result += '+0000';
					break;
				case 'Z':
					result += 'UTC';
					break;
				case 'a':
					result += DAYS_SHORT[d.getUTCDay()];
					break;
				case 'A':
					result += DAYS_LONG[d.getUTCDay()];
					break;
				case 'b':
				case 'h':
					result += MONTHS_SHORT[d.getUTCMonth()];
					break;
				case 'B':
					result += MONTHS_LONG[d.getUTCMonth()];
					break;
				case 'c':
					result += `${DAYS_SHORT[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
					break;
				case 'j':
					result += pad3(dayOfYear(d));
					break;
				case 'u':
					result += String(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
					break;
				case 'w':
					result += String(d.getUTCDay());
					break;
				case 's':
					result += String(Math.floor(timestamp));
					break;
				case 'e':
					result += d.getUTCDate() < 10 ? ` ${d.getUTCDate()}` : String(d.getUTCDate());
					break;
				case 'n':
					result += '\n';
					break;
				case 't':
					result += '\t';
					break;
				case '%':
					result += '%';
					break;
				default:
					result += `%${spec}`;
			}
		} else {
			result += format[i];
			i++;
		}
	}
	return result;
}

/** Convert a broken-down time array [Y,M-1,D,H,m,s,dow,yday] to an object-like structure. */
export function gmtime(timestamp: number): JsonValue[] {
	const d = new Date(timestamp * 1000);
	return [
		d.getUTCFullYear(),
		d.getUTCMonth(),
		d.getUTCDate(),
		d.getUTCHours(),
		d.getUTCMinutes(),
		d.getUTCSeconds(),
		d.getUTCDay(),
		dayOfYear(d) - 1,
	];
}

/** Convert broken-down time array back to Unix timestamp. */
export function mktime(parts: JsonValue[]): number {
	if (parts.length < 6) return 0;
	const y = parts[0] as number;
	const m = parts[1] as number;
	const day = parts[2] as number;
	const h = parts[3] as number;
	const min = parts[4] as number;
	const s = parts[5] as number;
	return Date.UTC(y, m, day, h, min, s) / 1000;
}

// ---------------------------------------------------------------------------
// Unified format dispatcher
// ---------------------------------------------------------------------------

/** Apply a named format to a string value. */
export function applyFormat(name: string, value: string): string {
	switch (name) {
		case 'base64':
			return base64Encode(value);
		case 'base64d':
			return base64Decode(value);
		case 'uri':
			return uriEncode(value);
		case 'csv':
			// @csv on a string just returns the string
			return value;
		case 'tsv':
			return value;
		case 'json':
			return JSON.stringify(value);
		case 'html':
			return htmlEscape(value);
		case 'sh':
			return shEscape(value);
		case 'text':
			return value;
		default:
			throw new Error(`unknown format: @${name}`);
	}
}

/** Apply a named format to a JSON value. Coerces to string via tostring first where needed. */
export function applyFormatValue(name: string, value: JsonValue): string {
	switch (name) {
		case 'csv':
			return csvFormat(value);
		case 'tsv':
			return tsvFormat(value);
		case 'json':
			return jsonStringify(value);
		case 'base64':
			return base64Encode(typeof value === 'string' ? value : jsonStringify(value));
		case 'base64d':
			return base64Decode(typeof value === 'string' ? value : jsonStringify(value));
		case 'uri':
			return uriEncode(typeof value === 'string' ? value : jsonStringify(value));
		case 'html':
			return htmlEscape(typeof value === 'string' ? value : jsonStringify(value));
		case 'sh':
			return shEscape(typeof value === 'string' ? value : jsonStringify(value));
		case 'text':
			return typeof value === 'string' ? value : jsonStringify(value);
		default:
			throw new Error(`unknown format: @${name}`);
	}
}
