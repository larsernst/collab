import { describe, expect, it } from 'vitest';

import type { PdfHighlight } from '../types/pdf';
import type { NoteFile } from '../types/vault';

import { expandPdfHighlightRects, flattenPdfFiles } from './pdfViewUtils';

describe('pdfViewUtils', () => {
  it('flattens nested file trees without flatMap', () => {
    const files: NoteFile[] = [
      {
        relativePath: 'Docs',
        name: 'Docs',
        extension: '',
        modifiedAt: 0,
        size: 0,
        isFolder: true,
        children: [
          {
            relativePath: 'Docs/example.pdf',
            name: 'example.pdf',
            extension: 'pdf',
            modifiedAt: 0,
            size: 0,
            isFolder: false,
          },
        ],
      },
      {
        relativePath: 'Loose.txt',
        name: 'Loose.txt',
        extension: 'txt',
        modifiedAt: 0,
        size: 0,
        isFolder: false,
      },
    ];

    expect(flattenPdfFiles(files).map((file) => file.relativePath)).toEqual([
      'Docs',
      'Docs/example.pdf',
      'Loose.txt',
    ]);
  });

  it('expands highlight rects without flatMap', () => {
    const highlights: PdfHighlight[] = [
      {
        id: 'highlight-1',
        page: 2,
        text: 'Hello',
        createdAt: 1,
        updatedAt: 1,
        rects: [
          { left: 0.1, top: 0.2, width: 0.3, height: 0.04 },
          { left: 0.2, top: 0.3, width: 0.25, height: 0.04 },
        ],
        note: '',
        color: '#facc15',
      },
    ];

    expect(expandPdfHighlightRects(highlights)).toEqual([
      {
        highlight: highlights[0],
        rect: highlights[0].rects[0],
        index: 0,
      },
      {
        highlight: highlights[0],
        rect: highlights[0].rects[1],
        index: 1,
      },
    ]);
  });
});
