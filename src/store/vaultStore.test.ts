import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriCommandsMock = vi.hoisted(() => ({
  unwatchVault: vi.fn(),
  openVault: vi.fn(),
  listVaultFiles: vi.fn(),
  watchVault: vi.fn(),
  unlockVault: vi.fn(),
  getRecentVaults: vi.fn(),
  removeRecentVault: vi.fn(),
  isFlatpak: vi.fn(),
  showOpenVaultDialog: vi.fn(),
}));

vi.mock('../lib/tauri', () => ({
  tauriCommands: tauriCommandsMock,
}));

import { useVaultStore } from './vaultStore';

describe('vaultStore Flatpak reopen fallback', () => {
  const initialState = useVaultStore.getState();

  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({
      ...initialState,
      vault: null,
      isVaultLocked: false,
      fileTree: [],
      recentVaults: [],
      lastOpenedVaultPath: null,
      isLoading: false,
    });

    tauriCommandsMock.unwatchVault.mockResolvedValue(undefined);
    tauriCommandsMock.listVaultFiles.mockResolvedValue([]);
    tauriCommandsMock.watchVault.mockResolvedValue(undefined);
    tauriCommandsMock.unlockVault.mockResolvedValue(undefined);
    tauriCommandsMock.getRecentVaults.mockResolvedValue([]);
    tauriCommandsMock.removeRecentVault.mockResolvedValue(undefined);
  });

  it('reauthorizes Flatpak recents when direct reopen loses access', async () => {
    tauriCommandsMock.openVault
      .mockRejectedValueOnce(new Error("Cannot open vault path '/old/vault': No such file or directory (os error 2)"))
      .mockResolvedValueOnce({
        id: 'vault-1',
        name: 'Vault',
        path: '/reauthorized/vault',
        lastOpened: 1,
        isEncrypted: false,
      });
    tauriCommandsMock.isFlatpak.mockResolvedValue(true);
    tauriCommandsMock.showOpenVaultDialog.mockResolvedValue('/reauthorized/vault');

    await useVaultStore.getState().openVault('/old/vault');

    expect(tauriCommandsMock.openVault).toHaveBeenNthCalledWith(1, '/old/vault');
    expect(tauriCommandsMock.showOpenVaultDialog).toHaveBeenCalledTimes(1);
    expect(tauriCommandsMock.openVault).toHaveBeenNthCalledWith(2, '/reauthorized/vault');
    expect(useVaultStore.getState().vault?.path).toBe('/reauthorized/vault');
    expect(useVaultStore.getState().lastOpenedVaultPath).toBe('/reauthorized/vault');
    expect(useVaultStore.getState().isLoading).toBe(false);
  });
});
