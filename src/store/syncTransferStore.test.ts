import { beforeEach, describe, expect, it } from 'vitest';

import { transferPercent, useSyncTransferStore } from './syncTransferStore';

beforeEach(() => useSyncTransferStore.getState().reset());

describe('syncTransferStore', () => {
  it('tracks progress and completion for a transfer', () => {
    const id = useSyncTransferStore.getState().begin({
      vaultId: 'vault-1',
      vaultName: 'Team Vault',
      direction: 'download',
      label: 'Downloading files',
      total: 4,
    });
    useSyncTransferStore.getState().update(id, { completed: 2, detail: 'Plan.md' });

    const active = useSyncTransferStore.getState().transfers[0];
    expect(active).toMatchObject({ completed: 2, total: 4, detail: 'Plan.md', status: 'active' });
    expect(transferPercent(active)).toBe(50);

    useSyncTransferStore.getState().complete(id, 'Downloaded 4 files');
    expect(useSyncTransferStore.getState().transfers[0]).toMatchObject({
      label: 'Downloaded 4 files',
      status: 'completed',
    });
  });

  it('keeps failed transfers until finished history is cleared', () => {
    const id = useSyncTransferStore.getState().begin({
      vaultId: 'vault-1',
      vaultName: 'Team Vault',
      direction: 'upload',
      label: 'Uploading file',
    });
    useSyncTransferStore.getState().fail(id, new Error('offline'));
    expect(useSyncTransferStore.getState().transfers[0].error).toContain('offline');

    useSyncTransferStore.getState().clearFinished();
    expect(useSyncTransferStore.getState().transfers).toEqual([]);
  });
});
