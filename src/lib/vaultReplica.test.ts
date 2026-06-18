import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostedVaultMeta } from '../types/vault';
import { tauriCommands } from './tauri';
import {
  classifyPendingOperationFailure,
  cleanupReplicaCache,
  discardPendingOperation,
  enqueuePendingOperation,
  initialSyncState,
  isLikelyConnectivityError,
  listPendingOperationRecoveries,
  replayPendingOperations,
  REPLICA_CACHE_BUDGET_BYTES,
  retryPendingOperation,
  seedReplicaFromManifest,
  syncReplicaManifestDelta,
} from './vaultReplica';

vi.mock('./tauri', () => ({
  tauriCommands: {
    hostedVaultRequest: vi.fn(),
    replicaSeed: vi.fn().mockResolvedValue(undefined),
    replicaReadManifest: vi.fn(),
    replicaReadSyncState: vi.fn(),
    replicaEnqueueOperation: vi.fn().mockResolvedValue(undefined),
    replicaListPendingOperations: vi.fn().mockResolvedValue([]),
    replicaUpdateOperationStatus: vi.fn().mockResolvedValue(undefined),
    replicaRecordOperationFailure: vi.fn().mockResolvedValue(undefined),
    replicaRemoveOperation: vi.fn().mockResolvedValue(undefined),
    replicaReadCachedAsset: vi.fn(),
    replicaCleanup: vi.fn().mockResolvedValue({ removedFiles: 2, freedBytes: 10, remainingBytes: 5 }),
  },
}));

const hostedVault: HostedVaultMeta = {
  id: 'hosted-vault',
  kind: 'hosted',
  hostedVaultId: 'hosted-vault',
  serverUrl: 'https://collab.example.test',
  role: 'editor',
  name: 'Hosted Vault',
  path: 'hosted://hosted-vault',
  lastOpened: 1,
  isEncrypted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vaultReplica', () => {
  it('initialSyncState carries the manifest sequence and idle status', () => {
    const state = initialSyncState(12);
    expect(state.manifestSequence).toBe(12);
    expect(state.status).toBe('idle');
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('runs a bounded cache cleanup pass with the default budget', async () => {
    const report = await cleanupReplicaCache(hostedVault);
    expect(tauriCommands.replicaCleanup).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      REPLICA_CACHE_BUDGET_BYTES,
    );
    expect(report.removedFiles).toBe(2);
  });

  it('forwards an explicit cleanup budget', async () => {
    await cleanupReplicaCache(hostedVault, 1024);
    expect(tauriCommands.replicaCleanup).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      1024,
    );
  });

  it('detects connectivity-shaped errors without swallowing validation failures', () => {
    expect(isLikelyConnectivityError(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isLikelyConnectivityError(new Error('manifest_conflict'))).toBe(false);
  });

  it('classifies irreconcilable replay failures for recovery flows', () => {
    expect(classifyPendingOperationFailure(new Error('The vault manifest has changed since the supplied sequence.'))).toEqual({
      code: 'manifest_conflict',
      message: 'The vault manifest has changed since the supplied sequence.',
    });
    expect(classifyPendingOperationFailure(new Error('You do not have permission to perform this vault operation.')).code)
      .toBe('permission_revoked');
  });

  it('seeds the replica from the fetched server manifest', async () => {
    const manifest = { vaultId: 'hosted-vault', sequence: 9, files: [] };
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue(manifest);

    await seedReplicaFromManifest(hostedVault);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/manifest',
    );
    expect(tauriCommands.replicaSeed).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'Hosted Vault',
      manifest,
      expect.objectContaining({ manifestSequence: 9, status: 'idle' }),
    );
  });

  it('propagates fetch failures so callers can treat seeding as best-effort', async () => {
    vi.mocked(tauriCommands.hostedVaultRequest).mockRejectedValue(new Error('offline'));
    await expect(seedReplicaFromManifest(hostedVault)).rejects.toThrow('offline');
    expect(tauriCommands.replicaSeed).not.toHaveBeenCalled();
  });

  it('merges manifest delta entries into the cached replica manifest', async () => {
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([]);
    vi.mocked(tauriCommands.replicaReadManifest).mockResolvedValue({
      vaultId: 'hosted-vault',
      sequence: 9,
      files: [
        { id: 'file-1', relativePath: 'Old.md', state: 'active' },
        { id: 'file-2', relativePath: 'Keep.md', state: 'active' },
      ],
    });
    vi.mocked(tauriCommands.replicaReadSyncState).mockResolvedValue({
      manifestSequence: 9,
      lastSyncedAt: '2026-06-17T00:00:00Z',
      status: 'idle',
    });
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue({
      vaultId: 'hosted-vault',
      baseSequence: 9,
      sequence: 10,
      changedFiles: [{ id: 'file-1', relativePath: 'Renamed.md', state: 'active' }],
    });

    const manifest = await syncReplicaManifestDelta(hostedVault);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/manifest/delta?since=9',
    );
    expect(manifest.sequence).toBe(10);
    expect(manifest.files).toEqual([
      { id: 'file-1', relativePath: 'Renamed.md', state: 'active' },
      { id: 'file-2', relativePath: 'Keep.md', state: 'active' },
    ]);
    expect(tauriCommands.replicaSeed).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'Hosted Vault',
      manifest,
      expect.objectContaining({ manifestSequence: 10, status: 'idle' }),
    );
  });

  it('falls back to full seeding when there is no cached manifest', async () => {
    const manifest = { vaultId: 'hosted-vault', sequence: 11, files: [] };
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([]);
    vi.mocked(tauriCommands.replicaReadManifest)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(manifest);
    vi.mocked(tauriCommands.replicaReadSyncState).mockResolvedValue({
      manifestSequence: 0,
      lastSyncedAt: null,
      status: 'idle',
    });
    vi.mocked(tauriCommands.hostedVaultRequest).mockResolvedValue(manifest);

    await expect(syncReplicaManifestDelta(hostedVault)).resolves.toEqual(manifest);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/manifest',
    );
  });

  it('enqueues pending operations with stable replay metadata', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

    const operation = await enqueuePendingOperation(hostedVault, {
      kind: 'rename',
      fileId: 'file-1',
      relativePath: 'Old.md',
      baseManifestSequence: 8,
      payload: { operationType: 'rename', targetFileId: 'file-1', name: 'New.md' },
    });

    expect(operation).toEqual(expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'rename',
      fileId: 'file-1',
      relativePath: 'Old.md',
      baseManifestSequence: 8,
      status: 'pending',
    }));
    expect(tauriCommands.replicaEnqueueOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      operation,
    );
  });

  it('replays pending create, edit, and structural operations with temporary file-id mapping', async () => {
    const operations = [
      {
        id: 'op-create',
        kind: 'create' as const,
        fileId: 'offline-file-1',
        relativePath: 'Draft.md',
        payload: {
          parentId: null,
          name: 'Draft.md',
          kind: 'document',
          documentType: 'note',
          content: '',
          tempFileId: 'offline-file-1',
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:00Z',
        status: 'pending' as const,
      },
      {
        id: 'op-edit',
        kind: 'edit' as const,
        fileId: 'offline-file-1',
        relativePath: 'Draft.md',
        payload: {
          targetFileId: 'offline-file-1',
          expectedRevisionSequence: 0,
          content: '# Draft',
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:01Z',
        status: 'pending' as const,
      },
      {
        id: 'op-rename',
        kind: 'rename' as const,
        fileId: 'offline-file-1',
        relativePath: 'Draft.md',
        payload: {
          clientOperationId: '11111111-1111-4111-8111-111111111111',
          baseManifestSequence: 8,
          operationType: 'rename',
          targetFileId: 'offline-file-1',
          name: 'Final.md',
          parentId: null,
          removeReferences: false,
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:02Z',
        status: 'pending' as const,
      },
    ];
    const seededManifest = { vaultId: 'hosted-vault', sequence: 12, files: [] };
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue(operations);
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce({ id: 'file-123' })
      .mockResolvedValueOnce({ file: { id: 'file-123' }, content: '# Draft' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(seededManifest);

    await replayPendingOperations(hostedVault);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      1,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files',
      {
        parentId: null,
        name: 'Draft.md',
        kind: 'document',
        documentType: 'note',
        content: '',
      },
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      2,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/files/file-123/revisions',
      { expectedRevisionSequence: 0, content: '# Draft' },
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      3,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/operations',
      {
        clientOperationId: '11111111-1111-4111-8111-111111111111',
        baseManifestSequence: 8,
        operationType: 'rename',
        targetFileId: 'file-123',
        name: 'Final.md',
        parentId: null,
        removeReferences: false,
      },
    );
    expect(tauriCommands.replicaRemoveOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-create',
    );
    expect(tauriCommands.replicaRemoveOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-edit',
    );
    expect(tauriCommands.replicaRemoveOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-rename',
    );
    expect(tauriCommands.replicaSeed).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'Hosted Vault',
      seededManifest,
      expect.objectContaining({ manifestSequence: 12, status: 'idle' }),
    );
  });

  it('replays pending asset uploads from the replica asset cache', async () => {
    const operations = [
      {
        id: 'op-folder',
        kind: 'create' as const,
        fileId: 'offline-folder-1',
        relativePath: 'Pictures',
        payload: {
          parentId: null,
          name: 'Pictures',
          kind: 'folder',
          documentType: null,
          content: '',
          tempFileId: 'offline-folder-1',
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:00Z',
        status: 'pending' as const,
      },
      {
        id: 'op-upload',
        kind: 'assetUpload' as const,
        fileId: 'offline-asset-1',
        relativePath: 'Pictures/diagram.png',
        payload: {
          parentId: 'offline-folder-1',
          name: 'diagram.png',
          mediaType: 'image/png',
          expectedHash: 'abc123',
          assetCacheId: 'offline-asset-1',
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:01Z',
        status: 'pending' as const,
      },
    ];
    const seededManifest = { vaultId: 'hosted-vault', sequence: 12, files: [] };
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue(operations);
    vi.mocked(tauriCommands.replicaReadCachedAsset).mockResolvedValue('aW1n');
    vi.mocked(tauriCommands.hostedVaultRequest)
      .mockResolvedValueOnce({ id: 'folder-123' })
      .mockResolvedValueOnce({ id: 'asset-123' })
      .mockResolvedValueOnce(seededManifest);

    await replayPendingOperations(hostedVault);

    expect(tauriCommands.hostedVaultRequest).toHaveBeenNthCalledWith(
      2,
      'https://collab.example.test',
      'POST',
      '/api/v1/vaults/hosted-vault/uploads',
      {
        parentId: 'folder-123',
        name: 'diagram.png',
        mediaType: 'image/png',
        contentBase64: 'aW1n',
        expectedHash: 'abc123',
      },
    );
    expect(tauriCommands.replicaRemoveOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-upload',
    );
  });

  it('does not fetch a full manifest when there are no pending operations to replay', async () => {
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([]);

    await replayPendingOperations(hostedVault);

    expect(tauriCommands.hostedVaultRequest).not.toHaveBeenCalled();
    expect(tauriCommands.replicaSeed).not.toHaveBeenCalled();
  });

  it('records failed replay operations with recovery metadata and stops dependent replay', async () => {
    const operations = [
      {
        id: 'op-rename',
        kind: 'rename' as const,
        fileId: 'file-1',
        relativePath: 'Old.md',
        payload: {
          clientOperationId: '11111111-1111-4111-8111-111111111111',
          baseManifestSequence: 8,
          operationType: 'rename',
          targetFileId: 'file-1',
          name: 'New.md',
          parentId: null,
          removeReferences: false,
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:00Z',
        status: 'pending' as const,
      },
      {
        id: 'op-edit',
        kind: 'edit' as const,
        fileId: 'file-1',
        relativePath: 'Old.md',
        payload: {
          targetFileId: 'file-1',
          expectedRevisionSequence: 1,
          content: '# Later',
        },
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:01Z',
        status: 'pending' as const,
      },
    ];
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue(operations);
    vi.mocked(tauriCommands.hostedVaultRequest).mockRejectedValue(
      new Error('The vault manifest has changed since the supplied sequence.'),
    );

    await replayPendingOperations(hostedVault);

    expect(tauriCommands.replicaRecordOperationFailure).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-rename',
      'manifest_conflict',
      'The vault manifest has changed since the supplied sequence.',
    );
    expect(tauriCommands.hostedVaultRequest).toHaveBeenCalledTimes(1);
    expect(tauriCommands.replicaRemoveOperation).not.toHaveBeenCalled();
  });

  it('lists failed operations with recommended recovery actions', async () => {
    vi.mocked(tauriCommands.replicaListPendingOperations).mockResolvedValue([
      {
        id: 'op-1',
        kind: 'rename',
        fileId: 'file-1',
        relativePath: 'Old.md',
        payload: {},
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:00Z',
        status: 'failed',
        failureCode: 'manifest_conflict',
        failureMessage: 'The vault manifest has changed since the supplied sequence.',
      },
      {
        id: 'op-2',
        kind: 'edit',
        fileId: 'file-2',
        relativePath: 'Other.md',
        payload: {},
        baseManifestSequence: 8,
        createdAt: '2026-06-18T08:00:01Z',
        status: 'pending',
      },
    ]);

    await expect(listPendingOperationRecoveries(hostedVault)).resolves.toEqual([
      expect.objectContaining({
        failure: {
          code: 'manifest_conflict',
          message: 'The vault manifest has changed since the supplied sequence.',
        },
        recommendedAction: 'retry-after-refresh',
      }),
    ]);
  });

  it('retries or discards failed pending operations through the replica queue', async () => {
    await retryPendingOperation(hostedVault, 'op-1');
    await discardPendingOperation(hostedVault, 'op-2');

    expect(tauriCommands.replicaUpdateOperationStatus).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-1',
      'pending',
    );
    expect(tauriCommands.replicaRemoveOperation).toHaveBeenCalledWith(
      'https://collab.example.test',
      'hosted-vault',
      'op-2',
    );
  });
});
