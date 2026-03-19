import { describe, expect, it } from 'vitest';
import { briefDiff, diff, unifiedDiff } from '../../src/utils/diff.js';

describe('briefDiff', () => {
  it('returns false for identical strings', () => {
    expect(briefDiff('hello', 'hello')).toBe(false);
  });

  it('returns true for different strings', () => {
    expect(briefDiff('hello', 'world')).toBe(true);
  });

  it('returns false for two empty strings', () => {
    expect(briefDiff('', '')).toBe(false);
  });

  it('returns true when one is empty', () => {
    expect(briefDiff('hello', '')).toBe(true);
  });
});

describe('unifiedDiff', () => {
  it('returns empty string for identical files', () => {
    expect(unifiedDiff('hello\n', 'hello\n')).toBe('');
  });

  it('shows a single line change', () => {
    const result = unifiedDiff('hello\n', 'world\n');
    expect(result).toContain('-hello');
    expect(result).toContain('+world');
    expect(result).toContain('--- a');
    expect(result).toContain('+++ b');
    expect(result).toContain('@@ -1 +1 @@');
  });

  it('shows addition of a line', () => {
    const result = unifiedDiff('a\n', 'a\nb\n');
    expect(result).toContain('+b');
  });

  it('shows deletion of a line', () => {
    const result = unifiedDiff('a\nb\n', 'a\n');
    expect(result).toContain('-b');
  });

  it('uses custom labels', () => {
    const result = unifiedDiff('a\n', 'b\n', { labelA: 'original', labelB: 'modified' });
    expect(result).toContain('--- original');
    expect(result).toContain('+++ modified');
  });

  it('handles empty original', () => {
    const result = unifiedDiff('', 'hello\n');
    expect(result).toContain('+hello');
  });

  it('handles empty modified', () => {
    const result = unifiedDiff('hello\n', '');
    expect(result).toContain('-hello');
  });

  it('handles both empty', () => {
    expect(unifiedDiff('', '')).toBe('');
  });

  it('includes context lines', () => {
    const a = 'line1\nline2\nline3\nline4\nline5\n';
    const b = 'line1\nline2\nchanged\nline4\nline5\n';
    const result = unifiedDiff(a, b, { context: 1 });
    expect(result).toContain(' line2');
    expect(result).toContain('-line3');
    expect(result).toContain('+changed');
    expect(result).toContain(' line4');
  });

  it('handles context: 0', () => {
    const result = unifiedDiff('a\nb\nc\n', 'a\nX\nc\n', { context: 0 });
    expect(result).toContain('-b');
    expect(result).toContain('+X');
    // Should not have context lines (lines starting with space followed by content)
    const lines = result.split('\n');
    const contextLines = lines.filter(
      (l) => l.startsWith(' ') && !l.startsWith('---') && !l.startsWith('+++'),
    );
    expect(contextLines).toEqual([]);
  });

  it('produces valid hunk header format', () => {
    const result = unifiedDiff('a\nb\n', 'a\nc\n');
    const hunkMatch = result.match(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/);
    expect(hunkMatch).not.toBeNull();
  });

  it('handles multi-line additions', () => {
    const a = 'start\nend\n';
    const b = 'start\nnew1\nnew2\nnew3\nend\n';
    const result = unifiedDiff(a, b);
    expect(result).toContain('+new1');
    expect(result).toContain('+new2');
    expect(result).toContain('+new3');
  });

  it('handles multi-line deletions', () => {
    const a = 'start\nold1\nold2\nold3\nend\n';
    const b = 'start\nend\n';
    const result = unifiedDiff(a, b);
    expect(result).toContain('-old1');
    expect(result).toContain('-old2');
    expect(result).toContain('-old3');
  });

  it('handles replacement of multiple lines', () => {
    const a = 'a\nb\nc\n';
    const b = 'x\ny\nz\n';
    const result = unifiedDiff(a, b);
    expect(result).toContain('-a');
    expect(result).toContain('-b');
    expect(result).toContain('-c');
    expect(result).toContain('+x');
    expect(result).toContain('+y');
    expect(result).toContain('+z');
  });

  it('handles changes at the beginning', () => {
    const a = 'old\nkeep\n';
    const b = 'new\nkeep\n';
    const result = unifiedDiff(a, b);
    expect(result).toContain('-old');
    expect(result).toContain('+new');
    expect(result).toContain(' keep');
  });

  it('handles changes at the end', () => {
    const a = 'keep\nold\n';
    const b = 'keep\nnew\n';
    const result = unifiedDiff(a, b);
    expect(result).toContain(' keep');
    expect(result).toContain('-old');
    expect(result).toContain('+new');
  });

  it('handles no trailing newline marker', () => {
    const result = unifiedDiff('hello', 'world');
    expect(result).toContain('\\ No newline at end of file');
  });
});

describe('diff (legacy export)', () => {
  it('calls unifiedDiff', () => {
    expect(diff('a\n', 'a\n')).toBe('');
    expect(diff('a\n', 'b\n')).toContain('-a');
  });
});
