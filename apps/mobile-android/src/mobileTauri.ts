import { invoke } from '@tauri-apps/api/core';

export interface ServerHealthStatus {
  ok: boolean;
  serverUrl: string;
  message: string;
}

export interface ServerUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface ServerConnectionStatus {
  connected: boolean;
  serverUrl: string | null;
  allowInvalidCertificates: boolean;
  user: ServerUser | null;
  accessExpiresAt: string | null;
}

export type MemberRole = 'viewer' | 'editor' | 'admin';

export interface HostedVault {
  id: string;
  name: string;
  role: MemberRole;
  status: string;
  members: number;
  storageBytes: number;
  manifestSequence: number;
  updatedAt: string | null;
  capabilities: string[];
}

export type HostedFileKind = 'document' | 'asset' | 'folder';

export interface HostedFileEntry {
  id: string;
  parentId: string | null;
  name: string;
  relativePath: string;
  kind: HostedFileKind;
  documentType: string | null;
  state: string;
  updatedAt: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
}

/**
 * The native manifest as it crosses the IPC boundary — the raw server shape with
 * full `HostedFileEntry` fields. It is passed to `replica_seed` unchanged (the
 * Rust store deserializes the complete DTO) and returned from
 * `replica_read_manifest`. Use {@link parseFileEntries} on `files` for app logic.
 */
export interface RawHostedManifest {
  vaultId?: string;
  sequence: number;
  files: unknown[];
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface ReplicaSyncState {
  manifestSequence: number;
  lastSyncedAt: string | null;
  offlineAvailableAt?: string | null;
  status: SyncStatus;
}

export interface ReplicaSummary {
  serverUrl: string;
  vaultId: string;
  vaultName: string;
  manifestSequence: number;
  lastSyncedAt: string | null;
  status: SyncStatus;
  pendingCount: number;
  updatedAt: string;
  role: string | null;
  capabilities: string[];
}

export interface CachedContentStatus {
  present: boolean;
  matchesExpectedHash: boolean;
  actualSha256: string | null;
  sizeBytes: number | null;
}

export interface ConnectOptions {
  allowInvalidCertificates?: boolean;
  persistAcrossReboots?: boolean;
}

export function checkServerHealth(
  serverUrl: string,
  allowInvalidCertificates = false,
): Promise<ServerHealthStatus> {
  return invoke('server_health_check', { serverUrl, allowInvalidCertificates });
}

export function loadConnectionStatuses(): Promise<ServerConnectionStatus[]> {
  return invoke('server_connection_statuses');
}

export function connectServer(
  serverUrl: string,
  username: string,
  password: string,
  options: ConnectOptions = {},
): Promise<ServerConnectionStatus> {
  return invoke('connect_server', {
    serverUrl,
    username,
    password,
    allowInvalidCertificates: options.allowInvalidCertificates ?? false,
    persistAcrossReboots: options.persistAcrossReboots ?? true,
  });
}

export function reconnectServer(
  serverUrl: string,
  options: ConnectOptions = {},
): Promise<ServerConnectionStatus> {
  return invoke('reconnect_server', {
    serverUrl,
    allowInvalidCertificates: options.allowInvalidCertificates ?? false,
    persistAcrossReboots: options.persistAcrossReboots ?? true,
  });
}

export function disconnectServer(serverUrl: string): Promise<void> {
  return invoke('disconnect_server', { serverUrl });
}

export function serverHasSavedSession(serverUrl: string): Promise<boolean> {
  return invoke('server_has_saved_session', { serverUrl });
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error(message);
  return value as Record<string, unknown>;
}

function optString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export async function listHostedVaults(serverUrl: string): Promise<HostedVault[]> {
  const value = await invoke<unknown>('hosted_vault_request', {
    serverUrl,
    method: 'GET',
    path: '/api/v1/vaults',
    body: null,
  });
  if (!Array.isArray(value)) throw new Error('The server returned an invalid vault list.');
  return value.map((item) => {
    const entry = asRecord(item, 'The server returned an invalid vault entry.');
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      throw new Error('The server returned an invalid vault entry.');
    }
    const role = optString(entry.role);
    return {
      id: entry.id,
      name: entry.name,
      role: role === 'admin' || role === 'editor' || role === 'viewer' ? role : 'viewer',
      status: optString(entry.status) ?? 'active',
      members: optNumber(entry.members) ?? 0,
      storageBytes: optNumber(entry.storageBytes) ?? 0,
      manifestSequence: optNumber(entry.manifestSequence) ?? 0,
      updatedAt: optString(entry.updatedAt),
      capabilities: stringArray(entry.capabilities),
    };
  });
}

function parseFileEntry(item: unknown): HostedFileEntry {
  const entry = asRecord(item, 'The server returned an invalid file entry.');
  const kind = optString(entry.kind);
  const revision = entry.currentRevision;
  const revisionRecord =
    revision && typeof revision === 'object' ? (revision as Record<string, unknown>) : null;
  return {
    id: typeof entry.id === 'string' ? entry.id : '',
    parentId: optString(entry.parentId),
    name: typeof entry.name === 'string' ? entry.name : '(unnamed)',
    relativePath: optString(entry.relativePath) ?? '',
    kind: kind === 'document' || kind === 'asset' || kind === 'folder' ? kind : 'document',
    documentType: optString(entry.documentType),
    state: optString(entry.state) ?? 'active',
    updatedAt: optString(entry.updatedAt),
    sizeBytes: revisionRecord ? optNumber(revisionRecord.sizeBytes) : null,
    contentHash: revisionRecord ? optString(revisionRecord.contentHash) : null,
  };
}

export function parseFileEntries(value: unknown): HostedFileEntry[] {
  if (!Array.isArray(value)) throw new Error('The server returned an invalid file list.');
  return value.map(parseFileEntry);
}

export function hostedRequest<T>(
  serverUrl: string,
  method: string,
  path: string,
  body: unknown = null,
): Promise<T> {
  return invoke<T>('hosted_vault_request', { serverUrl, method, path, body });
}

export async function listVaultFiles(
  serverUrl: string,
  vaultId: string,
): Promise<HostedFileEntry[]> {
  return parseFileEntries(
    await invoke<unknown>('hosted_vault_request', {
      serverUrl,
      method: 'GET',
      path: `/api/v1/vaults/${vaultId}/files`,
      body: null,
    }),
  );
}

export function hostedAssetDataUrl(
  serverUrl: string,
  vaultId: string,
  fileId: string,
): Promise<string> {
  return invoke('hosted_vault_asset_data_url', { serverUrl, vaultId, fileId });
}

// ── Native replica store (offline availability) ─────────────────────────────

export function replicaList(): Promise<ReplicaSummary[]> {
  return invoke('replica_list');
}

export function replicaSeed(
  serverUrl: string,
  vaultId: string,
  vaultName: string,
  manifest: RawHostedManifest,
  syncState: ReplicaSyncState,
  role: string | null,
  capabilities: string[],
): Promise<void> {
  return invoke('replica_seed', {
    serverUrl,
    vaultId,
    vaultName,
    manifest,
    syncState,
    role,
    capabilities,
  });
}

export function replicaReadManifest(
  serverUrl: string,
  vaultId: string,
): Promise<RawHostedManifest | null> {
  return invoke('replica_read_manifest', { serverUrl, vaultId });
}

export function replicaReadSyncState(
  serverUrl: string,
  vaultId: string,
): Promise<ReplicaSyncState> {
  return invoke('replica_read_sync_state', { serverUrl, vaultId });
}

export function replicaWriteSyncState(
  serverUrl: string,
  vaultId: string,
  syncState: ReplicaSyncState,
): Promise<void> {
  return invoke('replica_write_sync_state', { serverUrl, vaultId, syncState });
}

export function replicaCachedContentStatus(
  serverUrl: string,
  vaultId: string,
  fileId: string,
  kind: string,
  expectedSha256: string | null,
): Promise<CachedContentStatus> {
  return invoke('replica_cached_content_status', {
    serverUrl,
    vaultId,
    fileId,
    kind,
    expectedSha256,
  });
}

export function replicaCacheDocument(
  serverUrl: string,
  vaultId: string,
  fileId: string,
  content: string,
): Promise<void> {
  return invoke('replica_cache_document', { serverUrl, vaultId, fileId, content });
}

export function replicaCacheAsset(
  serverUrl: string,
  vaultId: string,
  fileId: string,
  base64Content: string,
): Promise<void> {
  return invoke('replica_cache_asset', { serverUrl, vaultId, fileId, base64Content });
}

export function replicaDelete(serverUrl: string, vaultId: string): Promise<void> {
  return invoke('replica_delete', { serverUrl, vaultId });
}
