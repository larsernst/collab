import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriCommands } from '../lib/tauri';
import { useServerStore, isServerSessionExpired } from './serverStore';

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
