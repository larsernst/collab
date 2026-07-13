import { CloudOff, ChevronRight, FolderOpen, Home, Info, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Banner, CacheBadge, EmptyState, GlyphIcon, ReadOnlyBadge, Spinner } from '../components/ui';
import {
  fileGlyph,
  formatBytes,
  formatRelativeTime,
  isReadOnlyRole,
} from '../lib/format';
import { isKanbanFile } from '../lib/kanban';
import { isNoteFile } from '../lib/notes';
import type { FileCacheState } from '../lib/replica';
import type { ThemePrefs } from '../lib/theme';
import type { HostedFileEntry } from '../mobileTauri';
import { KanbanScreen } from './KanbanScreen';
import { NoteScreen } from './NoteScreen';
import { useMobileStore } from '../state/store';

const PAGE_SIZE = 60;
const FOLDER_SCAN_BUDGET_MS = 7;
const fileCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

function sortFolderEntries(entries: HostedFileEntry[]): HostedFileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'folder' && b.kind !== 'folder') return -1;
    if (a.kind !== 'folder' && b.kind === 'folder') return 1;
    return fileCollator.compare(a.name, b.name);
  });
}

export function FilesScreen({ prefs }: { prefs: ThemePrefs }) {
  const selected = useMobileStore((s) => s.selected);
  const files = useMobileStore((s) => s.files);
  const filesBusy = useMobileStore((s) => s.filesBusy);
  const filesError = useMobileStore((s) => s.filesError);
  const filesOffline = useMobileStore((s) => s.filesOffline);
  const fileCache = useMobileStore((s) => s.fileCache);
  const trail = useMobileStore((s) => s.folderTrail);
  const activeSheet = useMobileStore((s) => s.activeSheet);
  const loadFiles = useMobileStore((s) => s.loadFiles);
  const refreshCacheStatus = useMobileStore((s) => s.refreshCacheStatus);
  const enterFolder = useMobileStore((s) => s.enterFolder);
  const folderJumpTo = useMobileStore((s) => s.folderJumpTo);
  const openSheet = useMobileStore((s) => s.openSheet);
  const closeSheet = useMobileStore((s) => s.closeSheet);

  const currentParent = trail[trail.length - 1]?.id ?? null;
  const [entries, setEntries] = useState<HostedFileEntry[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const readOnly = selected ? isReadOnlyRole(selected.vault.role) : false;

  // Reveal the folder in pages so a large directory never renders (or cache-checks)
  // thousands of rows at once; more load as the user scrolls to the bottom.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset paging whenever the folder or vault changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [currentParent, selected?.vault.id, selected?.serverUrl]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const collected: HostedFileEntry[] = [];
    let cursor = 0;

    setFolderBusy(files.length > 0);
    setEntries([]);

    const scan = () => {
      const deadline = performance.now() + FOLDER_SCAN_BUDGET_MS;
      while (cursor < files.length && performance.now() < deadline) {
        const entry = files[cursor++];
        if (entry.parentId === currentParent) collected.push(entry);
      }
      if (cancelled) return;
      if (cursor < files.length) {
        timer = window.setTimeout(scan, 0);
        return;
      }
      setEntries(sortFolderEntries(collected));
      setFolderBusy(false);
    };

    timer = window.setTimeout(scan, 0);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [currentParent, files]);

  const visibleEntries = useMemo(() => entries.slice(0, visibleCount), [entries, visibleCount]);

  // Load more when the bottom sentinel scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visibleCount >= entries.length) return;
    const observer = new IntersectionObserver((observed) => {
      if (observed.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.min(count + PAGE_SIZE, entries.length));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, entries.length]);

  // Check cache status only for the currently revealed files (incremental).
  useEffect(() => {
    if (visibleEntries.length > 0) void refreshCacheStatus(visibleEntries);
  }, [visibleEntries, refreshCacheStatus]);

  const activeFile = useMemo(() => {
    if (!activeSheet || activeSheet.kind === 'removeOffline') return null;
    return files.find((file) => file.id === activeSheet.fileId) ?? null;
  }, [activeSheet, files]);
  const detailFile = activeSheet?.kind === 'fileDetail' ? activeFile : null;
  const noteFile = activeSheet?.kind === 'note' ? activeFile : null;
  const kanbanFile = activeSheet?.kind === 'kanban' ? activeFile : null;

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

  if (noteFile) {
    return <NoteScreen file={noteFile} prefs={prefs} />;
  }

  if (kanbanFile) {
    return <KanbanScreen file={kanbanFile} />;
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
              onClick={() => folderJumpTo(index)}
            >
              {index === 0 ? <Home size={14} aria-hidden /> : null}
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {filesOffline ? (
        <div className="offline-strip">
          <CloudOff size={14} aria-hidden />
          <span>Offline — showing the cached copy.</span>
        </div>
      ) : null}

      {filesError ? <Banner tone="error">{filesError}</Banner> : null}

      {(filesBusy && files.length === 0) || folderBusy ? (
        <div className="loading-block">
          <Spinner size={22} />
          <span>{folderBusy ? 'Loading folder...' : 'Loading files...'}</span>
        </div>
      ) : null}

      {!filesBusy && !folderBusy && entries.length === 0 && !filesError ? (
        <EmptyState
          icon={<FolderOpen size={28} aria-hidden />}
          title="Empty folder"
          message="There are no files here."
        />
      ) : null}

      {!folderBusy ? (
        <ul className="list">
          {visibleEntries.map((entry) => {
            const glyph = fileGlyph(entry);
            const isFolder = entry.kind === 'folder';
            return (
              <li className="list-row" key={entry.id}>
                <button
                  type="button"
                  className="row-main file-row"
                  onClick={() =>
                    isFolder
                      ? enterFolder({ id: entry.id, name: entry.name })
                      : isNoteFile(entry)
                        ? openSheet({ kind: 'note', fileId: entry.id })
                        : isKanbanFile(entry)
                          ? openSheet({ kind: 'kanban', fileId: entry.id })
                          : openSheet({ kind: 'fileDetail', fileId: entry.id })
                  }
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
                  {!isFolder && fileCache[entry.id] ? <CacheBadge state={fileCache[entry.id]} /> : null}
                  <ChevronRight size={18} aria-hidden className="row-chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {visibleCount < entries.length ? (
        <div ref={sentinelRef} className="load-more">
          <Spinner size={16} />
          <span>Loading more… ({visibleCount}/{entries.length})</span>
        </div>
      ) : null}

      {detailFile ? (
        <FileDetailSheet
          entry={detailFile}
          cacheState={fileCache[detailFile.id]}
          onClose={closeSheet}
        />
      ) : null}
    </div>
  );
}

function cacheLabel(state: FileCacheState | undefined): string {
  if (state === 'cached') return 'Available offline';
  if (state === 'stale') return 'Cached copy out of date';
  return 'Not cached';
}

function FileDetailSheet({
  entry,
  cacheState,
  onClose,
}: {
  entry: HostedFileEntry;
  cacheState: FileCacheState | undefined;
  onClose: () => void;
}) {
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
          <dt>Offline</dt>
          <dd>{cacheLabel(cacheState)}</dd>
        </dl>
        <div className="sheet-note">
          <Info size={15} aria-hidden />
          <span>Opening and editing this file arrives in a later update.</span>
        </div>
      </div>
    </div>
  );
}
