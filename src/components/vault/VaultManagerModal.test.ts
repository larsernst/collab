import { describe, expect, it } from 'vitest';

import { vaultManagerTabIds } from './VaultManagerModal';

describe('vaultManagerTabIds', () => {
  it('hides permission management for local vaults', () => {
    expect(vaultManagerTabIds('local')).toEqual(['vaults', 'encryption']);
  });

  it('reserves permission management for hosted vaults', () => {
    expect(vaultManagerTabIds('hosted')).toEqual(['vaults', 'permissions', 'offline']);
  });
});
