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

export async function listVaultFiles(
  serverUrl: string,
  vaultId: string,
): Promise<HostedFileEntry[]> {
  const value = await invoke<unknown>('hosted_vault_request', {
    serverUrl,
    method: 'GET',
    path: `/api/v1/vaults/${vaultId}/files`,
    body: null,
  });
  if (!Array.isArray(value)) throw new Error('The server returned an invalid file list.');
  return value.map((item) => {
    const entry = asRecord(item, 'The server returned an invalid file entry.');
    const kind = optString(entry.kind);
    const revision = entry.currentRevision;
    const size =
      revision && typeof revision === 'object'
        ? optNumber((revision as Record<string, unknown>).sizeBytes)
        : null;
    return {
      id: typeof entry.id === 'string' ? entry.id : '',
      parentId: optString(entry.parentId),
      name: typeof entry.name === 'string' ? entry.name : '(unnamed)',
      relativePath: optString(entry.relativePath) ?? '',
      kind: kind === 'document' || kind === 'asset' || kind === 'folder' ? kind : 'document',
      documentType: optString(entry.documentType),
      state: optString(entry.state) ?? 'active',
      updatedAt: optString(entry.updatedAt),
      sizeBytes: size,
    };
  });
}
