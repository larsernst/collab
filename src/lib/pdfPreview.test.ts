import { describe, expect, it, vi } from 'vitest';

import { loadPdfPreviewDataUrl } from './pdfPreview';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

describe('loadPdfPreviewDataUrl', () => {
  it('returns a valid cached preview without re-reading or rerendering the source pdf', async () => {
    const readCachedDocumentPreviewDataUrl = vi.fn(async () => 'data:image/png;base64,cached');
    const readNoteAssetDataUrl = vi.fn(async () => 'data:application/pdf;base64,source');
    const writeCachedDocumentPreviewDataUrl = vi.fn(async () => {});
    const renderPdfPreviewFromDataUrl = vi.fn(async () => 'data:image/png;base64,rendered');

    const result = await loadPdfPreviewDataUrl('/vault', 'Docs/spec.pdf', {
      readCachedDocumentPreviewDataUrl,
      readNoteAssetDataUrl,
      writeCachedDocumentPreviewDataUrl,
      renderPdfPreviewFromDataUrl,
    });

    expect(result).toBe('data:image/png;base64,cached');
    expect(readNoteAssetDataUrl).not.toHaveBeenCalled();
    expect(renderPdfPreviewFromDataUrl).not.toHaveBeenCalled();
    expect(writeCachedDocumentPreviewDataUrl).not.toHaveBeenCalled();
  });

  it('renders and stores a preview when the vault cache misses', async () => {
    const readCachedDocumentPreviewDataUrl = vi.fn(async () => null);
    const readNoteAssetDataUrl = vi.fn(async () => 'data:application/pdf;base64,source');
    const writeCachedDocumentPreviewDataUrl = vi.fn(async () => {});
    const renderPdfPreviewFromDataUrl = vi.fn(async () => 'data:image/png;base64,rendered');

    const result = await loadPdfPreviewDataUrl('/vault', 'Docs/spec.pdf', {
      readCachedDocumentPreviewDataUrl,
      readNoteAssetDataUrl,
      writeCachedDocumentPreviewDataUrl,
      renderPdfPreviewFromDataUrl,
    });

    expect(result).toBe('data:image/png;base64,rendered');
    expect(readNoteAssetDataUrl).toHaveBeenCalledWith('/vault', 'Docs/spec.pdf');
    expect(renderPdfPreviewFromDataUrl).toHaveBeenCalledWith('data:application/pdf;base64,source');
    expect(writeCachedDocumentPreviewDataUrl).toHaveBeenCalledWith(
      '/vault',
      'Docs/spec.pdf',
      'data:image/png;base64,rendered',
    );
  });
});
