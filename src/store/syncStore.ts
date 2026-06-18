import { create } from 'zustand';

import type { HostedVaultMeta } from '../types/vault';
import {
  classifyVaultAccessError,
  deriveVaultAccess,
  discardPendingOperation,
  isLikelyConnectivityError,
  listPendingOperationRecoveries,
  retryPendingOperation,
  syncReplicaManifestDelta,
  type PendingOperation,
  type PendingOperationRecovery,
  type SyncStatus,
  type VaultAccessState,
} from '../lib/vaultReplica';
import { tauriCommands } from '../lib/tauri';

/** The coarse rollup the status-bar indicator renders. */
export type SyncRollup = 'synced' | 'syncing' | 'pending' | 'conflicts';

interface SyncStoreState {
  /** `serverUrl|vaultId` the current snapshot belongs to, or null when not hosted. */
  vaultKey: string | null;
  /** Replica sync-state status from the last refresh. */
  status: SyncStatus;
  lastSyncedAt: string | null;
  /** Queued operations not yet confirmed by the server (pending + inflight). */
  pending: PendingOperation[];
  /** Operations whose replay failed and need user recovery. */
  failed: PendingOperationRecovery[];
  /** Whether the connected user can still sync this vault. */
  access: VaultAccessState;
  /** True while a manual `syncNow` is running. */
  isSyncing: boolean;

  refresh: (vault: HostedVaultMeta) => Promise<void>;
  syncNow: (vault: HostedVaultMeta) => Promise<void>;
  retry: (vault: HostedVaultMeta, operationId: string) => Promise<void>;
  discard: (vault: HostedVaultMeta, operationId: string) => Promise<void>;
  /** Permanently remove the local replica (used after access is lost). */
  removeReplica: (vault: HostedVaultMeta) => Promise<void>;
  clear: () => void;
}

function vaultKeyFor(vault: HostedVaultMeta): string {
  return `${vault.serverUrl}|${vault.hostedVaultId}`;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  vaultKey: null,
  status: 'idle',
  lastSyncedAt: null,
  pending: [],
  failed: [],
  access: 'ok',
  isSyncing: false,

  refresh: async (vault) => {
    const key = vaultKeyFor(vault);
    try {
      const [syncState, operations, recoveries] = await Promise.all([
        tauriCommands.replicaReadSyncState(vault.serverUrl, vault.hostedVaultId),
        tauriCommands.replicaListPendingOperations(vault.serverUrl, vault.hostedVaultId),
        listPendingOperationRecoveries(vault),
      ]);
      set({
        vaultKey: key,
        status: syncState.status,
        lastSyncedAt: syncState.lastSyncedAt,
        pending: operations.filter((operation) => operation.status !== 'failed'),
        failed: recoveries,
        // Reflect access loss already recorded by a failed replay. A clean queue
        // resets access to ok (e.g. after the user removes the failed ops).
        access: deriveVaultAccess(recoveries),
      });
    } catch {
      // A read failure (e.g. no replica yet) leaves a clean snapshot for the key.
      set({ vaultKey: key, status: 'idle', lastSyncedAt: null, pending: [], failed: [], access: 'ok' });
    }
  },

  syncNow: async (vault) => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    try {
      // `syncReplicaManifestDelta` replays the pending queue first, then pulls
      // the manifest delta. It emits replica-mutation events that drive a
      // refresh, but refresh once more so the snapshot is current on return.
      await syncReplicaManifestDelta(vault);
      await get().refresh(vault);
    } catch (error) {
      // Refresh so the queue/failed list is current, then classify access loss
      // (covers the no-pending case where `refresh` can't derive it). A plain
      // connectivity error is left to the connection indicator; anything else is
      // rethrown so the caller can surface it.
      await get().refresh(vault);
      const access = classifyVaultAccessError(error);
      if (access) {
        set({ access });
      } else if (!isLikelyConnectivityError(error)) {
        throw error;
      }
    } finally {
      set({ isSyncing: false });
    }
  },

  retry: async (vault, operationId) => {
    await retryPendingOperation(vault, operationId);
    await get().syncNow(vault);
  },

  discard: async (vault, operationId) => {
    await discardPendingOperation(vault, operationId);
    await get().refresh(vault);
  },

  removeReplica: async (vault) => {
    await tauriCommands.replicaDelete(vault.serverUrl, vault.hostedVaultId);
    get().clear();
  },

  clear: () =>
    set({ vaultKey: null, status: 'idle', lastSyncedAt: null, pending: [], failed: [], access: 'ok', isSyncing: false }),
}));

/** Derives the coarse rollup from a snapshot for the status-bar indicator. */
export function syncRollup(state: Pick<SyncStoreState, 'isSyncing' | 'status' | 'pending' | 'failed'>): SyncRollup {
  if (state.failed.length > 0) return 'conflicts';
  if (state.isSyncing || state.status === 'syncing') return 'syncing';
  if (state.pending.length > 0) return 'pending';
  return 'synced';
}
