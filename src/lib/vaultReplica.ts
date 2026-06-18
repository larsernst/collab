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

/**
 * Lightweight change notification for the replica's local state (pending-op
 * queue, sync state, cached manifest). The sync UI subscribes so it can refresh
 * immediately after an edit is queued, a replay runs, or a manual sync completes
 * — without waiting for the background poll.
 */
type ReplicaMutationListener = () => void;
const replicaMutationListeners = new Set<ReplicaMutationListener>();

export function onReplicaMutated(listener: ReplicaMutationListener): () => void {
  replicaMutationListeners.add(listener);
  return () => {
    replicaMutationListeners.delete(listener);
  };
}

export function emitReplicaMutated(): void {
  for (const listener of replicaMutationListeners) {
    try {
      listener();
    } catch {
      // A listener failure must never break a replica mutation.
    }
  }
}

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
  failureCode?: string | null;
  failureMessage?: string | null;
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

export interface CacheCleanupReport {
  removedFiles: number;
  freedBytes: number;
  remainingBytes: number;
}

/**
 * Default byte budget for a single vault's cached document/asset/CRDT content.
 * Cached content is re-fetchable from the server, so the cleanup pass evicts the
 * least-recently-used entries above this budget while never touching content
 * referenced by a pending (unsynced) operation.
 */
export const REPLICA_CACHE_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * The server manifest shape persisted verbatim in the replica. Only the fields
 * the replica seeding relies on are typed; the full server payload (including
 * trashed-file metadata) is passed through unchanged.
 */
export interface ReplicaManifest {
  vaultId: string;
  sequence: number;
  files: ReplicaManifestFile[];
}

export interface ReplicaManifestFile {
  id: string;
  [key: string]: unknown;
}

export interface ReplicaManifestDelta {
  vaultId: string;
  baseSequence: number;
  sequence: number;
  changedFiles: ReplicaManifestFile[];
}

export interface QueuePendingOperationInput {
  kind: PendingOpKind;
  fileId: string | null;
  relativePath: string | null;
  payload: unknown;
  baseManifestSequence: number;
}

interface PendingCreatePayload {
  parentId: string | null;
  name: string;
  kind: 'document' | 'folder';
  documentType: 'note' | 'kanban' | 'canvas' | null;
  content: string;
  tempFileId?: string;
}

interface PendingEditPayload {
  targetFileId: string;
  expectedRevisionSequence: number;
  content: string;
}

interface PendingAssetUploadPayload {
  parentId: string | null;
  name: string;
  mediaType: string;
  expectedHash: string;
  assetCacheId: string;
}

interface PendingStructuralPayload {
  targetFileId: string;
  parentId?: string | null;
  [key: string]: unknown;
}

export function initialSyncState(manifestSequence: number): ReplicaSyncState {
  return { manifestSequence, lastSyncedAt: new Date().toISOString(), status: 'idle' };
}

export function offlineSyncState(manifestSequence: number): ReplicaSyncState {
  return { manifestSequence, lastSyncedAt: new Date().toISOString(), status: 'offline' };
}

export function isLikelyConnectivityError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes('offline') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('could not reach') ||
    message.includes('connection') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

export type PendingOperationFailureCode =
  | 'manifest_conflict'
  | 'revision_conflict'
  | 'path_conflict'
  | 'permission_revoked'
  | 'vault_unavailable'
  | 'server_rejected';

export interface PendingOperationFailure {
  code: PendingOperationFailureCode;
  message: string;
}

export interface PendingOperationRecovery {
  operation: PendingOperation;
  failure: PendingOperationFailure;
  recommendedAction: 'retry-after-refresh' | 'restore-manually' | 'reconnect-account' | 'discard-or-contact-admin';
}

/**
 * Whether the connected user can still sync this hosted vault. `revoked` means
 * the user's access was removed; `unavailable` means the vault no longer exists
 * for them (deleted or archived) on the server. In either case the local replica
 * (and any unsynced changes) is retained until the user explicitly removes it —
 * access loss must never silently discard local data.
 */
export type VaultAccessState = 'ok' | 'revoked' | 'unavailable';

/**
 * Classify a server error encountered while syncing as a vault-access change, or
 * `null` when it is an ordinary (connectivity/validation/conflict) error. A
 * removed membership and a deleted vault both surface as `not_found`; archived
 * vaults reject mutations with `vault_archived` — all map to a non-`ok` state.
 */
export function classifyVaultAccessError(error: unknown): Exclude<VaultAccessState, 'ok'> | null {
  const lower = String(error instanceof Error ? error.message : error).toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('forbidden') ||
    lower.includes('unauthorized') ||
    lower.includes('vault_permission_denied')
  ) {
    return 'revoked';
  }
  if (
    lower.includes('not found') ||
    lower.includes('not_found') ||
    lower.includes('resource_not_found') ||
    lower.includes('archived') ||
    lower.includes('pending deletion') ||
    lower.includes('vault_archived') ||
    lower.includes('vault_unavailable')
  ) {
    return 'unavailable';
  }
  return null;
}

/**
 * Derive the vault-access state from recorded pending-operation failures (no
 * network call). Replay records `permission_revoked` / `vault_unavailable` codes
 * when the server rejects queued operations, so a reconnect that lost access is
 * reflected without an extra probe.
 */
export function deriveVaultAccess(recoveries: PendingOperationRecovery[]): VaultAccessState {
  if (recoveries.some((recovery) => recovery.failure.code === 'permission_revoked')) {
    return 'revoked';
  }
  if (recoveries.some((recovery) => recovery.failure.code === 'vault_unavailable')) {
    return 'unavailable';
  }
  return 'ok';
}

export function classifyPendingOperationFailure(error: unknown): PendingOperationFailure {
  const message = String(error instanceof Error ? error.message : error);
  const lower = message.toLowerCase();
  if (lower.includes('manifest has changed') || lower.includes('manifest_conflict')) {
    return { code: 'manifest_conflict', message };
  }
  if (lower.includes('document has changed') || lower.includes('revision_conflict')) {
    return { code: 'revision_conflict', message };
  }
  if (lower.includes('path_conflict') || lower.includes('already exists') || lower.includes('destination')) {
    return { code: 'path_conflict', message };
  }
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('unauthorized')) {
    return { code: 'permission_revoked', message };
  }
  if (lower.includes('archived') || lower.includes('pending deletion') || lower.includes('not found')) {
    return { code: 'vault_unavailable', message };
  }
  return { code: 'server_rejected', message };
}

export async function readCachedReplicaManifest(vault: HostedVaultMeta): Promise<ReplicaManifest | null> {
  return tauriCommands.replicaReadManifest(vault.serverUrl, vault.hostedVaultId);
}

export async function writeOptimisticReplicaManifest(
  vault: HostedVaultMeta,
  manifest: ReplicaManifest,
): Promise<void> {
  await tauriCommands.replicaSeed(
    vault.serverUrl,
    vault.hostedVaultId,
    vault.name,
    manifest,
    offlineSyncState(manifest.sequence),
  );
  emitReplicaMutated();
}

export async function enqueuePendingOperation(
  vault: HostedVaultMeta,
  input: QueuePendingOperationInput,
): Promise<PendingOperation> {
  const operation: PendingOperation = {
    id: crypto.randomUUID(),
    kind: input.kind,
    fileId: input.fileId,
    relativePath: input.relativePath,
    payload: input.payload,
    baseManifestSequence: input.baseManifestSequence,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  await tauriCommands.replicaEnqueueOperation(vault.serverUrl, vault.hostedVaultId, operation);
  emitReplicaMutated();
  return operation;
}

export async function listPendingOperationRecoveries(
  vault: HostedVaultMeta,
): Promise<PendingOperationRecovery[]> {
  const operations = await tauriCommands.replicaListPendingOperations(vault.serverUrl, vault.hostedVaultId);
  return operations
    .filter((operation) => operation.status === 'failed')
    .map((operation) => {
      const fallback = classifyPendingOperationFailure(operation.failureMessage ?? operation.failureCode ?? 'Replay failed.');
      const failure = {
        code: (operation.failureCode as PendingOperationFailureCode | undefined) ?? fallback.code,
        message: operation.failureMessage ?? fallback.message,
      };
      return {
        operation,
        failure,
        recommendedAction: recoveryActionForFailure(failure.code),
      };
    });
}

export async function retryPendingOperation(vault: HostedVaultMeta, operationId: string): Promise<void> {
  await tauriCommands.replicaUpdateOperationStatus(vault.serverUrl, vault.hostedVaultId, operationId, 'pending');
  emitReplicaMutated();
}

export async function discardPendingOperation(vault: HostedVaultMeta, operationId: string): Promise<void> {
  await tauriCommands.replicaRemoveOperation(vault.serverUrl, vault.hostedVaultId, operationId);
  emitReplicaMutated();
}

function recoveryActionForFailure(
  code: PendingOperationFailureCode,
): PendingOperationRecovery['recommendedAction'] {
  switch (code) {
    case 'manifest_conflict':
    case 'revision_conflict':
    case 'path_conflict':
      return 'retry-after-refresh';
    case 'permission_revoked':
      return 'reconnect-account';
    case 'vault_unavailable':
      return 'restore-manually';
    case 'server_rejected':
    default:
      return 'discard-or-contact-admin';
  }
}

function replaceMappedIds<T extends { targetFileId?: string; parentId?: string | null }>(
  payload: T,
  idMap: Map<string, string>,
): T {
  return {
    ...payload,
    targetFileId: payload.targetFileId ? (idMap.get(payload.targetFileId) ?? payload.targetFileId) : payload.targetFileId,
    parentId: payload.parentId ? (idMap.get(payload.parentId) ?? payload.parentId) : payload.parentId,
  };
}

export async function replayPendingOperations(vault: HostedVaultMeta): Promise<void> {
  const operations = await tauriCommands.replicaListPendingOperations(vault.serverUrl, vault.hostedVaultId);
  const replayableOperations = operations.filter((operation) => operation.status !== 'failed');
  if (replayableOperations.length === 0) return;
  const idMap = new Map<string, string>();
  let stoppedForFailure = false;
  for (const operation of replayableOperations) {
    if (operation.status === 'inflight') {
      await tauriCommands.replicaUpdateOperationStatus(vault.serverUrl, vault.hostedVaultId, operation.id, 'pending');
    }
  }
  for (const operation of replayableOperations) {
    await tauriCommands.replicaUpdateOperationStatus(vault.serverUrl, vault.hostedVaultId, operation.id, 'inflight');
    try {
      if (operation.kind === 'create') {
        const payload = operation.payload as PendingCreatePayload;
        const createPayload = {
          parentId: payload.parentId ? (idMap.get(payload.parentId) ?? payload.parentId) : null,
          name: payload.name,
          kind: payload.kind,
          documentType: payload.documentType,
          content: payload.content,
        };
        const created = await tauriCommands.hostedVaultRequest<{ id: string }>(
          vault.serverUrl,
          'POST',
          `/api/v1/vaults/${vault.hostedVaultId}/files`,
          createPayload,
        );
        if (operation.fileId) idMap.set(operation.fileId, created.id);
        if (payload.tempFileId) idMap.set(payload.tempFileId, created.id);
      } else if (operation.kind === 'edit') {
        const payload = replaceMappedIds(operation.payload as PendingEditPayload, idMap);
        await tauriCommands.hostedVaultRequest(
          vault.serverUrl,
          'POST',
          `/api/v1/vaults/${vault.hostedVaultId}/files/${payload.targetFileId}/revisions`,
          { expectedRevisionSequence: payload.expectedRevisionSequence, content: payload.content },
        );
      } else if (operation.kind === 'assetUpload') {
        const payload = replaceMappedIds(operation.payload as PendingAssetUploadPayload, idMap);
        const contentBase64 = await tauriCommands.replicaReadCachedAsset(
          vault.serverUrl,
          vault.hostedVaultId,
          payload.assetCacheId,
        );
        if (contentBase64 === null) {
          throw new Error('Cached upload bytes are no longer available for this pending asset upload.');
        }
        await tauriCommands.hostedVaultRequest(
          vault.serverUrl,
          'POST',
          `/api/v1/vaults/${vault.hostedVaultId}/uploads`,
          {
            parentId: payload.parentId ?? null,
            name: payload.name,
            mediaType: payload.mediaType,
            contentBase64,
            expectedHash: payload.expectedHash,
          },
        );
      } else {
        const payload = replaceMappedIds(operation.payload as PendingStructuralPayload, idMap);
        await tauriCommands.hostedVaultRequest(
          vault.serverUrl,
          'POST',
          `/api/v1/vaults/${vault.hostedVaultId}/operations`,
          payload,
        );
      }
      await tauriCommands.replicaRemoveOperation(vault.serverUrl, vault.hostedVaultId, operation.id);
    } catch (error) {
      if (isLikelyConnectivityError(error)) {
        await tauriCommands.replicaUpdateOperationStatus(
          vault.serverUrl,
          vault.hostedVaultId,
          operation.id,
          'pending',
        );
        throw error;
      }
      const failure = classifyPendingOperationFailure(error);
      await tauriCommands.replicaRecordOperationFailure(
        vault.serverUrl,
        vault.hostedVaultId,
        operation.id,
        failure.code,
        failure.message,
      );
      stoppedForFailure = true;
      break;
    }
  }
  if (!stoppedForFailure) await seedReplicaFromManifest(vault);
  emitReplicaMutated();
}

/**
 * Seed (create or refresh) the local replica for a hosted vault from the current
 * server manifest. Best-effort: callers should not let a failure here block
 * opening the vault.
 */
/**
 * Run a bounded cache-cleanup pass over the vault's replica, keeping cached
 * document/asset/CRDT content within {@link REPLICA_CACHE_BUDGET_BYTES} and
 * dropping orphaned/stray entries. Content referenced by pending operations is
 * never evicted. Best-effort: a missing or unseeded replica is a no-op.
 */
export async function cleanupReplicaCache(
  vault: HostedVaultMeta,
  budgetBytes: number = REPLICA_CACHE_BUDGET_BYTES,
): Promise<CacheCleanupReport> {
  return tauriCommands.replicaCleanup(vault.serverUrl, vault.hostedVaultId, budgetBytes);
}

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
  emitReplicaMutated();
}

export async function syncReplicaManifestDelta(vault: HostedVaultMeta): Promise<ReplicaManifest> {
  await replayPendingOperations(vault).catch((error) => {
    if (!isLikelyConnectivityError(error)) throw error;
  });
  const [cachedManifest, syncState] = await Promise.all([
    tauriCommands.replicaReadManifest(vault.serverUrl, vault.hostedVaultId),
    tauriCommands.replicaReadSyncState(vault.serverUrl, vault.hostedVaultId),
  ]);
  if (!cachedManifest || syncState.manifestSequence > cachedManifest.sequence) {
    await seedReplicaFromManifest(vault);
    const seeded = await tauriCommands.replicaReadManifest(vault.serverUrl, vault.hostedVaultId);
    if (!seeded) throw new Error('Replica manifest was not available after seeding.');
    return seeded;
  }

  const delta = await tauriCommands.hostedVaultRequest<ReplicaManifestDelta>(
    vault.serverUrl,
    'GET',
    `/api/v1/vaults/${vault.hostedVaultId}/manifest/delta?since=${encodeURIComponent(String(syncState.manifestSequence))}`,
  );
  if (delta.sequence < cachedManifest.sequence || delta.baseSequence !== syncState.manifestSequence) {
    await seedReplicaFromManifest(vault);
    const seeded = await tauriCommands.replicaReadManifest(vault.serverUrl, vault.hostedVaultId);
    if (!seeded) throw new Error('Replica manifest was not available after seeding.');
    return seeded;
  }

  const filesById = new Map(cachedManifest.files.map((file) => [file.id, file]));
  for (const file of delta.changedFiles) {
    filesById.set(file.id, file);
  }
  const nextManifest: ReplicaManifest = {
    ...cachedManifest,
    vaultId: delta.vaultId,
    sequence: delta.sequence,
    files: Array.from(filesById.values()),
  };
  await tauriCommands.replicaSeed(
    vault.serverUrl,
    vault.hostedVaultId,
    vault.name,
    nextManifest,
    initialSyncState(delta.sequence),
  );
  emitReplicaMutated();
  return nextManifest;
}
