/**
 * Typed mirror of the native hosted-vault replica store (Phase 6 offline-sync
 * foundation). The replica is a per-vault on-disk cache the native side manages;
 * these types match the camelCase shapes the Tauri commands round-trip, and the
 * helpers here seed a replica when a hosted vault is opened.
 *
 * The replica holds vault *content* only — never tokens.
 */

import { tauriCommands } from './tauri';
import type { HostedVaultMeta } from '../types/vault';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface ReplicaSyncState {
  /** The server manifest sequence the replica last observed. */
  manifestSequence: number;
  /** ISO-8601 timestamp of the last successful synchronization, if any. */
  lastSyncedAt: string | null;
  status: SyncStatus;
}

export type PendingOpKind =
  | 'create'
  | 'edit'
  | 'rename'
  | 'move'
  | 'trash'
  | 'restore'
  | 'delete'
  | 'assetUpload';

export type PendingOpStatus = 'pending' | 'inflight' | 'failed';

export interface PendingOperation {
  id: string;
  kind: PendingOpKind;
  fileId: string | null;
  relativePath: string | null;
  payload: unknown;
  /** The manifest sequence the operation was authored against. */
  baseManifestSequence: number;
  createdAt: string;
  status: PendingOpStatus;
}

export interface Tombstone {
  fileId: string;
  relativePath: string;
  deletedAt: string;
}

export interface ReplicaIntegrityReport {
  ok: boolean;
  corruptFiles: string[];
}

/**
 * The server manifest shape persisted verbatim in the replica. Only the fields
 * the replica seeding relies on are typed; the full server payload (including
 * trashed-file metadata) is passed through unchanged.
 */
export interface ReplicaManifest {
  vaultId: string;
  sequence: number;
  files: unknown[];
}

export function initialSyncState(manifestSequence: number): ReplicaSyncState {
  return { manifestSequence, lastSyncedAt: new Date().toISOString(), status: 'idle' };
}

/**
 * Seed (create or refresh) the local replica for a hosted vault from the current
 * server manifest. Best-effort: callers should not let a failure here block
 * opening the vault.
 */
export async function seedReplicaFromManifest(vault: HostedVaultMeta): Promise<void> {
  const manifest = await tauriCommands.hostedVaultRequest<ReplicaManifest>(
    vault.serverUrl,
    'GET',
    `/api/v1/vaults/${vault.hostedVaultId}/manifest`,
  );
  await tauriCommands.replicaSeed(
    vault.serverUrl,
    vault.hostedVaultId,
    vault.name,
    manifest,
    initialSyncState(manifest.sequence),
  );
}
