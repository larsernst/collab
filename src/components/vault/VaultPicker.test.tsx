import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerStore } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import VaultPicker from './VaultPicker';

vi.mock('../../lib/tauri', () => ({
  tauriCommands: {
    showOpenVaultDialog: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const hostedVault = {
  id: 'vault-1',
  name: 'Team Vault',
  ownerUserId: 'user-1',
  ownerDisplayName: 'Alice',
  role: 'editor' as const,
  status: 'active' as const,
  manifestSequence: 1,
  members: 3,
  storageBytes: 100,
  createdAt: '2026-06-11T08:00:00Z',
  updatedAt: '2026-06-11T09:00:00Z',
};

describe('VaultPicker hosted vaults', () => {
  const openHostedVault = vi.fn(async () => {});
  const createHostedVault = vi.fn(async () => hostedVault);
  const openSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({
      vault: null,
      recentVaults: [],
      isLoading: false,
      openVault: vi.fn(async () => {}),
      openHostedVault,
      loadRecentVaults: vi.fn(async () => {}),
    });
    useServerStore.setState({
      status: {
        connected: true,
        serverUrl: 'https://collab.example.test',
        allowInvalidCertificates: false,
        user: { id: 'user-1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
        accessExpiresAt: '2999-01-01T00:00:00Z',
      },
      hostedVaults: [hostedVault],
      isLoading: false,
      error: null,
      refresh: vi.fn(async () => {}),
      loadHostedVaults: vi.fn(async () => {}),
      createHostedVault,
    });
    useUiStore.setState({ openSettings });
  });

  it('opens a listed hosted vault with server-backed metadata', async () => {
    render(<VaultPicker />);
    fireEvent.click(screen.getByRole('button', { name: /Team Vault/ }));

    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'hosted',
      hostedVaultId: 'vault-1',
      serverUrl: 'https://collab.example.test',
      role: 'editor',
      path: 'hosted://vault-1',
    })));
  });

  it('creates a hosted vault and opens it', async () => {
    render(<VaultPicker />);
    fireEvent.click(screen.getByTitle('New hosted vault'));
    fireEvent.change(screen.getByPlaceholderText('New hosted vault name'), { target: { value: 'Fresh Vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createHostedVault).toHaveBeenCalledWith('Fresh Vault'));
    await waitFor(() => expect(openHostedVault).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'hosted',
      hostedVaultId: 'vault-1',
    })));
  });

  it('routes disconnected users directly to server settings', async () => {
    useServerStore.setState({
      status: { connected: false, serverUrl: null, allowInvalidCertificates: false, user: null, accessExpiresAt: null },
      hostedVaults: [],
    });
    const handler = vi.fn();
    window.addEventListener('settings:open-tab', handler);

    render(<VaultPicker />);
    fireEvent.click(screen.getByRole('button', { name: /Connect a Collab server/ }));

    expect(openSettings).toHaveBeenCalled();
    await waitFor(() => expect(handler).toHaveBeenCalled());
    window.removeEventListener('settings:open-tab', handler);
  });
});
