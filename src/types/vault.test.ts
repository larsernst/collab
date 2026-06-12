import { describe, expect, it } from 'vitest';

import { isVaultReadOnly, type HostedVaultMeta, type LocalVaultMeta } from './vault';

const localVault: LocalVaultMeta = {
  kind: 'local',
  id: 'local-1',
  name: 'Local',
  path: '/vault',
  lastOpened: 0,
  isEncrypted: false,
};

const hostedVault = (role: HostedVaultMeta['role']): HostedVaultMeta => ({
  kind: 'hosted',
  id: 'hosted-1',
  hostedVaultId: 'hosted-1',
  serverUrl: 'https://collab.example.test',
  role,
  name: 'Hosted',
  path: 'hosted://hosted-1',
  lastOpened: 0,
  isEncrypted: false,
});

describe('isVaultReadOnly', () => {
  it('is false for null and local vaults', () => {
    expect(isVaultReadOnly(null)).toBe(false);
    expect(isVaultReadOnly(undefined)).toBe(false);
    expect(isVaultReadOnly(localVault)).toBe(false);
    // Legacy local metadata without an explicit kind is treated as local/writable.
    expect(isVaultReadOnly({ ...localVault, kind: undefined })).toBe(false);
  });

  it('is true only for a hosted viewer', () => {
    expect(isVaultReadOnly(hostedVault('viewer'))).toBe(true);
    expect(isVaultReadOnly(hostedVault('editor'))).toBe(false);
    expect(isVaultReadOnly(hostedVault('admin'))).toBe(false);
  });
});
