/**
 * Regex complexity checks to prevent ReDoS attacks.
 *
 * Detects patterns that are known to cause catastrophic backtracking
 * in native RegExp: nested quantifiers, overlapping alternations with
 * quantifiers, and backreferences inside quantified groups.
 */

/** Maximum allowed regex pattern length. */
const MAX_PATTERN_LENGTH = 1000;

/** Maximum allowed length for the string being matched. */
const MAX_SUBJECT_LENGTH = 100_000;

/**
 * Check if a regex pattern is safe to compile and execute.
 * Returns null if safe, or an error message if unsafe.
 */
export function checkRegexSafety(pattern: string): string | null {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return `regex pattern too long (${pattern.length} > ${MAX_PATTERN_LENGTH})`;
	}

	if (hasNestedQuantifiers(pattern)) {
		return 'regex rejected: nested quantifiers detected (potential ReDoS)';
	}

	if (hasBackreferenceInQuantifiedGroup(pattern)) {
		return 'regex rejected: backreference inside quantified group (potential ReDoS)';
	}

	return null;
}

/**
 * Validate that the subject string length is within bounds.
 */
export function checkSubjectLength(subject: string): string | null {
	if (subject.length > MAX_SUBJECT_LENGTH) {
		return `regex match subject too long (${subject.length} > ${MAX_SUBJECT_LENGTH})`;
	}
	return null;
}

/**
 * Detect nested quantifiers like (a+)+, (a*)+, (a+)*, (.+)*, etc.
 * These are the primary cause of catastrophic backtracking.
 *
 * Strategy: parse the pattern tracking group nesting and quantifier positions.
 * If a group that contains a quantifier is itself followed by a quantifier,
 * the pattern is unsafe.
 */
function hasNestedQuantifiers(pattern: string): boolean {
	// Track groups: each entry is whether the group contains a quantifier
	const groupStack: boolean[] = [];
	let i = 0;

	while (i < pattern.length) {
		const ch = pattern[i];

		// Skip escaped characters
		if (ch === '\\') {
			i += 2;
			continue;
		}

		// Skip character classes entirely
		if (ch === '[') {
			i++;
			// Skip leading ] or ^ in character class
			if (i < pattern.length && pattern[i] === '^') i++;
			if (i < pattern.length && pattern[i] === ']') i++;
			while (i < pattern.length && pattern[i] !== ']') {
				if (pattern[i] === '\\') i++;
				i++;
			}
			i++; // skip closing ]
			continue;
		}

		if (ch === '(') {
			groupStack.push(false);
			i++;
			// Skip non-capturing group markers like ?: ?= ?! ?<
			if (i < pattern.length && pattern[i] === '?') {
				i++;
				// Skip until we find the end of the group modifier
				while (
					i < pattern.length &&
					pattern[i] !== ')' &&
					pattern[i] !== ':' &&
					pattern[i] !== '<'
				) {
					i++;
				}
				if (i < pattern.length && (pattern[i] === ':' || pattern[i] === '<')) {
					i++;
				}
			}
			continue;
		}

		if (ch === ')') {
			const groupHasQuantifier = groupStack.length > 0 ? (groupStack.pop() as boolean) : false;
			i++;

			// Check if this group is followed by a quantifier
			if (groupHasQuantifier && i < pattern.length && isQuantifier(pattern, i)) {
				return true;
			}

			// If this group is itself quantified, mark the parent group as having a quantifier
			if (i < pattern.length && isQuantifier(pattern, i)) {
				if (groupStack.length > 0) {
					groupStack[groupStack.length - 1] = true;
				}
			}

			continue;
		}

		// Check for quantifiers on atoms (not groups) - mark parent group
		if (isQuantifier(pattern, i)) {
			if (groupStack.length > 0) {
				groupStack[groupStack.length - 1] = true;
			}
			// Skip past the quantifier
			i = skipQuantifier(pattern, i);
			continue;
		}

		i++;
	}

	return false;
}

/**
 * Check if character at position is a quantifier: *, +, ?, {n,m}
 */
function isQuantifier(pattern: string, pos: number): boolean {
	const ch = pattern[pos];
	return ch === '*' || ch === '+' || ch === '?' || ch === '{';
}

/**
 * Skip past a quantifier and any trailing ? (lazy modifier).
 */
function skipQuantifier(pattern: string, start: number): number {
	let pos = start;
	const ch = pattern[pos];
	if (ch === '*' || ch === '+' || ch === '?') {
		pos++;
		if (pos < pattern.length && pattern[pos] === '?') pos++;
		return pos;
	}
	if (ch === '{') {
		// Skip {n}, {n,}, {n,m}
		pos++;
		while (pos < pattern.length && pattern[pos] !== '}') pos++;
		if (pos < pattern.length) pos++; // skip }
		if (pos < pattern.length && pattern[pos] === '?') pos++;
		return pos;
	}
	return pos + 1;
}

/**
 * Detect backreferences (\1, \2, etc.) inside quantified groups.
 * This can also cause exponential backtracking.
 */
function hasBackreferenceInQuantifiedGroup(pattern: string): boolean {
	// Find all groups that are quantified
	const groupRanges = findQuantifiedGroups(pattern);

	// Check if any backreference exists inside a quantified group
	for (let i = 0; i < pattern.length - 1; i++) {
		if (pattern[i] === '\\' && pattern[i + 1] >= '1' && pattern[i + 1] <= '9') {
			// Found a backreference - check if it's inside any quantified group
			for (let j = 0; j < groupRanges.length; j++) {
				if (i > groupRanges[j][0] && i < groupRanges[j][1]) {
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * Find the start/end positions of groups that are followed by a quantifier.
 */
function findQuantifiedGroups(pattern: string): Array<[number, number]> {
	const result: Array<[number, number]> = [];
	const openStack: number[] = [];
	let i = 0;

	while (i < pattern.length) {
		const ch = pattern[i];

		if (ch === '\\') {
			i += 2;
			continue;
		}

		if (ch === '[') {
			i++;
			if (i < pattern.length && pattern[i] === '^') i++;
			if (i < pattern.length && pattern[i] === ']') i++;
			while (i < pattern.length && pattern[i] !== ']') {
				if (pattern[i] === '\\') i++;
				i++;
			}
			i++;
			continue;
		}

		if (ch === '(') {
			openStack.push(i);
			i++;
			continue;
		}

		if (ch === ')') {
			const openPos = openStack.length > 0 ? (openStack.pop() as number) : 0;
			const closePos = i;
			i++;
			// Check if followed by quantifier
			if (i < pattern.length && isQuantifier(pattern, i)) {
				result.push([openPos, closePos]);
			}
			continue;
		}

		i++;
	}

	return result;
}
