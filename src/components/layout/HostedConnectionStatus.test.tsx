import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HostedConnectionStatus from './HostedConnectionStatus';
import { useVaultStore } from '../../store/vaultStore';
import { useServerStore } from '../../store/serverStore';
import type { HostedVaultMeta, LocalVaultMeta } from '../../types/vault';
import type { ServerConnectionStatus } from '../../lib/tauri';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const hostedVault: HostedVaultMeta = {
  kind: 'hosted',
  id: 'vault-1',
  hostedVaultId: 'vault-1',
  serverUrl: 'https://collab.example.test',
  name: 'Team Vault',
  path: 'hosted://vault-1',
  lastOpened: 1,
  isEncrypted: false,
  role: 'editor',
};

const localVault: LocalVaultMeta = {
  kind: 'local',
  id: 'local-1',
  name: 'Local Vault',
  path: '/vaults/local',
  lastOpened: 1,
  isEncrypted: false,
};

const connected: ServerConnectionStatus = {
  connected: true,
  serverUrl: 'https://collab.example.test',
  allowInvalidCertificates: false,
  user: { id: 'user-1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
  accessExpiresAt: '2999-01-01T00:00:00Z',
};

const reconnect = vi.fn().mockResolvedValue(undefined);

function setState(vault: HostedVaultMeta | LocalVaultMeta | null, status: ServerConnectionStatus | null) {
  useVaultStore.setState({ vault } as never);
  useServerStore.setState({ status, reconnect } as never);
}

describe('HostedConnectionStatus', () => {
  beforeEach(() => {
    reconnect.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing for a local vault', () => {
    setState(localVault, connected);
    const { container } = render(<HostedConnectionStatus />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Online when connected to the matching server with a live token', () => {
    setState(hostedVault, connected);
    render(<HostedConnectionStatus />);
    expect(screen.getByText('Online')).not.toBeNull();
  });

  it('shows Session expired when the token has expired', () => {
    setState(hostedVault, { ...connected, accessExpiresAt: '2000-01-01T00:00:00Z' });
    render(<HostedConnectionStatus />);
    expect(screen.getByText('Session expired')).not.toBeNull();
  });

  it('shows Offline when disconnected and reconnects on click', async () => {
    setState(hostedVault, { ...connected, connected: false, serverUrl: null, user: null });
    render(<HostedConnectionStatus />);
    const button = screen.getByText('Offline');
    fireEvent.click(button);
    await waitFor(() => {
      expect(reconnect).toHaveBeenCalledWith('https://collab.example.test', false);
    });
  });

  it('treats a connection to a different server as offline', () => {
    setState(hostedVault, { ...connected, serverUrl: 'https://other.example.test' });
    render(<HostedConnectionStatus />);
    expect(screen.getByText('Offline')).not.toBeNull();
  });
});
