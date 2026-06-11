import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import VaultManagerModal from './VaultManagerModal';
import type { HostedVaultSummary, LocalVaultMeta } from '../../types/vault';

vi.mock('../../lib/tauri', () => ({
  tauriCommands: {
    showOpenVaultDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    renameVault: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The manager modal builds a VaultClient per row; stub it so local rows do not hit Tauri.
vi.mock('../../lib/vaultClient', () => ({
  createVaultClient: () => ({ runtime: {} }),
  hasRuntimeCapability: () => false,
  requireRuntimeCapability: () => ({ exportTo: vi.fn() }),
}));

const hostedVault: HostedVaultSummary = {
  id: 'vault-1',
  name: 'Team Vault',
  ownerUserId: 'user-1',
  ownerDisplayName: 'Alice',
  role: 'editor',
  status: 'active',
  manifestSequence: 1,
  members: 3,
  storageBytes: 100,
  createdAt: '2026-06-11T08:00:00Z',
  updatedAt: '2026-06-11T09:00:00Z',
};

const localVault: LocalVaultMeta = {
  kind: 'local',
  id: 'local-1',
  name: 'My Local Vault',
  path: '/vaults/local',
  lastOpened: 1,
  isEncrypted: false,
};

const openHostedVault = vi.fn(async () => {});
const createHostedVault = vi.fn(async () => hostedVault);

function connect(connected: boolean) {
  useServerStore.setState({
    status: connected
      ? {
          connected: true,
          serverUrl: 'https://collab.example.test',
          allowInvalidCertificates: false,
          user: { id: 'user-1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
          accessExpiresAt: '2999-01-01T00:00:00Z',
        }
      : { connected: false, serverUrl: null, allowInvalidCertificates: false, user: null, accessExpiresAt: null },
    hostedVaults: connected ? [hostedVault] : [],
    isLoading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    loadHostedVaults: vi.fn(async () => {}),
    createHostedVault,
  } as never);
}

describe('VaultManagerModal hosted vaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ isVaultManagerOpen: true, closeVaultManager: vi.fn() } as never);
    useVaultStore.setState({
      vault: localVault,
      recentVaults: [localVault],
      openVault: vi.fn(async () => {}),
      openHostedVault,
      loadRecentVaults: vi.fn(async () => {}),
      removeRecentVault: vi.fn(async () => {}),
      closeVault: vi.fn(),
    } as never);
  });

  it('lists hosted vaults from the connected server alongside local vaults', async () => {
    connect(true);
    render(<VaultManagerModal />);
    expect(await screen.findByText('Team Vault')).not.toBeNull();
    expect(screen.getByText('My Local Vault')).not.toBeNull();
  });

  it('opens a hosted vault with server-backed metadata', async () => {
    connect(true);
    render(<VaultManagerModal />);
    fireEvent.click(await screen.findByTitle('Open hosted vault'));
    await waitFor(() =>
      expect(openHostedVault).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'hosted',
          hostedVaultId: 'vault-1',
          serverUrl: 'https://collab.example.test',
          role: 'editor',
        }),
      ),
    );
  });

  it('does not show a hosted section when disconnected', () => {
    connect(false);
    render(<VaultManagerModal />);
    expect(screen.queryByText('Team Vault')).toBeNull();
    expect(screen.getByText('My Local Vault')).not.toBeNull();
  });

  it('creates a hosted vault from the manager and opens it', async () => {
    connect(true);
    render(<VaultManagerModal />);
    fireEvent.click(await screen.findByTitle('New hosted vault'));
    fireEvent.change(screen.getByPlaceholderText('New hosted vault name'), { target: { value: 'Fresh Vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createHostedVault).toHaveBeenCalledWith('Fresh Vault'));
    await waitFor(() =>
      expect(openHostedVault).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hosted', hostedVaultId: 'vault-1' })),
    );
  });
});
