import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientMocks = vi.hoisted(() => ({
  readDocument: vi.fn(),
  writeDocument: vi.fn(),
  readAssetDataUrl: vi.fn(),
}));

vi.mock('../../lib/vaultClient', () => ({
  createVaultClient: () => clientMocks,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useSvgSession } from './useSvgSession';
import { addNode, createNode } from '../../lib/svgDocument';
import type { VaultMeta } from '../../types/vault';

const localVault = { path: '/vault', name: 'v', kind: 'local' } as unknown as VaultMeta;
const hostedViewer = { path: 'hosted://x', name: 'v', kind: 'hosted', role: 'viewer' } as unknown as VaultMeta;

const SAMPLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10"/></svg>';

function renderSession(vault: VaultMeta) {
  const markDirty = vi.fn();
  const markSaved = vi.fn();
  const result = renderHook(() =>
    useSvgSession({ vault, relativePath: 'art.svg', markDirty, markSaved }),
  );
  return { ...result, markDirty, markSaved };
}

describe('useSvgSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.readDocument.mockResolvedValue({ relativePath: 'art.svg', content: SAMPLE, version: 'v1', modifiedAt: 0 });
    clientMocks.writeDocument.mockResolvedValue({ version: 'v2' });
    clientMocks.readAssetDataUrl.mockReset();
  });

  it('loads and parses the SVG, starting clean', async () => {
    const { result } = renderSession(localVault);
    await waitFor(() => expect(result.current.scene).not.toBeNull());
    expect(result.current.scene?.slots.filter((s) => s.kind === 'node')).toHaveLength(1);
    expect(result.current.dirty).toBe(false);
    expect(result.current.readOnly).toBe(false);
  });

  it('reports an error for invalid SVG without throwing', async () => {
    clientMocks.readDocument.mockResolvedValue({ relativePath: 'art.svg', content: 'nonsense', version: 'v1', modifiedAt: 0 });
    const { result } = renderSession(localVault);
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.scene).toBeNull();
  });

  it('becomes dirty on edit and saves with the optimistic version', async () => {
    const { result } = renderSession(localVault);
    await waitFor(() => expect(result.current.scene).not.toBeNull());

    act(() => {
      result.current.setScene((s) => (s ? addNode(s, createNode('rect', { x: 5, y: 5, width: 5, height: 5 })) : s));
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));

    await act(async () => {
      await result.current.save();
    });
    expect(clientMocks.writeDocument).toHaveBeenCalledTimes(1);
    const [path, content, expectedVersion] = clientMocks.writeDocument.mock.calls[0];
    expect(path).toBe('art.svg');
    expect(content).toContain('<rect');
    expect(expectedVersion).toBe('v1');
    await waitFor(() => expect(result.current.dirty).toBe(false));
  });

  it('surfaces a conflict without advancing the saved baseline', async () => {
    clientMocks.writeDocument.mockResolvedValue({ version: 'v1', conflict: { reason: 'overlap' } });
    const { result } = renderSession(localVault);
    await waitFor(() => expect(result.current.scene).not.toBeNull());
    act(() => {
      result.current.setScene((s) => (s ? addNode(s, createNode('rect', { x: 5, y: 5, width: 5, height: 5 })) : s));
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.dirty).toBe(true);
  });

  it('falls back to the asset path when the document read fails, and blocks save', async () => {
    clientMocks.readDocument.mockRejectedValue(new Error('Only active text documents can be read through this endpoint.'));
    clientMocks.readAssetDataUrl.mockResolvedValue(`data:image/svg+xml;base64,${btoa(SAMPLE)}`);

    const { result } = renderSession(localVault);
    await waitFor(() => expect(result.current.scene).not.toBeNull());
    expect(result.current.assetBacked).toBe(true);
    expect(result.current.scene?.slots.filter((s) => s.kind === 'node')).toHaveLength(1);

    act(() => {
      result.current.setScene((s) => (s ? addNode(s, createNode('rect', { x: 5, y: 5, width: 5, height: 5 })) : s));
    });
    await act(async () => {
      await result.current.save();
    });
    expect(clientMocks.writeDocument).not.toHaveBeenCalled();
  });

  it('is read-only for a hosted viewer and never writes', async () => {
    const { result } = renderSession(hostedViewer);
    await waitFor(() => expect(result.current.scene).not.toBeNull());
    expect(result.current.readOnly).toBe(true);
    await act(async () => {
      await result.current.save();
    });
    expect(clientMocks.writeDocument).not.toHaveBeenCalled();
  });
});
