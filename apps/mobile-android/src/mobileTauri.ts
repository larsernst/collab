import { invoke } from '@tauri-apps/api/core';

export interface ServerHealthStatus {
  ok: boolean;
  serverUrl: string;
  message: string;
}

export interface ServerConnectionStatus {
  connected: boolean;
  serverUrl: string | null;
  allowInvalidCertificates: boolean;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
  accessExpiresAt: string | null;
}

export interface MobileAppDataProbe {
  value: string;
  previousValue: string | null;
  filePath: string;
}

export interface HostedVaultProbe {
  id: string;
  name: string;
  role?: string;
  status?: string;
  capabilities?: string[];
}

export interface ReplicaSummaryProbe {
  serverUrl: string;
  vaultId: string;
  vaultName: string;
  manifestSequence: number;
  lastSyncedAt: string | null;
  status: string;
  pendingCount: number;
  updatedAt: string;
  role: string | null;
  capabilities: string[];
}

export function checkServerHealth(serverUrl: string): Promise<ServerHealthStatus> {
  return invoke('server_health_check', {
    serverUrl,
    allowInvalidCertificates: false,
  });
}

export function loadConnectionStatuses(): Promise<ServerConnectionStatus[]> {
  return invoke('server_connection_statuses');
}

export function connectServer(
  serverUrl: string,
  username: string,
  password: string,
): Promise<ServerConnectionStatus> {
  return invoke('connect_server', {
    serverUrl,
    username,
    password,
    allowInvalidCertificates: false,
    persistAcrossReboots: false,
  });
}

export function reconnectServer(serverUrl: string): Promise<ServerConnectionStatus> {
  return invoke('reconnect_server', {
    serverUrl,
    allowInvalidCertificates: false,
    persistAcrossReboots: false,
  });
}

export async function listHostedVaults(serverUrl: string): Promise<HostedVaultProbe[]> {
  const value = await invoke<unknown>('hosted_vault_request', {
    serverUrl,
    method: 'GET',
    path: '/api/v1/vaults',
    body: null,
  });
  if (!Array.isArray(value)) {
    throw new Error('The server returned an invalid vault list.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('The server returned an invalid vault entry.');
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') {
      throw new Error('The server returned an invalid vault entry.');
    }
    return {
      id: entry.id,
      name: entry.name,
      role: typeof entry.role === 'string' ? entry.role : undefined,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      capabilities: Array.isArray(entry.capabilities)
        ? entry.capabilities.filter((capability): capability is string => typeof capability === 'string')
        : undefined,
    };
  });
}

export function listReplicas(): Promise<ReplicaSummaryProbe[]> {
  return invoke('replica_list');
}

export function writeAppDataProbe(value: string): Promise<MobileAppDataProbe> {
  return invoke('mobile_app_data_probe', { value });
}
