import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostedVaultMeta, LocalVaultMeta } from '../types/vault';
import { tauriCommands } from './tauri';
import {
  HOSTED_VAULT_CAPABILITIES,
  HostedVaultClient,
  LOCAL_VAULT_CAPABILITIES,
  LocalVaultClient,
  createVaultClient,
  requireRuntimeCapability,
} from './vaultClient';

vi.mock('./tauri', () => ({
  tauriCommands: {
    listVaultFiles: vi.fn(),
    readNote: vi.fn(),
    writeNote: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    previewRenameMove: vi.fn(),
    renameNote: vi.fn(),
    deleteNote: vi.fn(),
    listFileReferences: vi.fn(),
    moveNoteToTrash: vi.fn(),
    listTrashEntries: vi.fn(),
    restoreTrashedItem: vi.fn(),
    purgeTrashedItem: vi.fn(),
    purgeAllTrash: vi.fn(),
    searchNotes: vi.fn(),
    createSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    readSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    clearSnapshotHistory: vi.fn(),
    readNoteAssetDataUrl: vi.fn(),
    hostedVaultRequest: vi.fn(),
    hostedVaultAssetDataUrl: vi.fn(),
    watchVault: vi.fn(),
    unwatchVault: vi.fn(),
    unlockVault: vi.fn(),
    enableVaultEncryption: vi.fn(),
    disableVaultEncryption: vi.fn(),
    changeVaultPassword: vi.fn(),
    importAssetIntoVault: vi.fn(),
    exportVault: vi.fn(),
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

const hostedVault: HostedVaultMeta = {
  id: 'hosted-vault',
  kind: 'hosted',
  hostedVaultId: 'hosted-vault',
  serverUrl: 'https://collab.example.test',
  role: 'editor',
  name: 'Hosted vault',
  path: 'hosted://hosted-vault',
  lastOpened: 1,
  isEncrypted: false,
};

const rootFolder = {
  id: 'folder-1',
  parentId: null,
  name: 'Notes',
  relativePath: 'Notes',
  kind: 'folder' as const,
  documentType: null,
  state: 'active' as const,
  currentRevision: null,
  createdAt: '2026-06-11T08:00:00Z',
  updatedAt: '2026-06-11T08:00:00Z',
};

const hostedDocument = {
  id: 'file-1',
  parentId: 'folder-1',
  name: 'Test.md',
  relativePath: 'Notes/Test.md',
  kind: 'document' as const,
  documentType: 'note' as const,
  state: 'active' as const,
  currentRevision: {
    id: 'revision-3',
    sequence: 3,
    contentHash: 'hash-3',
    sizeBytes: 6,
    createdByDisplayName: 'Alice',
    createdAt: '2026-06-11T08:00:00Z',
  },
  createdAt: '2026-06-11T08:00:00Z',
  updatedAt: '2026-06-11T08:00:00Z',
};

function mockHostedManifest(sequence = 8) {
  return { vaultId: 'hosted-vault', sequence, files: [rootFolder, hostedDocument] };
}

describe('LocalVaultClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('advertises local runtime capabilities', () => {
    const client = new LocalVaultClient(vault);
    expect(client.kind).toBe('local');
    expect(client.id).toBe('local-vault');
    expect(client.capabilities).toEqual(LOCAL_VAULT_CAPABILITIES);
    expect(client.capabilities.hostedMemberships).toBe(false);
    expect(client.runtime).toEqual({
      watch: expect.any(Object),
      encryption: expect.any(Object),
      externalAssetImport: expect.any(Object),
      archiveExport: expect.any(Object),
    });
  });

  it('routes native-only operations through explicit local runtime capabilities', async () => {
    const client = new LocalVaultClient(vault);
    await requireRuntimeCapability(client, 'watch').start();
    await requireRuntimeCapability(client, 'encryption').unlock('password');
    await requireRuntimeCapability(client, 'externalAssetImport').import('/tmp/image.png', 'Pictures');
    await requireRuntimeCapability(client, 'archiveExport').exportTo('/tmp/vault.zip');

    expect(tauriCommands.watchVault).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.unlockVault).toHaveBeenCalledWith('/vault', 'password');
    expect(tauriCommands.importAssetIntoVault).toHaveBeenCalledWith('/vault', '/tmp/image.png', 'Pictures');
    expect(tauriCommands.exportVault).toHaveBeenCalledWith('/vault', '/tmp/vault.zip');
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
    vi.mocked(tauriCommands.restoreSnapshot).mockResolvedValue({ hash: 'restored-hash' });
    const client = new LocalVaultClient(vault);
    await client.listFiles();
    await client.createDocument('Test.md');
    await client.createFolder('Notes');
    await client.previewRenameMove('Test.md', 'Notes/Test.md');
    await client.renameMove('Test.md', 'Notes/Test.md', true);
    await client.moveToTrash('Notes/Test.md', true);
    await client.deletePermanently('Old.md', true);
    await client.listReferences('Notes/Test.md');
    await client.listTrash();
    await client.restoreTrash('trash-1', 'Notes/Test.md');
    await client.purgeTrash('trash-2', true);
    await client.purgeAllTrash();
    await client.search('test');
    await client.createSnapshot('Notes/Test.md', '# Test', 'user-1', 'Alice', 'Checkpoint');
    await client.listSnapshots('Notes/Test.md');
    await client.readSnapshot('Notes/Test.md', 'snapshot-1');
    await client.restoreSnapshot('Notes/Test.md', 'snapshot-1', 'user-1', 'Alice');
    await client.deleteSnapshot('Notes/Test.md', 'snapshot-1');
    await client.clearSnapshotHistory('Notes/Test.md');
    await client.readAssetDataUrl('Pictures/diagram.png');

    expect(tauriCommands.listVaultFiles).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.createNote).toHaveBeenCalledWith('/vault', 'Test.md');
    expect(tauriCommands.createFolder).toHaveBeenCalledWith('/vault', 'Notes');
    expect(tauriCommands.previewRenameMove).toHaveBeenCalledWith('/vault', 'Test.md', 'Notes/Test.md');
    expect(tauriCommands.renameNote).toHaveBeenCalledWith('/vault', 'Test.md', 'Notes/Test.md', true);
    expect(tauriCommands.moveNoteToTrash).toHaveBeenCalledWith('/vault', 'Notes/Test.md', undefined, undefined, true);
    expect(tauriCommands.deleteNote).toHaveBeenCalledWith('/vault', 'Old.md', true);
    expect(tauriCommands.listFileReferences).toHaveBeenCalledWith('/vault', 'Notes/Test.md');
    expect(tauriCommands.listTrashEntries).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.restoreTrashedItem).toHaveBeenCalledWith('/vault', 'trash-1', 'Notes/Test.md');
    expect(tauriCommands.purgeTrashedItem).toHaveBeenCalledWith('/vault', 'trash-2', true);
    expect(tauriCommands.purgeAllTrash).toHaveBeenCalledWith('/vault');
    expect(tauriCommands.searchNotes).toHaveBeenCalledWith('/vault', 'test');
    expect(tauriCommands.createSnapshot).toHaveBeenCalledWith('/vault', 'Notes/Test.md', '# Test', 'user-1', 'Alice', 'Checkpoint');
    expect(tauriCommands.listSnapshots).toHaveBeenCalledWith('/vault', 'Notes/Test.md');
    expect(tauriCommands.readSnapshot).toHaveBeenCalledWith('/vault', 'Notes/Test.md', 'snapshot-1');
    expect(tauriCommands.restoreSnapshot).toHaveBeenCalledWith('/vault', 'Notes/Test.md', 'snapshot-1', 'user-1', 'Alice');
    expect(tauriCommands.deleteSnapshot).toHaveBeenCalledWith('/vault', 'Notes/Test.md', 'snapshot-1');
    expect(tauriCommands.clearSnapshotHistory).toHaveBeenCalledWith('/vault', 'Notes/Test.md');
    expect(tauriCommands.readNoteAssetDataUrl).toHaveBeenCalledWith('/vault', 'Pictures/diagram.png');
  });
});

describe('HostedVaultClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('advertises online hosted capabilities and builds a nested file tree', async () => {
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue([rootFolder, hostedDocument]);
    const client = new HostedVaultClient(hostedVault);

    expect(client.capabilities).toEqual(HOSTED_VAULT_CAPABILITIES);
    expect(client.runtime).toEqual({});
    await expect(client.listFiles()).resolves.toEqual([
      expect.objectContaining({
        relativePath: 'Notes',
        isFolder: true,
        children: [expect.objectContaining({ relativePath: 'Notes/Test.md', size: 6 })],
      }),
    ]);
  });

  it('maps hosted revision sequences to opaque document versions', async () => {
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce({ file: hostedDocument, content: '# Test' })
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce({
        file: {
          ...hostedDocument,
          currentRevision: { ...hostedDocument.currentRevision, id: 'revision-4', sequence: 4 },
        },
        content: '# Next',
      });
    const client = new HostedVaultClient(hostedVault);

    await expect(client.readDocument('Notes/Test.md')).resolves.toEqual({
      relativePath: 'Notes/Test.md',
      content: '# Test',
      version: '3',
      modifiedAt: Date.parse('2026-06-11T08:00:00Z'),
    });
    await expect(client.writeDocument('Notes/Test.md', '# Next', '3')).resolves.toEqual({ version: '4' });
    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files/file-1/revisions',
      { expectedRevisionSequence: 3, content: '# Next' },
    );
  });

  it('creates documents by resolving their hosted parent folder ID', async () => {
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce(hostedDocument);
    const client = new HostedVaultClient(hostedVault);

    await client.createDocument('Notes/Test.md');

    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files',
      {
        parentId: 'folder-1',
        name: 'Test.md',
        kind: 'document',
        documentType: 'note',
        content: '',
      },
    );
  });

  it('applies move-and-rename as sequential manifest-locked operations', async () => {
    const destination = { ...rootFolder, id: 'folder-2', name: 'Archive', relativePath: 'Archive' };
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce({ ...mockHostedManifest(8), files: [rootFolder, destination, hostedDocument] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ...mockHostedManifest(9),
        files: [rootFolder, destination, { ...hostedDocument, name: 'Renamed.md', relativePath: 'Notes/Renamed.md' }],
      })
      .mockResolvedValueOnce({});
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    const client = new HostedVaultClient(hostedVault);

    await client.renameMove('Notes/Test.md', 'Archive/Renamed.md');

    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      2,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/operations',
      expect.objectContaining({ baseManifestSequence: 8, operationType: 'rename', name: 'Renamed.md' }),
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      4,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/operations',
      expect.objectContaining({ baseManifestSequence: 9, operationType: 'move', parentId: 'folder-2' }),
    );
  });

  it('reads hosted snapshots and authenticated assets without exposing access tokens', async () => {
    const snapshot = {
      id: 'snapshot-1',
      label: 'Checkpoint',
      revision: hostedDocument.currentRevision,
      createdByDisplayName: 'Alice',
      createdAt: '2026-06-11T09:00:00Z',
    };
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce([snapshot])
      .mockResolvedValueOnce({ revision: hostedDocument.currentRevision, content: '# Snapshot' })
      .mockResolvedValueOnce(mockHostedManifest());
    vi.mocked(tauriCommands.hostedVaultAssetDataUrl).mockResolvedValue('data:text/plain;base64,IyBUZXN0');
    const client = new HostedVaultClient(hostedVault);

    await expect(client.readSnapshot('Notes/Test.md', 'snapshot-1')).resolves.toBe('# Snapshot');
    await expect(client.readAssetDataUrl('Notes/Test.md')).resolves.toBe('data:text/plain;base64,IyBUZXN0');
    expect(tauriCommands.hostedVaultAssetDataUrl).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'file-1',
    );
  });

  it('maps structural previews, root trash entries, and hosted search results', async () => {
    const trashedFolder = { ...rootFolder, state: 'trashed' as const, updatedAt: '2026-06-11T10:00:00Z' };
    const trashedChild = {
      ...hostedDocument,
      state: 'trashed' as const,
      updatedAt: '2026-06-11T10:00:00Z',
    };
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce({
        oldRelativePath: 'Notes/Test.md',
        newRelativePath: 'Notes/Renamed.md',
        itemKind: 'document',
        nestedItemCount: 0,
        affectedDocuments: [{ relativePath: 'Index.md' }],
        blockedReason: null,
      })
      .mockResolvedValueOnce({
        ...mockHostedManifest(),
        files: [trashedFolder, trashedChild],
      })
      .mockResolvedValueOnce([
        { relativePath: 'Notes/Test.md', title: 'Test', excerpt: 'match', rank: 0.75 },
      ]);
    const client = new HostedVaultClient(hostedVault);

    await expect(client.previewRenameMove('Notes/Test.md', 'Notes/Renamed.md')).resolves.toEqual({
      oldRelativePath: 'Notes/Test.md',
      newRelativePath: 'Notes/Renamed.md',
      itemKind: 'file',
      operation: 'rename',
      nestedItemCount: 0,
      affectedReferencePaths: ['Index.md'],
      blockedReason: undefined,
    });
    await expect(client.listTrash()).resolves.toEqual([
      expect.objectContaining({ id: 'folder-1', originalRelativePath: 'Notes', itemKind: 'folder' }),
    ]);
    await expect(client.search('hello world')).resolves.toEqual([
      {
        relativePath: 'Notes/Test.md',
        title: 'Test',
        excerpt: 'match',
        score: 0.75,
        matchType: 'hosted',
      },
    ]);
    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/search?q=hello%20world',
      undefined,
    );
  });

  it('restores and purges hosted trash entries through manifest-locked operations', async () => {
    const trashedDocument = { ...hostedDocument, state: 'trashed' as const };
    vi.mocked(tauriCommands.hostedVaultRequest).mockReset();
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce({ ...mockHostedManifest(8), files: [rootFolder, trashedDocument] })
      .mockResolvedValueOnce({ ...mockHostedManifest(8), files: [rootFolder, trashedDocument] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ...mockHostedManifest(9), files: [rootFolder, trashedDocument] })
      .mockResolvedValueOnce({ ...mockHostedManifest(9), files: [rootFolder, trashedDocument] })
      .mockResolvedValueOnce({});
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    const client = new HostedVaultClient(hostedVault);

    await client.restoreTrash('file-1');
    await client.purgeTrash('file-1', true);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      3,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/operations',
      expect.objectContaining({ baseManifestSequence: 8, operationType: 'restore', targetFileId: 'file-1' }),
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      6,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/operations',
      expect.objectContaining({
        baseManifestSequence: 9,
        operationType: 'purge',
        targetFileId: 'file-1',
        removeReferences: true,
      }),
    );
  });

  it('labels the current hosted revision when creating a snapshot without sending content', async () => {
    const snapshot = {
      id: 'snapshot-9',
      label: 'Checkpoint',
      revision: hostedDocument.currentRevision,
      createdByDisplayName: 'Alice',
      createdAt: '2026-06-11T09:00:00Z',
    };
    vi.mocked(tauriCommands.hostedVaultRequest).mockReset();
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce(snapshot);
    const client = new HostedVaultClient(hostedVault);

    await expect(
      client.createSnapshot('Notes/Test.md', 'ignored body', 'ignored', 'ignored', 'Checkpoint'),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'snapshot-9', label: 'Checkpoint', hash: 'hash-3', authorName: 'Alice' }),
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files/file-1/snapshots',
      { revisionId: 'revision-3', label: 'Checkpoint' },
    );
  });

  it('restores hosted snapshots and keeps destructive history immutable', async () => {
    const restoredDocument = {
      ...hostedDocument,
      currentRevision: { ...hostedDocument.currentRevision, id: 'revision-4', sequence: 4 },
    };
    vi.mocked(tauriCommands.hostedVaultRequest).mockReset();
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce({ file: restoredDocument, content: '# Restored' });
    const client = new HostedVaultClient(hostedVault);

    await expect(client.restoreSnapshot('Notes/Test.md', 'snapshot-1', 'ignored', 'ignored')).resolves.toEqual({
      version: '4',
    });
    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files/file-1/snapshots/snapshot-1/restore',
      { expectedRevisionSequence: 3 },
    );
    await expect(client.deleteSnapshot('Notes/Test.md', 'snapshot-1')).rejects.toThrow('immutable');
    await expect(client.clearSnapshotHistory('Notes/Test.md')).rejects.toThrow('immutable');
  });

  it('loads hosted file references through stable file IDs', async () => {
    const reference = {
      sourceFileId: 'source-1',
      sourceRelativePath: 'Index.md',
      sourceDocumentType: 'note',
      referenceKind: 'note-wikilink',
      referencedFileId: 'file-1',
      referencedRelativePath: 'Notes/Test.md',
      displayLabel: 'Test',
      context: '[[Test]]',
    };
    vi.mocked(tauriCommands.hostedVaultRequest).mockReset();
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce(mockHostedManifest())
      .mockResolvedValueOnce([reference]);
    const client = new HostedVaultClient(hostedVault);

    await expect(client.listReferences('Notes/Test.md')).resolves.toEqual([reference]);
    expect(tauriCommands.hostedVaultRequest).toHaveBeenLastCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/files/file-1/references',
      undefined,
    );
  });
});

describe('vault client runtime boundary', () => {
  it('creates the correct client from persisted vault metadata', () => {
    expect(createVaultClient(vault)).toBeInstanceOf(LocalVaultClient);
    expect(createVaultClient({ ...vault, kind: undefined })).toBeInstanceOf(LocalVaultClient);
    expect(createVaultClient(hostedVault)).toBeInstanceOf(HostedVaultClient);
  });

  it('rejects unsupported runtime capabilities instead of falling through to Tauri', () => {
    const client = new HostedVaultClient(hostedVault);
    expect(() => requireRuntimeCapability(client, 'encryption')).toThrow(
      'The encryption capability is not available for hosted vaults.',
    );
    expect(() => requireRuntimeCapability(client, 'archiveExport')).toThrow(
      'The archiveExport capability is not available for hosted vaults.',
    );
  });
});
