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
  hostedVaultRequest: vi.fn(),
  replicaSeed: vi.fn(),
  replicaReadManifest: vi.fn(),
  replicaReadSyncState: vi.fn(),
  replicaListPendingOperations: vi.fn(),
  replicaCleanup: vi.fn().mockResolvedValue({ removedFiles: 0, freedBytes: 0, remainingBytes: 0 }),
}));

vi.mock('../lib/tauri', () => ({
  tauriCommands: tauriCommandsMock,
}));

import type { HostedVaultMeta } from '../types/vault';
import { sortFileTreeAlphabetically, useVaultStore } from './vaultStore';

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
    tauriCommandsMock.replicaReadManifest.mockResolvedValue(null);
    tauriCommandsMock.replicaReadSyncState.mockResolvedValue({
      manifestSequence: 0,
      lastSyncedAt: null,
      status: 'idle',
    });
    tauriCommandsMock.replicaListPendingOperations.mockResolvedValue([]);
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

  it('sorts file trees alphabetically and recursively for display', () => {
    const sorted = sortFileTreeAlphabetically([
      {
        relativePath: 'Beta',
        name: 'Beta',
        extension: '',
        modifiedAt: 1,
        size: 0,
        isFolder: true,
      },
      {
        relativePath: 'zeta.md',
        name: 'zeta.md',
        extension: 'md',
        modifiedAt: 1,
        size: 1,
        isFolder: false,
      },
      {
        relativePath: 'Ordner',
        name: 'Ordner',
        extension: '',
        modifiedAt: 1,
        size: 0,
        isFolder: true,
        children: [
          {
            relativePath: 'Ordner/zulu.md',
            name: 'zulu.md',
            extension: 'md',
            modifiedAt: 1,
            size: 1,
            isFolder: false,
          },
          {
            relativePath: 'Ordner/Ähre.md',
            name: 'Ähre.md',
            extension: 'md',
            modifiedAt: 1,
            size: 1,
            isFolder: false,
          },
          {
            relativePath: 'Ordner/alpha.md',
            name: 'alpha.md',
            extension: 'md',
            modifiedAt: 1,
            size: 1,
            isFolder: false,
          },
        ],
      },
      {
        relativePath: 'Alpha.md',
        name: 'Alpha.md',
        extension: 'md',
        modifiedAt: 1,
        size: 1,
        isFolder: false,
      },
      {
        relativePath: 'äther.md',
        name: 'äther.md',
        extension: 'md',
        modifiedAt: 1,
        size: 1,
        isFolder: false,
      },
    ]);

    expect(sorted.map((node) => node.name)).toEqual(['Beta', 'Ordner', 'Alpha.md', 'äther.md', 'zeta.md']);
    expect(sorted[1]?.children?.map((node) => node.name)).toEqual(['Ähre.md', 'alpha.md', 'zulu.md']);
  });

  it('refreshes hosted file trees without starting a local filesystem watcher', async () => {
    useVaultStore.setState({
      vault: {
        kind: 'hosted',
        id: 'hosted-vault',
        hostedVaultId: 'hosted-vault',
        serverUrl: 'https://collab.example.test',
        role: 'editor',
        name: 'Hosted Vault',
        path: 'hosted://hosted-vault',
        lastOpened: 1,
        isEncrypted: false,
      },
    });
    const manifest = {
      vaultId: 'hosted-vault',
      sequence: 1,
      files: [
        {
          id: 'file-1',
          parentId: null,
          name: 'Hosted.md',
          relativePath: 'Hosted.md',
          kind: 'document',
          documentType: 'note',
          state: 'active',
          currentRevision: null,
          createdAt: '2026-06-11T08:00:00Z',
          updatedAt: '2026-06-11T08:00:00Z',
        },
      ],
    };
    tauriCommandsMock.replicaReadManifest.mockResolvedValue(manifest);
    tauriCommandsMock.replicaReadSyncState.mockResolvedValue({
      manifestSequence: 1,
      lastSyncedAt: '2026-06-17T00:00:00Z',
      status: 'idle',
    });
    tauriCommandsMock.hostedVaultRequest.mockResolvedValue({
      vaultId: 'hosted-vault',
      baseSequence: 1,
      sequence: 1,
      changedFiles: [],
    });

    await useVaultStore.getState().refreshFileTree();
    expect(useVaultStore.getState().fileTree).toEqual([
      expect.objectContaining({ relativePath: 'Hosted.md' }),
    ]);

    useVaultStore.getState().closeVault();

    expect(tauriCommandsMock.watchVault).not.toHaveBeenCalled();
    expect(tauriCommandsMock.unwatchVault).not.toHaveBeenCalled();
  });

  it('opens hosted vault metadata through HostedVaultClient without local IPC', async () => {
    const hosted = {
      kind: 'hosted' as const,
      id: 'hosted-vault',
      hostedVaultId: 'hosted-vault',
      serverUrl: 'https://collab.example.test',
      role: 'editor' as const,
      name: 'Hosted Vault',
      path: 'hosted://hosted-vault',
      lastOpened: 1,
      isEncrypted: false,
    };
    const manifest = { vaultId: 'hosted-vault', sequence: 1, files: [] };
    tauriCommandsMock.replicaReadManifest.mockResolvedValue(manifest);
    tauriCommandsMock.replicaReadSyncState.mockResolvedValue({
      manifestSequence: 1,
      lastSyncedAt: '2026-06-17T00:00:00Z',
      status: 'idle',
    });
    tauriCommandsMock.hostedVaultRequest.mockResolvedValue({
      vaultId: 'hosted-vault',
      baseSequence: 1,
      sequence: 1,
      changedFiles: [],
    });

    await useVaultStore.getState().openHostedVault(hosted);

    expect(useVaultStore.getState().vault).toEqual(hosted);
    expect(useVaultStore.getState().lastOpenedVaultPath).toBeNull();
    expect(tauriCommandsMock.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/manifest/delta?since=1',
    );
    expect(tauriCommandsMock.openVault).not.toHaveBeenCalled();
    expect(tauriCommandsMock.watchVault).not.toHaveBeenCalled();
  });

  const hostedVault: HostedVaultMeta = {
    kind: 'hosted',
    id: 'hosted-vault',
    hostedVaultId: 'hosted-vault',
    serverUrl: 'https://collab.example.test',
    role: 'editor',
    name: 'Hosted Vault',
    path: 'hosted://hosted-vault',
    lastOpened: 1,
    isEncrypted: false,
  };

  it('seeds the offline replica from the manifest when opening a hosted vault', async () => {
    const manifest = { vaultId: 'hosted-vault', sequence: 4, files: [] };
    tauriCommandsMock.hostedVaultRequest.mockImplementation((_url, _method, path) =>
      Promise.resolve(path.endsWith('/manifest') ? manifest : []),
    );
    tauriCommandsMock.replicaSeed.mockResolvedValue(undefined);

    await useVaultStore.getState().openHostedVault(hostedVault);

    await vi.waitFor(() => expect(tauriCommandsMock.replicaSeed).toHaveBeenCalled());
    expect(tauriCommandsMock.replicaSeed).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'Hosted Vault',
      manifest,
      expect.objectContaining({ manifestSequence: 4, status: 'idle' }),
    );
  });

  it('still opens a hosted vault when replica seeding fails', async () => {
    const manifest = { vaultId: 'hosted-vault', sequence: 1, files: [] };
    tauriCommandsMock.replicaReadManifest.mockResolvedValue(manifest);
    tauriCommandsMock.replicaReadSyncState.mockResolvedValue({
      manifestSequence: 1,
      lastSyncedAt: '2026-06-17T00:00:00Z',
      status: 'idle',
    });
    tauriCommandsMock.hostedVaultRequest.mockImplementation((_url, _method, path) =>
      path.endsWith('/manifest') ? Promise.reject(new Error('offline')) : Promise.resolve({
        vaultId: 'hosted-vault',
        baseSequence: 1,
        sequence: 1,
        changedFiles: [],
      }),
    );

    await useVaultStore.getState().openHostedVault(hostedVault);

    expect(useVaultStore.getState().vault).toEqual(hostedVault);
    expect(useVaultStore.getState().isLoading).toBe(false);
  });
});
