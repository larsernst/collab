import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsServerSection from './SettingsServerSection';
import { tauriCommands } from '../../lib/tauri';

vi.mock('../../lib/tauri', () => ({
  tauriCommands: {
    serverConnectionStatus: vi.fn(),
    connectServer: vi.fn(),
    reconnectServer: vi.fn(),
    disconnectServer: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('SettingsServerSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(tauriCommands.serverConnectionStatus).mockResolvedValue({
      connected: false,
      serverUrl: null,
      user: null,
      accessExpiresAt: null,
    });
  });

  it('connects through the typed Tauri boundary and persists only the server URL', async () => {
    vi.mocked(tauriCommands.connectServer).mockResolvedValue({
      connected: true,
      serverUrl: 'https://collab.example.com',
      user: { id: '1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active' },
      accessExpiresAt: '2026-06-09T12:00:00Z',
    });
    render(<SettingsServerSection />);
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://collab.example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-stored-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(tauriCommands.connectServer).toHaveBeenCalledWith('https://collab.example.com', 'alice', 'not-stored-password'));
    expect(localStorage.getItem('collab-hosted-server-url')).toBe('https://collab.example.com');
    expect(JSON.stringify(localStorage)).not.toContain('not-stored-password');
  });
});
