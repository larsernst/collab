import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriCommands } from '../lib/tauri';
import { useServerStore } from './serverStore';

vi.mock('../lib/tauri', () => ({
  tauriCommands: {
    serverConnectionStatus: vi.fn(),
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
  accessExpiresAt: '2026-06-11T12:00:00Z',
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
});
