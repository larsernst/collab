import { describe, expect, it } from 'vitest';

import { resolveNoteAssetTarget } from './noteAssets';
import type { NoteFile } from '../types/vault';

const FILES: NoteFile[] = [
  {
    relativePath: 'Pictures',
    name: 'Pictures',
    extension: '',
    modifiedAt: 0,
    size: 0,
    isFolder: true,
    children: [
      {
        relativePath: 'Pictures/Transformierte Struktur.png',
        name: 'Transformierte Struktur.png',
        extension: 'png',
        modifiedAt: 0,
        size: 0,
        isFolder: false,
      },
    ],
  },
];

describe('resolveNoteAssetTarget', () => {
  it('prefers an exact vault file match for wrapped image paths with spaces', () => {
    expect(resolveNoteAssetTarget('<Pictures/Transformierte Struktur.png>', 'Notes/demo.md', FILES)).toEqual({
      kind: 'vault',
      value: 'Pictures/Transformierte Struktur.png',
    });
  });

  it('resolves nested relative image paths against the current note directory', () => {
    expect(resolveNoteAssetTarget('../Pictures/example.png', 'Notes/Sub/demo.md')).toEqual({
      kind: 'vault',
      value: 'Notes/Pictures/example.png',
    });
  });
});
