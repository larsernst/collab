import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { MobileApp } from './MobileApp';
import { useMobileStore } from './state/store';

function mockInvoke(handlers: Record<string, (args: unknown) => unknown>) {
  invoke.mockImplementation((command: string, args: unknown) => {
    const handler = handlers[command];
    if (!handler) return Promise.reject(new Error(`unhandled command ${command}`));
    return Promise.resolve(handler(args));
  });
}

describe('MobileApp shell', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store between tests so restored state does not leak.
    useMobileStore.setState({
      restored: false,
      servers: [],
      statuses: {},
      vaults: {},
      vaultsBusy: {},
      selected: null,
      files: [],
      filesBusy: false,
      filesError: null,
    });
  });

  afterEach(() => {
    invoke.mockReset();
  });

  it('shows the login form when no servers are saved', async () => {
    mockInvoke({ server_connection_statuses: () => [] });
    render(<MobileApp />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('server_connection_statuses'));
    expect(screen.getByText('Connect to a hosted server')).toBeTruthy();
    // Bottom navigation is present and phone-first (no desktop sidebar).
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  });

  it('restores a saved session and lists vaults on the Vaults tab', async () => {
    localStorage.setItem(
      'collab-mobile-servers',
      JSON.stringify([
        {
          serverUrl: 'https://collab.example.com',
          username: 'ada',
          allowInvalidCertificates: false,
          persistAcrossReboots: true,
        },
      ]),
    );

    let connected = false;
    mockInvoke({
      server_connection_statuses: () =>
        connected
          ? [
              {
                connected: true,
                serverUrl: 'https://collab.example.com',
                allowInvalidCertificates: false,
                user: { id: 'u1', username: 'ada', displayName: 'Ada' },
                accessExpiresAt: null,
              },
            ]
          : [],
      server_has_saved_session: () => true,
      reconnect_server: () => {
        connected = true;
        return {
          connected: true,
          serverUrl: 'https://collab.example.com',
          allowInvalidCertificates: false,
          user: { id: 'u1', username: 'ada', displayName: 'Ada' },
          accessExpiresAt: null,
        };
      },
      hosted_vault_request: () => [
        { id: 'v1', name: 'Research', role: 'viewer', status: 'active', members: 2, storageBytes: 1024 },
      ],
    });

    render(<MobileApp />);

    await waitFor(() => expect(useMobileStore.getState().restored).toBe(true));
    // The reconnect used the stored refresh token (no password re-entry).
    expect(invoke).toHaveBeenCalledWith(
      'reconnect_server',
      expect.objectContaining({ serverUrl: 'https://collab.example.com' }),
    );

    // Switch to the Vaults tab and confirm the vault + read-only affordance show.
    screen.getByRole('button', { name: /Vaults/ }).click();
    await waitFor(() => expect(screen.getByText('Research')).toBeTruthy());
    expect(screen.getAllByText('Read only').length).toBeGreaterThan(0);
    expect(screen.getByText('Viewer')).toBeTruthy();
  });
});
