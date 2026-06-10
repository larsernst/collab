import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { serverApi } from './api';

vi.mock('./api', () => ({
  serverApi: {
    bootstrapStatus: vi.fn(),
    bootstrap: vi.fn(),
    login: vi.fn(),
    acceptInvitation: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    overview: vi.fn(),
    users: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    revokeSessions: vi.fn(),
    resetPassword: vi.fn(),
    userActivity: vi.fn(),
    invitations: vi.fn(),
    createInvitation: vi.fn(),
    vaults: vi.fn(),
    auditEvents: vi.fn(),
  },
}));

const admin = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin User',
  role: 'admin' as const,
  status: 'active' as const,
  createdAt: '2026-06-09T00:00:00Z',
  lastLoginAt: null,
  activeSessions: 1,
  isPrimaryAdmin: true,
};

const disabledMember = {
  ...admin,
  id: 'member-1',
  username: 'member',
  displayName: 'Member User',
  role: 'member' as const,
  status: 'disabled' as const,
  activeSessions: 0,
  isPrimaryAdmin: false,
};

const storedValues = new Map<string, string>();
const localStorageMock = {
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
  key: (index: number) => [...storedValues.keys()][index] ?? null,
  get length() { return storedValues.size; },
};

describe('admin application', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorage.clear();
    vi.mocked(serverApi.overview).mockResolvedValue({
      health: 'ok',
      serverVersion: '0.4.3',
      protocolVersion: 1,
      uptimeSeconds: 10,
      users: 1,
      activeUsers: 1,
      activeSessions: 1,
      pendingInvitations: 0,
      hostedVaults: 0,
      storage: { databaseBytes: 1024, blobBytes: 0 },
      operationalWarnings: [],
      recentAuditEvents: [],
    });
    vi.mocked(serverApi.invitations).mockResolvedValue([]);
    vi.mocked(serverApi.vaults).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the one-time bootstrap screen when no administrator exists', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: true });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Create the first administrator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeTruthy();
  });

  it('completes the browser bootstrap flow into the administration dashboard', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: true });
    vi.mocked(serverApi.bootstrap).mockResolvedValue({ user: admin, csrfToken: 'csrf' });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Admin User' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    expect(await screen.findByRole('heading', { name: 'Server dashboard' })).toBeTruthy();
    expect(serverApi.bootstrap).toHaveBeenCalled();
  });

  it('shows the dashboard for an authenticated administrator', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Server dashboard' })).toBeTruthy();
    await waitFor(() => expect(serverApi.overview).toHaveBeenCalled());
    expect(screen.getByText('Active users')).toBeTruthy();
    expect(screen.getByText('v0.4.3')).toBeTruthy();
  });

  it('does not render administration pages for a non-admin user', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue({ ...admin, role: 'member' });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Server dashboard' })).toBeNull();
  });

  it('exposes labelled navigation and keyboard-focusable administration controls', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Administration' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh dashboard' })).toBeTruthy();
    expect(screen.getByTitle('Sign out')).toBeTruthy();
  });

  it('shows canonical hosted-vault status in the administration inventory', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1',
      name: 'Archived Vault',
      ownerDisplayName: 'Admin User',
      status: 'archived',
      members: 2,
      storageBytes: 1024,
      updatedAt: '2026-06-10T00:00:00Z',
    }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    expect(await screen.findByText('Archived Vault')).toBeTruthy();
    expect(screen.getByText('archived')).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();
  });

  it('creates a one-time invitation link through the user-management flow', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.createInvitation).mockResolvedValue({
      invitation: {
        id: 'invite-1',
        username: 'alice',
        displayName: 'Alice',
        role: 'member',
        createdAt: '2026-06-09T00:00:00Z',
        expiresAt: '2026-06-12T00:00:00Z',
        acceptedAt: null,
        revokedAt: null,
      },
      token: 'one-time-token',
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(serverApi.createInvitation).toHaveBeenCalled());
    expect(await screen.findByText(/one-time-token/)).toBeTruthy();
  });

  it('re-enables and deletes normal accounts while protecting the primary administrator', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin, disabledMember]);
    vi.mocked(serverApi.updateUser).mockResolvedValue({ ...disabledMember, status: 'active' });
    vi.mocked(serverApi.deleteUser).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-enable' }));
    await waitFor(() => expect(serverApi.updateUser).toHaveBeenCalledWith('member-1', { disabled: false }));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete account' });
    expect((deleteButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((deleteButtons[1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deleteButtons[1]);
    await waitFor(() => expect(serverApi.deleteUser).toHaveBeenCalledWith('member-1'));
  });

  it('persists administration appearance settings', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    fireEvent.click(screen.getByRole('button', { name: 'emerald' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact density' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(document.documentElement.dataset.accent).toBe('emerald');
      expect(document.documentElement.dataset.density).toBe('compact');
    });
    expect(JSON.parse(localStorage.getItem('collab-admin-appearance') ?? '{}')).toEqual({
      theme: 'light',
      accent: 'emerald',
      compact: true,
    });
  });
});
