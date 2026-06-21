import { beforeEach, describe, expect, it, vi } from 'vitest';

import { syncRollup, useSyncStore } from './syncStore';
import { tauriCommands } from '../lib/tauri';
import {
  discardPendingOperation,
  listPendingOperationRecoveries,
  makeHostedVaultAvailableOffline,
  retryPendingOperation,
  syncReplicaManifestDelta,
  type PendingOperation,
  type PendingOperationRecovery,
} from '../lib/vaultReplica';
import type { HostedVaultMeta } from '../types/vault';

vi.mock('../lib/tauri', () => ({
  tauriCommands: {
    replicaReadSyncState: vi.fn(),
    replicaListPendingOperations: vi.fn(),
    replicaDelete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/vaultReplica', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/vaultReplica')>();
  return {
    onReplicaMutated: vi.fn(() => () => {}),
    listPendingOperationRecoveries: vi.fn(),
    retryPendingOperation: vi.fn().mockResolvedValue(undefined),
    discardPendingOperation: vi.fn().mockResolvedValue(undefined),
    makeHostedVaultAvailableOffline: vi.fn().mockResolvedValue({ documentsCached: 1, assetsCached: 2, skipped: 0 }),
    syncReplicaManifestDelta: vi.fn().mockResolvedValue({}),
    // Use the real classifier/derivation/connectivity helpers.
    classifyVaultAccessError: actual.classifyVaultAccessError,
    deriveVaultAccess: actual.deriveVaultAccess,
    isLikelyConnectivityError: actual.isLikelyConnectivityError,
  };
});

const vault: HostedVaultMeta = {
  kind: 'hosted',
  id: 'vault-1',
  hostedVaultId: 'vault-1',
  serverUrl: 'https://collab.example.test',
  name: 'Team Vault',
  path: 'hosted://vault-1',
  lastOpened: 1,
  isEncrypted: false,
  role: 'editor',
};

function pending(id: string, status: PendingOperation['status'] = 'pending'): PendingOperation {
  return {
    id,
    kind: 'edit',
    fileId: 'f1',
    relativePath: 'Notes/a.md',
    payload: {},
    baseManifestSequence: 1,
    createdAt: '2026-06-18T00:00:00Z',
    status,
  };
}

function recovery(id: string): PendingOperationRecovery {
  return {
    operation: { ...pending(id, 'failed') },
    failure: { code: 'manifest_conflict', message: 'The vault manifest changed.' },
    recommendedAction: 'retry-after-refresh',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSyncStore.getState().clear();
  vi.mocked(tauriCommands.replicaReadSyncState).mockResolvedValue({
    manifestSequence: 3,
    lastSyncedAt: '2026-06-18T00:00:00Z',
    status: 'idle',
  });
  vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([]);
  vi.mocked(listPendingOperationRecoveries).mockResolvedValue([]);
});

describe('syncRollup', () => {
  it('prioritizes conflicts over syncing, pending, and synced', () => {
    expect(syncRollup({ isSyncing: true, status: 'syncing', pending: [pending('a')], failed: [recovery('b')] })).toBe('conflicts');
    expect(syncRollup({ isSyncing: true, status: 'idle', pending: [pending('a')], failed: [] })).toBe('syncing');
    expect(syncRollup({ isSyncing: false, status: 'offline', pending: [pending('a')], failed: [] })).toBe('pending');
    expect(syncRollup({ isSyncing: false, status: 'idle', pending: [], failed: [] })).toBe('synced');
  });
});

describe('syncStore', () => {
  it('refresh splits pending from failed operations', async () => {
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([
      pending('a'),
      pending('b', 'inflight'),
      pending('c', 'failed'),
    ]);
    vi.mocked(listPendingOperationRecoveries).mockResolvedValue([recovery('c')]);

    await useSyncStore.getState().refresh(vault);

    const state = useSyncStore.getState();
    expect(state.pending.map((op) => op.id)).toEqual(['a', 'b']);
    expect(state.failed.map((r) => r.operation.id)).toEqual(['c']);
    expect(state.lastSyncedAt).toBe('2026-06-18T00:00:00Z');
  });

  it('syncNow runs a manifest delta sync then refreshes', async () => {
    await useSyncStore.getState().syncNow(vault);
    expect(syncReplicaManifestDelta).toHaveBeenCalledWith(vault);
    expect(tauriCommands.replicaReadSyncState).toHaveBeenCalled();
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('retry re-queues the operation and triggers a sync', async () => {
    await useSyncStore.getState().retry(vault, 'op-1');
    expect(retryPendingOperation).toHaveBeenCalledWith(vault, 'op-1');
    expect(syncReplicaManifestDelta).toHaveBeenCalledWith(vault);
  });

  it('discard removes the operation and refreshes', async () => {
    await useSyncStore.getState().discard(vault, 'op-1');
    expect(discardPendingOperation).toHaveBeenCalledWith(vault, 'op-1');
    expect(tauriCommands.replicaListPendingOperations).toHaveBeenCalled();
  });

  it('makeAvailableOffline caches hosted content and refreshes the sync snapshot', async () => {
    const progress = vi.fn();
    const report = await useSyncStore.getState().makeAvailableOffline(vault, progress);
    expect(makeHostedVaultAvailableOffline).toHaveBeenCalledWith(vault, progress);
    expect(report).toEqual({ documentsCached: 1, assetsCached: 2, skipped: 0 });
    expect(tauriCommands.replicaReadSyncState).toHaveBeenCalled();
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('derives revoked access from a permission-denied replay failure', async () => {
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([pending('c', 'failed')]);
    vi.mocked(listPendingOperationRecoveries).mockResolvedValue([
      {
        operation: pending('c', 'failed'),
        failure: { code: 'permission_revoked', message: 'forbidden' },
        recommendedAction: 'reconnect-account',
      },
    ]);
    await useSyncStore.getState().refresh(vault);
    expect(useSyncStore.getState().access).toBe('revoked');
  });

  it('classifies access loss on a syncNow network rejection with no pending ops', async () => {
    vi.mocked(syncReplicaManifestDelta).mockRejectedValueOnce(new Error('resource_not_found'));
    await useSyncStore.getState().syncNow(vault);
    expect(useSyncStore.getState().access).toBe('unavailable');
  });

  it('removeReplica deletes the local replica and clears state', async () => {
    useSyncStore.setState({ access: 'revoked', pending: [pending('a')] });
    await useSyncStore.getState().removeReplica(vault);
    expect(tauriCommands.replicaDelete).toHaveBeenCalledWith(vault.serverUrl, vault.hostedVaultId);
    expect(useSyncStore.getState().access).toBe('ok');
    expect(useSyncStore.getState().pending).toEqual([]);
  });
});
