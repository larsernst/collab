import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalVaultMeta } from '../types/vault';
import { tauriCommands } from './tauri';
import { LOCAL_VAULT_CAPABILITIES, LocalVaultClient } from './vaultClient';

vi.mock('./tauri', () => ({
  tauriCommands: {
    listVaultFiles: vi.fn(),
    readNote: vi.fn(),
    writeNote: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    previewRenameMove: vi.fn(),
    renameNote: vi.fn(),
    moveNoteToTrash: vi.fn(),
    listTrashEntries: vi.fn(),
    searchNotes: vi.fn(),
    listSnapshots: vi.fn(),
    readSnapshot: vi.fn(),
  },
}));

const vault: LocalVaultMeta = {
  id: 'local-vault',
  kind: 'local',
  name: 'Local vault',
  path: '/vault',
  lastOpened: 1,
  isEncrypted: false,
};

describe('LocalVaultClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('advertises local runtime capabilities', () => {
    const client = new LocalVaultClient(vault);
    expect(client.kind).toBe('local');
    expect(client.id).toBe('local-vault');
    expect(client.capabilities).toEqual(LOCAL_VAULT_CAPABILITIES);
    expect(client.capabilities.hostedMemberships).toBe(false);
  });

  it('maps local document hashes to opaque client versions', async () => {
    vi.mocked(tauriCommands.readNote).mockResolvedValue({
      content: '# Test',
      hash: 'hash-1',
      modifiedAt: 123,
    });
    vi.mocked(tauriCommands.writeNote).mockResolvedValue({
      hash: 'hash-2',
      mergedContent: '# Merged',
    });
    const client = new LocalVaultClient(vault);

    await expect(client.readDocument('Notes/Test.md')).resolves.toEqual({
      relativePath: 'Notes/Test.md',
      content: '# Test',
      version: 'hash-1',
      modifiedAt: 123,
    });
    await expect(client.writeDocument('Notes/Test.md', '# Next', 'hash-1', '# Test')).resolves.toEqual({
      version: 'hash-2',
      mergedContent: '# Merged',
      conflict: undefined,
    });
    expect(tauriCommands.writeNote).toHaveBeenCalledWith('/vault', 'Notes/Test.md', '# Next', 'hash-1', '# Test');
  });

  it('delegates file, trash, search, and history operations through typed Tauri commands', async () => {
    const client = new LocalVaultClient(vault);
    await client.listFiles();
    await client.createDocument('Test.md');
    await client.createFolder('Notes');
    await client.previewRenameMove('Test.md', 'Notes/Test.md');
    await client.renameMove('Test.md', 'Notes/Test.md', true);
    await client.moveToTrash('Notes/Test.md', true);
    await client.listTrash();
    await client.search('test');
    await client.listSnapshots('Notes/Test.md');
    await client.readSnapshot('Notes/Test.md', 'snapshot-1');

    expect(tauriCommands.listVaultFiles).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.createNote).toHaveBeenCalledWith('/vault', 'Test.md');
    expect(tauriCommands.createFolder).toHaveBeenCalledWith('/vault', 'Notes');
    expect(tauriCommands.previewRenameMove).toHaveBeenCalledWith('/vault', 'Test.md', 'Notes/Test.md');
    expect(tauriCommands.renameNote).toHaveBeenCalledWith('/vault', 'Test.md', 'Notes/Test.md', true);
    expect(tauriCommands.moveNoteToTrash).toHaveBeenCalledWith('/vault', 'Notes/Test.md', undefined, undefined, true);
    expect(tauriCommands.listTrashEntries).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.searchNotes).toHaveBeenCalledWith('/vault', 'test');
    expect(tauriCommands.listSnapshots).toHaveBeenCalledWith('/vault', 'Notes/Test.md');
    expect(tauriCommands.readSnapshot).toHaveBeenCalledWith('/vault', 'Notes/Test.md', 'snapshot-1');
  });
});
