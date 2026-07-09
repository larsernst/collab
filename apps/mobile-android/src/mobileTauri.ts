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
  filePath: string;
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

export function writeAppDataProbe(value: string): Promise<MobileAppDataProbe> {
  return invoke('mobile_app_data_probe', { value });
}
