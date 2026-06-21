import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsServerSection from './SettingsServerSection';
import { tauriCommands } from '../../lib/tauri';
import { useServerStore } from '../../store/serverStore';

vi.mock('../../lib/tauri', () => ({
  tauriCommands: {
    serverConnectionStatus: vi.fn(),
    connectServer: vi.fn(),
    reconnectServer: vi.fn(),
    disconnectServer: vi.fn(),
    hostedVaultRequest: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('SettingsServerSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useServerStore.setState({ status: null, hostedVaults: [], isLoading: false, error: null });
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({
      connected: false,
      serverUrl: null,
      allowInvalidCertificates: false,
      user: null,
      accessExpiresAt: null,
    });
  });

  it('connects through the typed Tauri boundary and persists only the server URL', async () => {
    vi.mocked(tauriCommands.connectServer).mockResolvedValue({
      connected: true,
      serverUrl: 'https://collab.example.com',
      allowInvalidCertificates: false,
      user: { id: '1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
      accessExpiresAt: '2026-06-09T12:00:00Z',
    });
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([]);
    render(<SettingsServerSection />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://collab.example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-stored-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(tauriCommands.connectServer).toHaveBeenCalledWith('https://collab.example.com', 'alice', 'not-stored-password', false));
    expect(localStorage.getItem('collab-hosted-server-url')).toBe('https://collab.example.com');
    expect(JSON.stringify(localStorage)).not.toContain('not-stored-password');
  });

  it('explicitly opts into untrusted certificates for private servers', async () => {
    vi.mocked(tauriCommands.connectServer).mockResolvedValue({
      connected: true,
      serverUrl: 'https://collab-server.net.local',
      allowInvalidCertificates: true,
      user: { id: '1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
      accessExpiresAt: '2026-06-09T12:00:00Z',
    });
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([]);
    render(<SettingsServerSection />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://collab-server.net.local' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByLabelText('Allow untrusted TLS certificates'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(tauriCommands.connectServer).toHaveBeenCalledWith(
      'https://collab-server.net.local',
      'alice',
      'password',
      true,
    ));
    expect(localStorage.getItem('collab-hosted-allow-invalid-certificates')).toBe('true');
  });

  it('lets the current client always prepare hosted vaults for offline use', async () => {
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({
      connected: true,
      serverUrl: 'https://collab.example.com',
      allowInvalidCertificates: false,
      user: { id: '1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
      accessExpiresAt: '2026-06-09T12:00:00Z',
    });
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([]);

    render(<SettingsServerSection />);

    const toggle = await screen.findByRole('button', { name: 'Always create offline copy' });
    fireEvent.click(toggle);

    expect(localStorage.getItem('collab-hosted-always-create-offline-copy')).toBe('true');
    expect(await screen.findByRole('button', { name: 'Always create offline copy: On' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Always create offline copy: On' }));
    expect(localStorage.getItem('collab-hosted-always-create-offline-copy')).toBe('false');
  });
});
