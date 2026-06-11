import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPanel } from './ChatPanel';
import { useVaultStore } from '../../../store/vaultStore';
import type { HostedVaultMeta, LocalVaultMeta } from '../../../types/vault';

vi.mock('../../../lib/tauri', () => ({
  tauriCommands: { sendChatMessage: vi.fn(), readChatMessages: vi.fn() },
}));

const localVault: LocalVaultMeta = {
  kind: 'local',
  id: 'local-1',
  name: 'Local',
  path: '/vaults/local',
  lastOpened: 1,
  isEncrypted: false,
};

const hostedVault: HostedVaultMeta = {
  kind: 'hosted',
  id: 'vault-1',
  hostedVaultId: 'vault-1',
  serverUrl: 'https://collab.example.test',
  name: 'Hosted',
  path: 'hosted://vault-1',
  lastOpened: 1,
  isEncrypted: false,
  role: 'admin',
};

describe('ChatPanel', () => {
  beforeEach(() => {
    useVaultStore.setState({ vault: localVault } as never);
  });

  it('renders the composer for local (filesystem-backed) vaults', () => {
    render(<ChatPanel />);
    expect(screen.getByPlaceholderText(/Message/)).not.toBeNull();
  });

  it('shows an unavailable message for hosted vaults instead of a broken composer', () => {
    useVaultStore.setState({ vault: hostedVault } as never);
    render(<ChatPanel />);
    expect(screen.getByText(/Chat isn't available for hosted vaults/)).not.toBeNull();
    expect(screen.queryByPlaceholderText(/Message/)).toBeNull();
  });
});
