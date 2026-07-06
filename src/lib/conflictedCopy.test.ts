import { describe, expect, it, vi } from 'vitest';

import { saveConflictedCopy, uniqueConflictedPath } from './conflictedCopy';
import type { VaultClient } from './vaultClient';

describe('uniqueConflictedPath', () => {
  it('inserts a dated suffix before the extension', () => {
    const path = uniqueConflictedPath('Notes/plan.md', new Set());
    expect(path).toMatch(/^Notes\/plan \(conflicted copy \d{4}-\d{2}-\d{2}\)\.md$/);
  });

  it('disambiguates against existing copies', () => {
    const first = uniqueConflictedPath('a.canvas', new Set());
    const path = uniqueConflictedPath('a.canvas', new Set([first]));
    expect(path).toMatch(/ 2\.canvas$/);
  });

  it('handles paths without an extension', () => {
    const path = uniqueConflictedPath('README', new Set());
    expect(path).toMatch(/^README \(conflicted copy \d{4}-\d{2}-\d{2}\)$/);
  });
});

describe('saveConflictedCopy', () => {
  it('creates and writes a sibling copy through the vault client', async () => {
    const createDocument = vi.fn().mockResolvedValue(undefined);
    const writeDocument = vi.fn().mockResolvedValue({ version: 'v1' });
    const client = {
      listFiles: vi.fn().mockResolvedValue([{ relativePath: 'Notes/plan.md' }]),
      createDocument,
      writeDocument,
    } as unknown as VaultClient;

    const target = await saveConflictedCopy(client, 'Notes/plan.md', 'my local work');

    expect(target).toMatch(/^Notes\/plan \(conflicted copy .*\)\.md$/);
    expect(createDocument).toHaveBeenCalledWith(target);
    expect(writeDocument).toHaveBeenCalledWith(target, 'my local work');
  });
});
