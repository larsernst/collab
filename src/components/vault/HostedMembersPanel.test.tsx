import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVaultStore } from '../../store/vaultStore';
import type { HostedVaultMeta } from '../../types/vault';
import { HostedMembersPanel } from './HostedMembersPanel';

const membersCapability = {
  list: vi.fn(),
  searchDirectory: vi.fn(),
  add: vi.fn(),
  updateRole: vi.fn(),
  remove: vi.fn(),
};

vi.mock('../../lib/vaultClient', () => ({
  createVaultClient: () => ({ runtime: { members: membersCapability } }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function setVault(role: HostedVaultMeta['role']) {
  useVaultStore.setState({
    vault: {
      kind: 'hosted',
      id: 'vault-1',
      hostedVaultId: 'vault-1',
      serverUrl: 'https://collab.example.test',
      name: 'Team Vault',
      path: 'hosted://vault-1',
      lastOpened: 1,
      isEncrypted: false,
      role,
    } satisfies HostedVaultMeta,
  } as Partial<ReturnType<typeof useVaultStore.getState>> as never);
}

const owner = {
  userId: 'user-1',
  username: 'alice',
  displayName: 'Alice',
  role: 'admin' as const,
  owner: true,
  createdAt: '2026-06-11T08:00:00Z',
};
const editor = {
  userId: 'user-2',
  username: 'bob',
  displayName: 'Bob',
  role: 'editor' as const,
  owner: false,
  createdAt: '2026-06-11T08:00:00Z',
};

describe('HostedMembersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membersCapability.list.mockResolvedValue([owner, editor]);
    membersCapability.searchDirectory.mockResolvedValue([]);
    membersCapability.add.mockResolvedValue(undefined);
    membersCapability.updateRole.mockResolvedValue(undefined);
    membersCapability.remove.mockResolvedValue(undefined);
  });

  it('lists members and protects the owner row', async () => {
    setVault('admin');
    render(<HostedMembersPanel />);

    expect(await screen.findByText('Alice')).not.toBeNull();
    expect(screen.getByText('Bob')).not.toBeNull();
    expect(screen.getByText('Owner')).not.toBeNull();
    // Owner cannot be removed; the non-owner member can.
    expect(screen.getByLabelText('Remove Bob')).not.toBeNull();
    expect(screen.queryByLabelText('Remove Alice')).toBeNull();
  });

  it('hides management controls for non-admin members', async () => {
    setVault('editor');
    render(<HostedMembersPanel />);

    expect(await screen.findByText('Bob')).not.toBeNull();
    expect(screen.queryByText('Add member')).toBeNull();
    expect(screen.queryByLabelText('Remove Bob')).toBeNull();
  });

  it('searches the directory and adds a selected user', async () => {
    membersCapability.searchDirectory.mockResolvedValue([
      { userId: 'user-9', username: 'carol', displayName: 'Carol' },
    ]);
    setVault('admin');
    render(<HostedMembersPanel />);
    await screen.findByText('Bob');

    fireEvent.change(screen.getByPlaceholderText('Search users by name or username…'), {
      target: { value: 'car' },
    });
    const result = await screen.findByText(/Carol/);
    fireEvent.click(result);
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));

    await waitFor(() => expect(membersCapability.add).toHaveBeenCalledWith('user-9', 'editor'));
  });

  it('removes a member through the capability', async () => {
    setVault('admin');
    render(<HostedMembersPanel />);
    await screen.findByText('Bob');

    fireEvent.click(screen.getByLabelText('Remove Bob'));
    await waitFor(() => expect(membersCapability.remove).toHaveBeenCalledWith('user-2'));
  });
});
