/**
 * Test whether a text string matches a glob pattern.
 * Supports: *, ?, [...], [!...], [^...], [a-z] ranges.
 * Does NOT match / for * and ? (they are segment-level).
 *
 * @param pattern - The glob pattern
 * @param text - The text to test
 * @returns true if the text matches the pattern
 */
export function globMatch(pattern: string, text: string): boolean {
	return matchAt(pattern, 0, text, 0);
}

function matchAt(pattern: string, startPi: number, text: string, startTi: number): boolean {
	let pi = startPi;
	let ti = startTi;

	while (pi < pattern.length) {
		const pc = pattern[pi];

		if (pc === '*') {
			// Skip consecutive *
			while (pi < pattern.length && pattern[pi] === '*') {
				pi++;
			}

			// Trailing * matches everything (except /)
			if (pi >= pattern.length) {
				for (let k = ti; k < text.length; k++) {
					if (text[k] === '/') return false;
				}
				return true;
			}

			// Try matching * against 0, 1, 2, ... characters
			for (let k = ti; k <= text.length; k++) {
				if (k > ti && text[k - 1] === '/') break;
				if (matchAt(pattern, pi, text, k)) return true;
			}
			return false;
		}

		if (pc === '?') {
			if (ti >= text.length || text[ti] === '/') return false;
			pi++;
			ti++;
			continue;
		}

		if (pc === '[') {
			if (ti >= text.length) return false;
			const tc = text[ti];

			pi++; // skip [
			let negated = false;
			if (pi < pattern.length && (pattern[pi] === '!' || pattern[pi] === '^')) {
				negated = true;
				pi++;
			}

			let matched = false;
			let first = true;
			while (pi < pattern.length && (pattern[pi] !== ']' || first)) {
				first = false;
				const rangeStart = pattern[pi];
				pi++;

				// Range: a-z
				if (pi + 1 < pattern.length && pattern[pi] === '-' && pattern[pi + 1] !== ']') {
					const rangeEnd = pattern[pi + 1];
					pi += 2;
					const startCode = rangeStart.charCodeAt(0);
					const endCode = rangeEnd.charCodeAt(0);
					const tcCode = tc.charCodeAt(0);
					if (startCode <= endCode) {
						if (tcCode >= startCode && tcCode <= endCode) matched = true;
					} else {
						if (tcCode >= endCode && tcCode <= startCode) matched = true;
					}
				} else {
					if (tc === rangeStart) matched = true;
				}
			}

			if (pi < pattern.length) pi++; // skip ]

			if (negated ? matched : !matched) return false;
			ti++;
			continue;
		}

		// Literal character
		if (ti >= text.length) return false;
		if (pc !== text[ti]) return false;
		pi++;
		ti++;
	}

	return ti >= text.length;
}

/**
 * Test whether a path matches a glob pattern with ** (globstar) support.
 * ** matches zero or more directories.
 *
 * @param pattern - Glob pattern possibly containing **
 * @param path - The path to test
 * @returns true if the path matches
 */
export function globMatchPath(pattern: string, path: string): boolean {
	if (!pattern.includes('**')) {
		return globMatch(pattern, path);
	}

	const patParts = pattern.split('**');
	return splitGlobstar(patParts, path);
}

/**
 * Split-based globstar matching.
 */
function splitGlobstar(patParts: string[], path: string): boolean {
	if (patParts.length === 0) return path.length === 0;
	if (patParts.length === 1) return globMatch(patParts[0], path);

	const prefix = patParts[0];
	const rest = patParts.slice(1);

	if (prefix.length > 0) {
		for (let i = 0; i <= path.length; i++) {
			const candidate = path.slice(0, i);
			if (globMatch(prefix, candidate)) {
				if (splitGlobstar(rest, path.slice(i))) return true;
			}
		}
		return false;
	}

	// Empty prefix means ** at the start
	for (let i = 0; i <= path.length; i++) {
		if (i > 0 && path[i - 1] !== '/') continue;
		if (splitGlobstar(rest, path.slice(i))) return true;
	}
	return splitGlobstar(rest, '');
}
