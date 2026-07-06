import { describe, expect, it } from 'vitest';

import { mergeText } from './textMerge';

describe('mergeText', () => {
  const base = 'line1\nline2\nline3\n';

  it('returns the other side when one side is unchanged from base', () => {
    const theirs = 'line1\nline2 changed\nline3\n';
    expect(mergeText(base, base, theirs)).toBe(theirs);
    expect(mergeText(base, theirs, base)).toBe(theirs);
  });

  it('returns the content when both sides made the identical edit', () => {
    const both = 'line1\nline2 same\nline3\n';
    expect(mergeText(base, both, both)).toBe(both);
  });

  it('merges non-overlapping edits on different lines', () => {
    const ours = 'line1 mine\nline2\nline3\n';
    const theirs = 'line1\nline2\nline3 theirs\n';
    expect(mergeText(base, ours, theirs)).toBe('line1 mine\nline2\nline3 theirs\n');
  });

  it('returns null when both sides edit the same line differently', () => {
    const ours = 'line1 A\nline2\nline3\n';
    const theirs = 'line1 B\nline2\nline3\n';
    expect(mergeText(base, ours, theirs)).toBeNull();
  });

  it('merges disjoint insertions', () => {
    const ours = 'line0\nline1\nline2\nline3\n';
    const theirs = 'line1\nline2\nline3\nline4\n';
    expect(mergeText(base, ours, theirs)).toBe('line0\nline1\nline2\nline3\nline4\n');
  });
});
