import { create } from 'zustand';
import { tauriCommands, type ServerConnectionStatus } from '../lib/tauri';
import type { HostedVaultSummary } from '../types/vault';

const SERVER_URL_KEY = 'collab-hosted-server-url';
const ALLOW_INVALID_CERTIFICATES_KEY = 'collab-hosted-allow-invalid-certificates';

export type RestoreSessionResult = 'connected' | 'failed' | 'skipped';

const DISCONNECTED: ServerConnectionStatus = {
  connected: false,
  serverUrl: null,
  allowInvalidCertificates: false,
  user: null,
  accessExpiresAt: null,
};

/**
 * Whether a connected session's access token has already expired. A connected
 * session with an unparseable or absent expiry is treated as not-expired so a
 * malformed timestamp never blocks a working session; reconnect remains
 * available manually.
 */
export function isServerSessionExpired(
  status: ServerConnectionStatus | null,
  now: number = Date.now(),
): boolean {
  if (!status?.connected || !status.accessExpiresAt) return false;
  const expiry = Date.parse(status.accessExpiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

interface ServerState {
  status: ServerConnectionStatus | null;
  hostedVaults: HostedVaultSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  restoreSession: () => Promise<RestoreSessionResult>;
  connect: (serverUrl: string, username: string, password: string, allowInvalidCertificates?: boolean) => Promise<void>;
  reconnect: (serverUrl: string, allowInvalidCertificates?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  loadHostedVaults: () => Promise<void>;
  createHostedVault: (name: string) => Promise<HostedVaultSummary>;
}

export const useServerStore = create<ServerState>()((set, get) => ({
  status: null,
  hostedVaults: [],
  isLoading: false,
  error: null,
  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const status = await tauriCommands.serverConnectionStatus();
      set({ status, hostedVaults: status.connected ? get().hostedVaults : [], isLoading: false });
      if (status.connected) await get().loadHostedVaults();
    } catch (error) {
      set({ status: DISCONNECTED, hostedVaults: [], isLoading: false, error: String(error) });
    }
  },
  restoreSession: async () => {
    const serverUrl = localStorage.getItem(SERVER_URL_KEY);
    if (!serverUrl) return 'skipped';
    const allowInvalidCertificates = localStorage.getItem(ALLOW_INVALID_CERTIFICATES_KEY) === 'true';
    // A still-live in-memory session (e.g. after a soft reload) needs no refresh.
    try {
      const status = await tauriCommands.serverConnectionStatus();
      if (status.connected) {
        set({ status });
        await get().loadHostedVaults();
        return 'connected';
      }
    } catch {
      // Fall through to a refresh-token reconnect.
    }
    try {
      await get().reconnect(serverUrl, allowInvalidCertificates);
      return 'connected';
    } catch {
      return 'failed';
    }
  },
  connect: async (serverUrl, username, password, allowInvalidCertificates = false) => {
    set({ isLoading: true, error: null });
    try {
      const status = await tauriCommands.connectServer(serverUrl, username, password, allowInvalidCertificates);
      set({ status, isLoading: false });
      await get().loadHostedVaults();
    } catch (error) {
      set({ isLoading: false, error: String(error) });
      throw error;
    }
  },
  reconnect: async (serverUrl, allowInvalidCertificates = false) => {
    set({ isLoading: true, error: null });
    try {
      const status = await tauriCommands.reconnectServer(serverUrl, allowInvalidCertificates);
      set({ status, isLoading: false });
      await get().loadHostedVaults();
    } catch (error) {
      set({ isLoading: false, error: String(error) });
      throw error;
    }
  },
  disconnect: async () => {
    await tauriCommands.disconnectServer();
    set({ status: DISCONNECTED, hostedVaults: [], error: null });
  },
  loadHostedVaults: async () => {
    const status = get().status;
    if (!status?.connected || !status.serverUrl) {
      set({ hostedVaults: [] });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const hostedVaults = await tauriCommands.hostedVaultRequest<HostedVaultSummary[]>(
        status.serverUrl,
        'GET',
        '/api/v1/vaults',
      );
      set({ hostedVaults, isLoading: false });
    } catch (error) {
      set({ hostedVaults: [], isLoading: false, error: String(error) });
      throw error;
    }
  },
  createHostedVault: async (name) => {
    const status = get().status;
    if (!status?.connected || !status.serverUrl) {
      throw new Error('Connect to a Collab server before creating a hosted vault.');
    }
    const created = await tauriCommands.hostedVaultRequest<HostedVaultSummary>(
      status.serverUrl,
      'POST',
      '/api/v1/vaults',
      { name },
    );
    // The creator becomes the vault admin/owner; refresh so it appears in the inventory.
    await get().loadHostedVaults();
    return created;
  },
}));
