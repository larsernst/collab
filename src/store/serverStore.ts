import { create } from 'zustand';
import { tauriCommands, type ServerConnectionStatus } from '../lib/tauri';
import { useVaultStore } from './vaultStore';
import type { HostedVaultSummary } from '../types/vault';

const SERVER_URL_KEY = 'collab-hosted-server-url';
const ALLOW_INVALID_CERTIFICATES_KEY = 'collab-hosted-allow-invalid-certificates';
// Linux-only preference: persist the refresh token in the Secret Service (durable
// across reboots) instead of the default silent keyutils keyring. Ignored on
// Windows/macOS, whose native keystores are already silent and durable.
const PERSIST_ACROSS_REBOOTS_KEY = 'collab-hosted-persist-across-reboots';
const NO_SAVED_SESSION_MESSAGE = 'No saved server session was found.';

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

/**
 * Whether the session can currently make authenticated server requests: connected
 * to a known server URL with an access token that has not expired. A connected
 * session whose access token has expired is not effectively connected, so
 * authenticated actions like hosted-vault creation must be gated on this rather
 * than the raw `connected` flag (which only reflects that a session object exists).
 */
export function isEffectivelyConnected(
  status: ServerConnectionStatus | null,
  now: number = Date.now(),
): boolean {
  return status?.connected === true && !!status.serverUrl && !isServerSessionExpired(status, now);
}

// Deduplicates concurrent `restoreSession` calls (e.g. the React StrictMode
// double-invoked startup effect) so a single restore attempt — and a single
// failure toast — happens per app launch.
let restoreInFlight: Promise<RestoreSessionResult> | null = null;

interface ServerState {
  status: ServerConnectionStatus | null;
  hostedVaults: HostedVaultSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  restoreSession: () => Promise<RestoreSessionResult>;
  /** Internal: the un-deduplicated restore implementation. Use `restoreSession`. */
  _restoreSessionOnce: () => Promise<RestoreSessionResult>;
  connect: (serverUrl: string, username: string, password: string, allowInvalidCertificates?: boolean, persistAcrossReboots?: boolean) => Promise<void>;
  reconnect: (serverUrl: string, allowInvalidCertificates?: boolean, persistAcrossReboots?: boolean) => Promise<void>;
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
  restoreSession: () => {
    if (restoreInFlight) return restoreInFlight;
    const attempt = get()._restoreSessionOnce();
    restoreInFlight = attempt;
    void attempt.finally(() => {
      if (restoreInFlight === attempt) restoreInFlight = null;
    });
    return attempt;
  },
  _restoreSessionOnce: async () => {
    const serverUrl = localStorage.getItem(SERVER_URL_KEY);
    if (!serverUrl) return 'skipped';
    const allowInvalidCertificates = localStorage.getItem(ALLOW_INVALID_CERTIFICATES_KEY) === 'true';
    const persistAcrossReboots = localStorage.getItem(PERSIST_ACROSS_REBOOTS_KEY) === 'true';
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
      await get().reconnect(serverUrl, allowInvalidCertificates, persistAcrossReboots);
      return 'connected';
    } catch (error) {
      if (String(error).includes(NO_SAVED_SESSION_MESSAGE)) return 'skipped';
      return 'failed';
    }
  },
  connect: async (serverUrl, username, password, allowInvalidCertificates = false, persistAcrossReboots = false) => {
    set({ isLoading: true, error: null });
    try {
      const status = await tauriCommands.connectServer(serverUrl, username, password, allowInvalidCertificates, persistAcrossReboots);
      set({ status, isLoading: false });
      await get().loadHostedVaults();
    } catch (error) {
      set({ isLoading: false, error: String(error) });
      throw error;
    }
  },
  reconnect: async (serverUrl, allowInvalidCertificates = false, persistAcrossReboots = false) => {
    set({ isLoading: true, error: null });
    try {
      const status = await tauriCommands.reconnectServer(serverUrl, allowInvalidCertificates, persistAcrossReboots);
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
      useVaultStore.getState().refreshHostedVaultMetadata(status.serverUrl, hostedVaults);
      set({ hostedVaults, isLoading: false });
    } catch (error) {
      set({ hostedVaults: [], isLoading: false, error: String(error) });
      throw error;
    }
  },
  createHostedVault: async (name) => {
    const status = get().status;
    if (!isEffectivelyConnected(status) || !status?.serverUrl) {
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
