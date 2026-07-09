import { ChevronRight, FolderOpen, Home, Info, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Banner, EmptyState, GlyphIcon, ReadOnlyBadge, Spinner } from '../components/ui';
import { childrenOf, fileGlyph, formatBytes, formatRelativeTime, isReadOnlyRole } from '../lib/format';
import type { HostedFileEntry } from '../mobileTauri';
import { useMobileStore } from '../state/store';

interface Crumb {
  id: string | null;
  name: string;
}

export function FilesScreen() {
  const selected = useMobileStore((s) => s.selected);
  const files = useMobileStore((s) => s.files);
  const filesBusy = useMobileStore((s) => s.filesBusy);
  const filesError = useMobileStore((s) => s.filesError);
  const loadFiles = useMobileStore((s) => s.loadFiles);

  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: 'Root' }]);
  const [detail, setDetail] = useState<HostedFileEntry | null>(null);

  // Reset navigation when the active vault changes.
  useEffect(() => {
    setTrail([{ id: null, name: 'Root' }]);
    setDetail(null);
  }, [selected?.vault.id, selected?.serverUrl]);

  const currentParent = trail[trail.length - 1]?.id ?? null;
  const entries = useMemo(() => childrenOf(files, currentParent), [files, currentParent]);
  const readOnly = selected ? isReadOnlyRole(selected.vault.role) : false;

  if (!selected) {
    return (
      <div className="screen">
        <header className="screen-header">
          <div>
            <h1>Files</h1>
            <p>No vault selected</p>
          </div>
        </header>
        <EmptyState
          icon={<FolderOpen size={28} aria-hidden />}
          title="No vault open"
          message="Pick a vault on the Vaults tab to browse its files."
        />
      </div>
    );
  }

  function openFolder(entry: HostedFileEntry) {
    setTrail((prev) => [...prev, { id: entry.id, name: entry.name }]);
  }

  function jumpTo(index: number) {
    setTrail((prev) => prev.slice(0, index + 1));
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1 className="truncate">{selected.vault.name}</h1>
          <p>{readOnly ? 'Read-only vault' : 'Browsing files'}</p>
        </div>
        <div className="header-side">
          {readOnly ? <ReadOnlyBadge /> : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh"
            onClick={() => loadFiles()}
            disabled={filesBusy}
          >
            {filesBusy ? <Spinner size={16} /> : <RefreshCw size={16} aria-hidden />}
          </button>
        </div>
      </header>

      <nav className="breadcrumbs" aria-label="Folder path">
        {trail.map((crumb, index) => (
          <span className="crumb-wrap" key={`${crumb.id ?? 'root'}-${index}`}>
            {index > 0 ? <ChevronRight size={14} aria-hidden className="crumb-sep" /> : null}
            <button
              type="button"
              className="crumb"
              disabled={index === trail.length - 1}
              onClick={() => jumpTo(index)}
            >
              {index === 0 ? <Home size={14} aria-hidden /> : null}
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {filesError ? <Banner tone="error">{filesError}</Banner> : null}

      {filesBusy && files.length === 0 ? (
        <div className="loading-block">
          <Spinner size={22} />
          <span>Loading files…</span>
        </div>
      ) : null}

      {!filesBusy && entries.length === 0 && !filesError ? (
        <EmptyState
          icon={<FolderOpen size={28} aria-hidden />}
          title="Empty folder"
          message="There are no files here."
        />
      ) : null}

      <ul className="list">
        {entries.map((entry) => {
          const glyph = fileGlyph(entry);
          const isFolder = entry.kind === 'folder';
          return (
            <li className="list-row" key={entry.id}>
              <button
                type="button"
                className="row-main file-row"
                onClick={() => (isFolder ? openFolder(entry) : setDetail(entry))}
              >
                <div className={`file-icon glyph-${glyph}`}>
                  <GlyphIcon glyph={glyph} />
                </div>
                <div className="row-text">
                  <strong className="truncate">{entry.name}</strong>
                  <span>
                    {isFolder
                      ? 'Folder'
                      : [
                          entry.documentType ?? glyph,
                          formatBytes(entry.sizeBytes),
                          formatRelativeTime(entry.updatedAt),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </div>
                <ChevronRight size={18} aria-hidden className="row-chevron" />
              </button>
            </li>
          );
        })}
      </ul>

      {detail ? <FileDetailSheet entry={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function FileDetailSheet({ entry, onClose }: { entry: HostedFileEntry; onClose: () => void }) {
  const glyph = fileGlyph(entry);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={entry.name} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className={`file-icon glyph-${glyph}`}>
            <GlyphIcon glyph={glyph} size={22} />
          </div>
          <div className="row-text">
            <strong className="truncate">{entry.name}</strong>
            <span>{entry.documentType ?? entry.kind}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <dl className="detail-grid">
          <dt>Path</dt>
          <dd className="mono">{entry.relativePath || entry.name}</dd>
          <dt>Type</dt>
          <dd>{entry.documentType ?? entry.kind}</dd>
          <dt>Size</dt>
          <dd>{formatBytes(entry.sizeBytes)}</dd>
          <dt>Updated</dt>
          <dd>{formatRelativeTime(entry.updatedAt) || '—'}</dd>
        </dl>
        <div className="sheet-note">
          <Info size={15} aria-hidden />
          <span>Opening and editing this file arrives in a later update.</span>
        </div>
      </div>
    </div>
  );
}
