import { describe, expect, it } from 'vitest';

import { findSearchJumpRange } from './searchNavigation';

describe('findSearchJumpRange', () => {
  it('returns the first match when content contains multiple occurrences', () => {
    const result = findSearchJumpRange('alpha beta gamma beta', 'beta');

    expect(result).toEqual({ from: 6, to: 10 });
  });

  it('matches case-insensitively', () => {
    const result = findSearchJumpRange('Alpha SearchTerm omega', 'searchterm');

    expect(result).toEqual({ from: 6, to: 16 });
  });

  it('returns null when the query is missing or blank', () => {
    expect(findSearchJumpRange('Alpha beta', 'missing')).toBeNull();
    expect(findSearchJumpRange('Alpha beta', '   ')).toBeNull();
  });
});
