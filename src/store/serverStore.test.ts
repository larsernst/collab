import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriCommands } from '../lib/tauri';
import { useServerStore, isServerSessionExpired, isEffectivelyConnected } from './serverStore';
import { useVaultStore } from './vaultStore';

vi.mock('../lib/tauri', () => ({
  tauriCommands: {
    serverConnectionStatus: vi.fn(),
    serverHasSavedSession: vi.fn(),
    connectServer: vi.fn(),
    reconnectServer: vi.fn(),
    disconnectServer: vi.fn(),
    hostedVaultRequest: vi.fn(),
  },
}));

const connected = {
  connected: true,
  serverUrl: 'https://collab.example.test',
  allowInvalidCertificates: false,
  user: { id: 'user-1', username: 'alice', displayName: 'Alice', role: 'member' as const, status: 'active' as const },
  accessExpiresAt: '2999-01-01T00:00:00Z',
};

const hostedVault = {
  id: 'vault-1',
  name: 'Hosted Vault',
  ownerUserId: 'user-1',
  ownerDisplayName: 'Alice',
  role: 'admin' as const,
  status: 'active' as const,
  manifestSequence: 1,
  members: 1,
  storageBytes: 0,
  createdAt: '2026-06-11T08:00:00Z',
  updatedAt: '2026-06-11T08:00:00Z',
};

describe('serverStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServerStore.setState({ status: null, hostedVaults: [], isLoading: false, error: null });
    useVaultStore.setState({ vault: null, fileTree: [], isLoading: false } as never);
  });

  it('refreshes the native session and lists hosted vaults', async () => {
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue(connected);
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([hostedVault]);

    await useServerStore.getState().refresh();

    expect(useServerStore.getState().status).toEqual(connected);
    expect(useServerStore.getState().hostedVaults).toEqual([hostedVault]);
    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults',
    );
  });

  it('clears hosted vaults when disconnecting', async () => {
    useServerStore.setState({ status: connected, hostedVaults: [hostedVault] });
    vi.mocked(tauriCommands.disconnectServer).mockResolvedValue();

    await useServerStore.getState().disconnect();

    expect(useServerStore.getState().status?.connected).toBe(false);
    expect(useServerStore.getState().hostedVaults).toEqual([]);
  });

  it('creates a hosted vault and refreshes the inventory', async () => {
    useServerStore.setState({ status: connected, hostedVaults: [] });
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(hostedVault) // POST /api/v1/vaults
      .mockResolvedValueOnce([hostedVault]); // GET reload

    const created = await useServerStore.getState().createHostedVault('New Vault');

    expect(created).toEqual(hostedVault);
    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults',
      { name: 'New Vault' },
    );
    expect(useServerStore.getState().hostedVaults).toEqual([hostedVault]);
  });

  it('refreshes the currently open hosted vault role and capabilities', async () => {
    useServerStore.setState({ status: connected, hostedVaults: [] });
    useVaultStore.setState({
      vault: {
        kind: 'hosted',
        id: 'vault-1',
        hostedVaultId: 'vault-1',
        serverUrl: 'https://collab.example.test',
        name: 'Hosted Vault',
        path: 'hosted://vault-1',
        lastOpened: 1,
        isEncrypted: false,
        role: 'viewer',
        capabilities: ['vault.read'],
      },
    } as never);
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([{
      ...hostedVault,
      role: 'editor',
      capabilities: ['vault.read', 'file.write', 'kanban.card.move'],
      updatedAt: '2026-06-11T09:00:00Z',
    }]);

    await useServerStore.getState().loadHostedVaults();

    expect(useVaultStore.getState().vault).toMatchObject({
      role: 'editor',
      capabilities: ['vault.read', 'file.write', 'kanban.card.move'],
    });
  });

  it('refuses to create a hosted vault when disconnected', async () => {
    useServerStore.setState({ status: null });
    await expect(useServerStore.getState().createHostedVault('X')).rejects.toThrow(/Connect to a Collab server/);
  });

  it('refuses to create a hosted vault when the session has expired', async () => {
    useServerStore.setState({ status: { ...connected, accessExpiresAt: '2000-01-01T00:00:00Z' } });
    await expect(useServerStore.getState().createHostedVault('X')).rejects.toThrow(/Connect to a Collab server/);
    expect(tauriCommands.hostedVaultRequest).not.toHaveBeenCalled();
  });
});

describe('isEffectivelyConnected', () => {
  const now = Date.parse('2026-06-11T10:00:00Z');

  it('is true for a connected, unexpired session', () => {
    expect(isEffectivelyConnected({ ...connected, accessExpiresAt: '2026-06-11T12:00:00Z' }, now)).toBe(true);
  });

  it('is false when disconnected', () => {
    expect(isEffectivelyConnected(null, now)).toBe(false);
    expect(isEffectivelyConnected({ ...connected, connected: false }, now)).toBe(false);
  });

  it('is false when the access token has expired', () => {
    expect(isEffectivelyConnected({ ...connected, accessExpiresAt: '2026-06-11T09:00:00Z' }, now)).toBe(false);
  });
});

describe('serverStore.restoreSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useServerStore.setState({ status: null, hostedVaults: [], isLoading: false, error: null });
  });

  it('skips when no server URL has been saved', async () => {
    expect(await useServerStore.getState().restoreSession()).toBe('skipped');
    expect(tauriCommands.reconnectServer).not.toHaveBeenCalled();
  });

  it('reuses a live in-memory session without reconnecting', async () => {
    localStorage.setItem('collab-hosted-server-url', 'https://collab.example.test');
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue(connected);
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([hostedVault]);

    expect(await useServerStore.getState().restoreSession()).toBe('connected');
    expect(tauriCommands.reconnectServer).not.toHaveBeenCalled();
    expect(useServerStore.getState().hostedVaults).toEqual([hostedVault]);
  });

  it('reconnects from the saved refresh token when no live session exists', async () => {
    localStorage.setItem('collab-hosted-server-url', 'https://collab.example.test');
    localStorage.setItem('collab-hosted-allow-invalid-certificates', 'true');
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({ ...connected, connected: false });
    vi.mocked(tauriCommands.reconnectServer).mockResolvedValue(connected);
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([hostedVault]);

    expect(await useServerStore.getState().restoreSession()).toBe('connected');
    expect(tauriCommands.reconnectServer).toHaveBeenCalledWith('https://collab.example.test', true);
  });

  it('skips without error when a saved URL has no stored credential', async () => {
    localStorage.setItem('collab-hosted-server-url', 'https://collab.example.test');
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({ ...connected, connected: false });
    vi.mocked(tauriCommands.reconnectServer).mockRejectedValue(new Error('No saved server session was found.'));

    expect(await useServerStore.getState().restoreSession()).toBe('skipped');
    expect(tauriCommands.reconnectServer).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent restore attempts into a single reconnect', async () => {
    localStorage.setItem('collab-hosted-server-url', 'https://collab.example.test');
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({ ...connected, connected: false });
    vi.mocked(tauriCommands.reconnectServer).mockResolvedValue(connected);
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([hostedVault]);

    const store = useServerStore.getState();
    const [first, second] = await Promise.all([store.restoreSession(), store.restoreSession()]);

    expect(first).toBe('connected');
    expect(second).toBe('connected');
    expect(tauriCommands.reconnectServer).toHaveBeenCalledTimes(1);
  });

  it('reports failure when a stored credential exists but the reconnect fails', async () => {
    localStorage.setItem('collab-hosted-server-url', 'https://collab.example.test');
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({ ...connected, connected: false });
    vi.mocked(tauriCommands.reconnectServer).mockRejectedValue(new Error('expired'));

    expect(await useServerStore.getState().restoreSession()).toBe('failed');
  });
});

describe('isServerSessionExpired', () => {
  const now = Date.parse('2026-06-11T10:00:00Z');

  it('returns false when disconnected', () => {
    expect(isServerSessionExpired(null, now)).toBe(false);
    expect(isServerSessionExpired({ ...connected, connected: false }, now)).toBe(false);
  });

  it('returns false when the token is still valid', () => {
    expect(isServerSessionExpired({ ...connected, accessExpiresAt: '2026-06-11T12:00:00Z' }, now)).toBe(false);
  });

  it('returns true when the token has expired', () => {
    expect(isServerSessionExpired({ ...connected, accessExpiresAt: '2026-06-11T09:00:00Z' }, now)).toBe(true);
  });

  it('returns false when the expiry timestamp is absent or unparseable', () => {
    expect(isServerSessionExpired({ ...connected, accessExpiresAt: null }, now)).toBe(false);
    expect(isServerSessionExpired({ ...connected, accessExpiresAt: 'not-a-date' }, now)).toBe(false);
  });
});
