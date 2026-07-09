import { create } from 'zustand';

import {
  connectServer,
  disconnectServer,
  HostedFileEntry,
  HostedVault,
  listHostedVaults,
  listVaultFiles,
  loadConnectionStatuses,
  reconnectServer,
  serverHasSavedSession,
  ServerConnectionStatus,
} from '../mobileTauri';
import {
  KnownServer,
  listKnownServers,
  normalizeServerUrl,
  removeKnownServer,
  upsertKnownServer,
} from '../lib/servers';

export interface SelectedVault {
  serverUrl: string;
  vault: HostedVault;
}

interface MobileState {
  restored: boolean;
  servers: KnownServer[];
  /** One entry per currently connected server, keyed by normalized URL. */
  statuses: Record<string, ServerConnectionStatus>;
  vaults: Record<string, HostedVault[]>;
  vaultsBusy: Record<string, boolean>;
  selected: SelectedVault | null;
  files: HostedFileEntry[];
  filesBusy: boolean;
  filesError: string | null;

  restore: () => Promise<void>;
  refreshStatuses: () => Promise<void>;
  connect: (
    serverUrl: string,
    username: string,
    password: string,
    opts: { allowInvalidCertificates: boolean; persistAcrossReboots: boolean },
  ) => Promise<void>;
  reconnect: (serverUrl: string) => Promise<void>;
  disconnect: (serverUrl: string) => Promise<void>;
  loadVaults: (serverUrl: string) => Promise<void>;
  selectVault: (serverUrl: string, vault: HostedVault) => Promise<void>;
  clearSelection: () => void;
  loadFiles: () => Promise<void>;
}

function isConnected(status: ServerConnectionStatus | undefined): boolean {
  return !!status && status.connected;
}

export const useMobileStore = create<MobileState>((set, get) => ({
  restored: false,
  servers: listKnownServers(),
  statuses: {},
  vaults: {},
  vaultsBusy: {},
  selected: null,
  files: [],
  filesBusy: false,
  filesError: null,

  refreshStatuses: async () => {
    const statuses = await loadConnectionStatuses();
    const map: Record<string, ServerConnectionStatus> = {};
    for (const status of statuses) {
      if (status.serverUrl) map[normalizeServerUrl(status.serverUrl)] = status;
    }
    set({ statuses: map });
  },

  restore: async () => {
    await get().refreshStatuses();
    const servers = listKnownServers();
    set({ servers });
    // Quietly reconnect each saved server that has a stored refresh token and is
    // not already connected. Failures are non-fatal — the user can reconnect
    // manually from the Servers screen.
    await Promise.all(
      servers.map(async (server) => {
        const key = normalizeServerUrl(server.serverUrl);
        if (isConnected(get().statuses[key])) return;
        try {
          if (!(await serverHasSavedSession(server.serverUrl))) return;
          await reconnectServer(server.serverUrl, {
            allowInvalidCertificates: server.allowInvalidCertificates,
            persistAcrossReboots: server.persistAcrossReboots,
          });
        } catch {
          // Leave disconnected; surfaced as "Reconnect" on the Servers screen.
        }
      }),
    );
    await get().refreshStatuses();
    // Preload vault inventories for connected servers.
    await Promise.all(
      Object.keys(get().statuses).map((serverUrl) => get().loadVaults(serverUrl).catch(() => {})),
    );
    set({ restored: true });
  },

  connect: async (serverUrl, username, password, opts) => {
    const normalized = normalizeServerUrl(serverUrl);
    await connectServer(normalized, username, password, opts);
    upsertKnownServer({
      serverUrl: normalized,
      username,
      allowInvalidCertificates: opts.allowInvalidCertificates,
      persistAcrossReboots: opts.persistAcrossReboots,
    });
    set({ servers: listKnownServers() });
    await get().refreshStatuses();
    await get().loadVaults(normalized);
  },

  reconnect: async (serverUrl) => {
    const normalized = normalizeServerUrl(serverUrl);
    const server = get().servers.find((entry) => normalizeServerUrl(entry.serverUrl) === normalized);
    await reconnectServer(normalized, {
      allowInvalidCertificates: server?.allowInvalidCertificates ?? false,
      persistAcrossReboots: server?.persistAcrossReboots ?? true,
    });
    await get().refreshStatuses();
    await get().loadVaults(normalized);
  },

  disconnect: async (serverUrl) => {
    const normalized = normalizeServerUrl(serverUrl);
    await disconnectServer(normalized);
    removeKnownServer(normalized);
    const vaults = { ...get().vaults };
    delete vaults[normalized];
    const selected = get().selected;
    set({
      servers: listKnownServers(),
      vaults,
      selected: selected && selected.serverUrl === normalized ? null : selected,
      files: selected && selected.serverUrl === normalized ? [] : get().files,
    });
    await get().refreshStatuses();
  },

  loadVaults: async (serverUrl) => {
    const normalized = normalizeServerUrl(serverUrl);
    set((state) => ({ vaultsBusy: { ...state.vaultsBusy, [normalized]: true } }));
    try {
      const vaults = await listHostedVaults(normalized);
      set((state) => ({ vaults: { ...state.vaults, [normalized]: vaults } }));
    } finally {
      set((state) => ({ vaultsBusy: { ...state.vaultsBusy, [normalized]: false } }));
    }
  },

  selectVault: async (serverUrl, vault) => {
    set({ selected: { serverUrl: normalizeServerUrl(serverUrl), vault }, files: [], filesError: null });
    await get().loadFiles();
  },

  clearSelection: () => set({ selected: null, files: [], filesError: null }),

  loadFiles: async () => {
    const selected = get().selected;
    if (!selected) return;
    set({ filesBusy: true, filesError: null });
    try {
      const files = await listVaultFiles(selected.serverUrl, selected.vault.id);
      set({ files: files.filter((file) => file.state === 'active') });
    } catch (reason) {
      set({ filesError: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      set({ filesBusy: false });
    }
  },
}));
