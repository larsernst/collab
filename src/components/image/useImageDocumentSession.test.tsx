import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({
  readNoteAssetDataUrl: vi.fn(),
  readImageOverlay: vi.fn(),
  writeImageOverlay: vi.fn(),
  deleteImageOverlay: vi.fn(),
  saveGeneratedImage: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock('../../lib/tauri', () => ({
  tauriCommands: tauriMocks,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: eventMocks.listen,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { useImageDocumentSession } from './useImageDocumentSession';
import type { ImageOverlayDocument } from '../../types/image';

type ImageSessionOptions = Parameters<typeof useImageDocumentSession>[0];

const localVault = { id: 'vault-1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: 1 };

function createSessionOptions(overrides: Partial<ImageSessionOptions> = {}): ImageSessionOptions {
  return {
    vault: localVault,
    relativePath: 'Pictures/demo.png',
    refreshFileTree: vi.fn(async () => {}),
    openTab: vi.fn(),
    markDirty: vi.fn(),
    markSaved: vi.fn(),
    mode: 'view',
    image: null,
    dimensions: null,
    overlayDoc: null,
    overlayLoaded: false,
    persistedOverlaySignature: '',
    permanentEdits: { rotation: 0, crop: null, resizeWidth: null, resizeHeight: null, lockAspectRatio: true },
    cropMode: false,
    permanentDisplayDimensions: { width: 100, height: 100 },
    saveIntent: null,
    previewCanvasRef: { current: null },
    loadImage: vi.fn(async () => ({ naturalWidth: 640, naturalHeight: 480 }) as HTMLImageElement),
    createEmptyOverlayDocument: vi.fn((dimensions) => ({
      version: 1 as const,
      baseWidth: dimensions.width,
      baseHeight: dimensions.height,
      items: [],
      updatedAt: 1,
    })),
    buildPermanentCanvas: vi.fn(),
    renderCanvasToElement: vi.fn(),
    drawOverlayToCanvas: vi.fn(),
    getOutputMime: vi.fn(),
    getOutputFileName: vi.fn(),
    getBaseName: vi.fn(),
    setSrc: vi.fn(),
    setImage: vi.fn(),
    setDimensions: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setOverlayDoc: vi.fn(),
    setOverlayLoaded: vi.fn(),
    setPersistedOverlaySignature: vi.fn(),
    setSelectedItemId: vi.fn(),
    setDraftArrow: vi.fn(),
    setDraftStroke: vi.fn(),
    setPermanentEdits: vi.fn(),
    setCropMode: vi.fn(),
    setCropDraft: vi.fn(),
    setCropDragStart: vi.fn(),
    setCropInteraction: vi.fn(),
    setZoomPercent: vi.fn(),
    setEditingTextId: vi.fn(),
    setTextInteraction: vi.fn(),
    setArrowInteraction: vi.fn(),
    setSaveIntent: vi.fn(),
    setSaving: vi.fn(),
    ...overrides,
  };
}

describe('useImageDocumentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventMocks.listen.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads image data and additive overlay state', async () => {
    tauriMocks.readNoteAssetDataUrl.mockResolvedValue('data:image/png;base64,abc');
    tauriMocks.readImageOverlay.mockResolvedValue(null);

    const setSrc = vi.fn();
    const setImage = vi.fn();
    const setDimensions = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();
    const setOverlayDoc = vi.fn();
    const setOverlayLoaded = vi.fn();
    const setPersistedOverlaySignature = vi.fn();

    const options = createSessionOptions({
      setSrc,
      setImage,
      setDimensions,
      setLoading,
      setError,
      setOverlayDoc,
      setOverlayLoaded,
      setPersistedOverlaySignature,
    });

    renderHook(() => useImageDocumentSession(options));

    await waitFor(() => {
      expect(tauriMocks.readNoteAssetDataUrl).toHaveBeenCalledWith('/vault', 'Pictures/demo.png');
      expect(tauriMocks.readImageOverlay).toHaveBeenCalledWith('/vault', 'Pictures/demo.png');
    });

    expect(setSrc).toHaveBeenCalledWith('data:image/png;base64,abc');
    expect(setDimensions).toHaveBeenCalledWith({ width: 640, height: 480 });
    expect(setOverlayDoc).toHaveBeenCalled();
    expect(setOverlayLoaded).toHaveBeenCalledWith(true);
    expect(setPersistedOverlaySignature).toHaveBeenCalledWith(
      '{"version":1,"baseWidth":640,"baseHeight":480,"items":[],"updatedAt":1}',
    );
  });

  it('persists additive overlays after debounce', async () => {
    vi.useFakeTimers();
    tauriMocks.readNoteAssetDataUrl.mockImplementation(() => new Promise(() => {}));

    const options = createSessionOptions({
      mode: 'additive',
      dimensions: { width: 640, height: 480 },
      overlayDoc: { version: 1, baseWidth: 640, baseHeight: 480, items: [{ id: 'text-1', type: 'text', x: 0, y: 0, width: 0.2, height: 0.1, text: 'Hello', color: '#fff', fontSize: 18 }], updatedAt: 1 },
      overlayLoaded: true,
    });

    renderHook(() => useImageDocumentSession(options));

    await vi.advanceTimersByTimeAsync(500);

    expect(tauriMocks.writeImageOverlay).toHaveBeenCalledWith(
      '/vault',
      'Pictures/demo.png',
      expect.stringContaining('"text":"Hello"'),
    );
  });

  it('applies a clean external overlay update from the file watcher', async () => {
    let modifiedHandler: ((event: { payload?: { path?: string } }) => void | Promise<void>) | undefined;
    eventMocks.listen.mockImplementation((_eventName: string, handler: typeof modifiedHandler) => {
      modifiedHandler = handler;
      return Promise.resolve(vi.fn());
    });
    tauriMocks.readNoteAssetDataUrl.mockResolvedValue('data:image/png;base64,abc');
    tauriMocks.readImageOverlay
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('{"version":1,"baseWidth":640,"baseHeight":480,"items":[{"id":"remote","type":"text","x":0,"y":0,"width":0.2,"height":0.1,"text":"Remote","color":"#fff","fontSize":18}],"updatedAt":2}');

    const { result } = renderImageHarness();
    await waitFor(() => expect(result.current.overlayLoaded).toBe(true));
    await waitFor(() => expect(modifiedHandler).toBeTypeOf('function'));

    await act(async () => {
      await modifiedHandler?.({ payload: { path: 'Pictures/demo.png' } });
    });

    await waitFor(() => expect(result.current.overlayDoc?.items).toHaveLength(1));
    expect(result.current.overlayDoc?.items[0]?.id).toBe('remote');
    expect(result.current.session.overlayStatus).toBe('idle');
  });

  it('queues an external overlay update while local annotations are dirty', async () => {
    let modifiedHandler: ((event: { payload?: { path?: string } }) => void | Promise<void>) | undefined;
    eventMocks.listen.mockImplementation((_eventName: string, handler: typeof modifiedHandler) => {
      modifiedHandler = handler;
      return Promise.resolve(vi.fn());
    });
    tauriMocks.readNoteAssetDataUrl.mockResolvedValue('data:image/png;base64,abc');
    tauriMocks.readImageOverlay
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('{"version":1,"baseWidth":640,"baseHeight":480,"items":[{"id":"remote","type":"text","x":0,"y":0,"width":0.2,"height":0.1,"text":"Remote","color":"#fff","fontSize":18}],"updatedAt":2}');

    const { result } = renderImageHarness();
    await waitFor(() => expect(result.current.overlayLoaded).toBe(true));
    act(() => {
      result.current.setOverlayDoc((current) => current
        ? {
            ...current,
            items: [{ id: 'local', type: 'text', x: 0, y: 0, width: 0.2, height: 0.1, text: 'Local', color: '#fff', fontSize: 18 }],
            updatedAt: 3,
          }
        : current);
    });
    await waitFor(() => expect(result.current.session.overlayStatus).toBe('dirty'));

    await act(async () => {
      await modifiedHandler?.({ payload: { path: 'Pictures/demo.png' } });
    });

    await waitFor(() => expect(result.current.session.overlayStatus).toBe('remote-pending'));
    expect(result.current.overlayDoc?.items[0]?.id).toBe('local');
  });
});

function renderImageHarness() {
  return renderHook(() => {
    const stableOptionsRef = useRef<ImageSessionOptions | null>(null);
    if (!stableOptionsRef.current) stableOptionsRef.current = createSessionOptions();
    const [src, setSrc] = useState<string | null>(null);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overlayDoc, setOverlayDoc] = useState<ImageOverlayDocument | null>(null);
    const [overlayLoaded, setOverlayLoaded] = useState(false);
    const [persistedOverlaySignature, setPersistedOverlaySignature] = useState('');
    const options: ImageSessionOptions = {
      ...stableOptionsRef.current,
      overlayDoc,
      overlayLoaded,
      persistedOverlaySignature,
      setSrc,
      setImage,
      setDimensions,
      setLoading,
      setError,
      setOverlayDoc,
      setOverlayLoaded,
      setPersistedOverlaySignature,
    };
    const session = useImageDocumentSession(options);
    return { src, image, dimensions, loading, error, overlayDoc, overlayLoaded, setOverlayDoc, session };
  });
}
