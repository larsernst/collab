import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostedVaultMeta } from '../types/vault';
import { tauriCommands } from './tauri';
import { initialSyncState, seedReplicaFromManifest } from './vaultReplica';

vi.mock('./tauri', () => ({
  tauriCommands: {
    hostedVaultRequest: vi.fn(),
    replicaSeed: vi.fn().mockResolvedValue(undefined),
  },
}));

const hostedVault: HostedVaultMeta = {
  id: 'hosted-vault',
  kind: 'hosted',
  hostedVaultId: 'hosted-vault',
  serverUrl: 'https://collab.example.test',
  role: 'editor',
  name: 'Hosted Vault',
  path: 'hosted://hosted-vault',
  lastOpened: 1,
  isEncrypted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vaultReplica', () => {
  it('initialSyncState carries the manifest sequence and idle status', () => {
    const state = initialSyncState(12);
    expect(state.manifestSequence).toBe(12);
    expect(state.status).toBe('idle');
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('seeds the replica from the fetched server manifest', async () => {
    const manifest = { vaultId: 'hosted-vault', sequence: 9, files: [] };
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue(manifest);

    await seedReplicaFromManifest(hostedVault);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/manifest',
    );
    expect(tauriCommands.replicaSeed).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'Hosted Vault',
      manifest,
      expect.objectContaining({ manifestSequence: 9, status: 'idle' }),
    );
  });

  it('propagates fetch failures so callers can treat seeding as best-effort', async () => {
    vi.mocked(tauriCommands.hostedVaultRequest).mockRejectedValue(new Error('offline'));
    await expect(seedReplicaFromManifest(hostedVault)).rejects.toThrow('offline');
    expect(tauriCommands.replicaSeed).not.toHaveBeenCalled();
  });
});
