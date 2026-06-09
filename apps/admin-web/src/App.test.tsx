import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { serverApi } from './api';

vi.mock('./api', () => ({
  serverApi: {
    bootstrapStatus: vi.fn(),
    bootstrap: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    overview: vi.fn(),
    users: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    revokeSessions: vi.fn(),
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
};

describe('admin application', () => {
  beforeEach(() => {
    vi.mocked(serverApi.overview).mockResolvedValue({
      serverVersion: '0.4.3',
      protocolVersion: 1,
      uptimeSeconds: 10,
      users: 1,
      activeUsers: 1,
      activeSessions: 1,
      pendingInvitations: 0,
      hostedVaults: 0,
      recentAuditEvents: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the one-time bootstrap screen when no administrator exists', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: true });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Create the first administrator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeTruthy();
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
});
