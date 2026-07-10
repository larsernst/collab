import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CloudOff,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';

import { Banner, ReadOnlyBadge, Spinner } from '../components/ui';
import { DateField } from '../components/DateField';
import { isReadOnlyRole } from '../lib/format';
import {
  addCardToColumn,
  addChecklistItem,
  addComment,
  addTag,
  checklistProgress,
  collectBoardTags,
  createCard,
  findCard,
  moveCardToColumn,
  parseBoardContent,
  readKanbanDocument,
  removeCard,
  removeChecklistItem,
  removeTag,
  saveKanbanDocument,
  serializeBoard,
  toggleCardDone,
  toggleChecklistItem,
  updateCard,
  viewCards,
  type CardSortField,
  type CommentAuthor,
  type KanbanBoard,
  type KanbanCard,
  type KanbanPriority,
} from '../lib/kanban';
import {
  openMobileLiveJsonSession,
  type JsonObject,
  type LiveStatus,
  type MobileLiveJsonSession,
} from '../lib/liveNote';
import {
  describePendingFailure,
  discardPendingOperation,
  enqueueDocumentEdit,
  isLikelyConnectivityError,
  pendingEditsForFile,
  retryPendingOperation,
} from '../lib/sync';
import { replicaCacheDocument, type HostedFileEntry, type PendingOperation } from '../mobileTauri';
import { useMobileStore } from '../state/store';
import { getCardDueStatus, type KanbanDueStatus } from '../../../../src/types/kanban';
import { userColorForId } from '../../../../src/lib/userColor';

const PRIORITIES: Array<{ value: KanbanPriority | 'none'; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

const PRIORITY_LABEL: Record<KanbanPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const DUE_LABEL: Record<KanbanDueStatus, string> = {
  overdue: 'Overdue',
  'due-today': 'Due today',
  upcoming: 'Upcoming',
  none: '',
};

const SORT_OPTIONS: Array<{ value: CardSortField; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Created' },
];

const SWIPE_THRESHOLD = 60;
const SAVE_DEBOUNCE_MS = 500;

function boardToJson(board: KanbanBoard): JsonObject {
  return JSON.parse(serializeBoard(board)) as JsonObject;
}

function boardFromJson(value: JsonObject): KanbanBoard {
  return parseBoardContent(JSON.stringify(value));
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function KanbanScreen({ file }: { file: HostedFileEntry }) {
  const selected = useMobileStore((s) => s.selected);
  const statuses = useMobileStore((s) => s.statuses);
  const closeSheet = useMobileStore((s) => s.closeSheet);
  const replaceFile = useMobileStore((s) => s.replaceFile);
  const syncServer = useMobileStore((s) => s.syncServer);

  const serverUrl = selected?.serverUrl ?? '';
  const vaultId = selected?.vault.id ?? '';
  const connected = selected ? !!statuses[serverUrl]?.connected : false;
  const readOnly = selected ? isReadOnlyRole(selected.vault.role) : true;
  const manifestSequence = selected?.vault.manifestSequence ?? 0;

  const [board, setBoard] = useState<KanbanBoard>({ columns: [] });
  const [currentFile, setCurrentFile] = useState(file);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [source, setSource] = useState<'network' | 'cache'>('network');
  const [savedContent, setSavedContent] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [liveSession, setLiveSession] = useState<MobileLiveJsonSession | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<CardSortField>('manual');
  const [filterQuery, setFilterQuery] = useState('');
  const [showTools, setShowTools] = useState(false);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const columnStripRef = useRef<HTMLElement | null>(null);

  // Refs that the debounced save reads so it always persists the freshest board
  // against the freshest file revision, independent of render timing.
  const boardRef = useRef(board);
  boardRef.current = board;
  const fileRef = useRef(currentFile);
  fileRef.current = currentFile;
  const savedContentRef = useRef('');
  const savingRef = useRef(false);
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);
  const liveSessionRef = useRef<MobileLiveJsonSession | null>(null);
  liveSessionRef.current = liveSession;
  const openCardIdRef = useRef<string | null>(null);
  openCardIdRef.current = openCardId;

  // Record the last-persisted serialization in both a ref (read synchronously by
  // the save loop) and state (so the dirty/status label re-renders on save).
  const markSaved = useCallback((content: string) => {
    savedContentRef.current = content;
    if (mountedRef.current) setSavedContent(content);
  }, []);

  const author = useMemo<CommentAuthor>(() => {
    const user = statuses[serverUrl]?.user;
    const id = user?.id ?? 'local';
    return {
      userId: id,
      userName: user?.displayName || user?.username || 'You',
      userColor: userColorForId(id),
    };
  }, [statuses, serverUrl]);

  const liveActive = !!liveSession;
  const dirty = useMemo(() => !liveActive && serializeBoard(board) !== savedContent, [board, liveActive, savedContent]);
  const pendingFailed = pending?.status === 'failed';
  const statusLabel = pendingFailed
    ? 'Sync failed'
    : pending
      ? 'Queued to sync'
      : liveActive
        ? liveStatus === 'connected'
          ? 'Live'
          : 'Live offline'
      : saving
        ? 'Saving…'
        : source === 'cache'
          ? 'Cached board'
          : dirty
            ? 'Unsaved changes'
            : 'Saved';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the active column chip in view in the horizontally scrolling top strip
  // as the user swipes/paginates between columns.
  useEffect(() => {
    const active = columnStripRef.current?.querySelector<HTMLElement>('.kanban-column-chip.active');
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedColumnId, busy]);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selected) return;
      if (liveSessionRef.current) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const loaded = await readKanbanDocument(serverUrl, vaultId, file, connected);
        if (cancelled) return;
        if (liveSessionRef.current) return;
        setCurrentFile(loaded.file);
        setBoard(loaded.board);
        markSaved(serializeBoard(loaded.board));
        setSource(loaded.source);
        setSelectedColumnId((prev) => prev ?? loaded.board.columns[0]?.id ?? null);
        const queued = await pendingEditsForFile(serverUrl, vaultId, file.id).catch(
          () => [] as PendingOperation[],
        );
        if (!cancelled) setPending(queued[0] ?? null);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, file, selected]);

  useEffect(() => {
    let cancelled = false;
    let opened: MobileLiveJsonSession | null = null;
    let offStatus: (() => void) | undefined;
    let offChange: (() => void) | undefined;

    setLiveSession(null);
    setLiveStatus(null);

    if (!selected || readOnly || !connectedRef.current) {
      return () => {
        cancelled = true;
      };
    }

    const applyLiveBoard = (next: KanbanBoard, nextSource: 'network' | 'cache') => {
      const content = serializeBoard(next);
      setBoard(next);
      boardRef.current = next;
      markSaved(content);
      setSource(nextSource);
      setError(null);
      setSelectedColumnId((prev) => {
        if (prev && next.columns.some((column) => column.id === prev)) return prev;
        return next.columns[0]?.id ?? null;
      });
      if (openCardIdRef.current && !findCard(next, openCardIdRef.current)) setOpenCardId(null);
      void replicaCacheDocument(serverUrl, vaultId, file.id, content).catch(() => {});
    };

    openMobileLiveJsonSession(serverUrl, vaultId, file.id, 'kanban')
      .then((session) => {
        if (cancelled || !session) {
          session?.destroy();
          return;
        }
        opened = session;
        setLiveSession(session);
        setLiveStatus(session.getStatus());
        offStatus = session.onStatus((status) => {
          if (!cancelled) setLiveStatus(status);
        });

        const initialJson = session.readJson();
        if (Object.keys(initialJson).length > 0) applyLiveBoard(boardFromJson(initialJson), 'network');
        offChange = session.onChange((json) => {
          if (!cancelled) applyLiveBoard(boardFromJson(json), session.getStatus() === 'connected' ? 'network' : 'cache');
        });
      })
      .catch(() => {
        // Best effort. The REST/offline queue path remains active if live cannot open.
      });

    return () => {
      cancelled = true;
      offChange?.();
      offStatus?.();
      opened?.destroy();
      setLiveSession(null);
      setLiveStatus(null);
    };
  }, [file.id, markSaved, readOnly, selected?.serverUrl, selected?.vault.id, serverUrl, vaultId]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const queueOffline = useCallback(
    async (content: string) => {
      const operation = await enqueueDocumentEdit(
        serverUrl,
        vaultId,
        fileRef.current,
        content,
        manifestSequence,
      );
      markSaved(content);
      if (!mountedRef.current) return;
      setSource('cache');
      setPending(operation);
      setMessage('Saved offline. This board will sync when you reconnect.');
    },
    [serverUrl, vaultId, manifestSequence, markSaved],
  );

  const flushSave = useCallback(async () => {
    if (savingRef.current || readOnly || liveSessionRef.current) return;
    const content = serializeBoard(boardRef.current);
    if (content === savedContentRef.current) return;
    savingRef.current = true;
    if (mountedRef.current) setSaving(true);
    try {
      if (connectedRef.current) {
        try {
          const document = await saveKanbanDocument(serverUrl, vaultId, fileRef.current, boardRef.current);
          fileRef.current = document.file;
          markSaved(content);
          if (mountedRef.current) {
            setCurrentFile(document.file);
            setSource('network');
            setPending(null);
          }
          replaceFile(document.file);
        } catch (reason) {
          if (!isLikelyConnectivityError(reason)) throw reason;
          await queueOffline(content);
        }
      } else {
        await queueOffline(content);
      }
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
    // A change landed mid-save: persist the newest board too.
    if (serializeBoard(boardRef.current) !== savedContentRef.current) {
      void flushSave();
    }
  }, [readOnly, serverUrl, vaultId, queueOffline, replaceFile, markSaved]);

  const scheduleSave = useCallback(() => {
    if (liveSessionRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Flush any pending debounced save when the board screen unmounts.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (serializeBoard(boardRef.current) !== savedContentRef.current) void flushSave();
    };
  }, [flushSave]);

  /** Apply a board mutation and schedule a debounced save. */
  const commitBoard = useCallback(
    (next: KanbanBoard) => {
      if (readOnly) return;
      setBoard(next);
      boardRef.current = next;
      setError(null);
      setMessage(null);
      const live = liveSessionRef.current;
      if (live) {
        const content = serializeBoard(next);
        live.writeJson(boardToJson(next));
        markSaved(content);
        setSource(live.getStatus() === 'connected' ? 'network' : 'cache');
        void replicaCacheDocument(serverUrl, vaultId, fileRef.current.id, content).catch(() => {});
        return;
      }
      scheduleSave();
    },
    [markSaved, readOnly, scheduleSave, serverUrl, vaultId],
  );

  // ── Recovery ────────────────────────────────────────────────────────────────
  const reloadBoard = useCallback(async () => {
    const loaded = await readKanbanDocument(serverUrl, vaultId, fileRef.current, connectedRef.current);
    if (!mountedRef.current) return;
    setCurrentFile(loaded.file);
    fileRef.current = loaded.file;
    setBoard(loaded.board);
    boardRef.current = loaded.board;
    markSaved(serializeBoard(loaded.board));
    setSource(loaded.source);
  }, [serverUrl, vaultId, markSaved]);

  async function retrySync() {
    if (!pending || recovering) return;
    setRecovering(true);
    setError(null);
    setMessage(null);
    try {
      await retryPendingOperation(serverUrl, vaultId, pending.id);
      await syncServer(serverUrl);
      const queued = await pendingEditsForFile(serverUrl, vaultId, fileRef.current.id);
      setPending(queued[0] ?? null);
      if (queued.length === 0) {
        await reloadBoard();
        setMessage('Synced.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRecovering(false);
    }
  }

  async function discardQueued() {
    if (!pending || recovering) return;
    setRecovering(true);
    setError(null);
    setMessage(null);
    try {
      await discardPendingOperation(serverUrl, vaultId, pending.id);
      setPending(null);
      await reloadBoard();
      setMessage('Discarded the queued change.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRecovering(false);
    }
  }

  if (!selected) return null;

  const columns = board.columns;
  const activeIndex = Math.max(
    0,
    columns.findIndex((column) => column.id === selectedColumnId),
  );
  const activeColumn = columns[activeIndex] ?? columns[0] ?? null;
  const activeColumnId = activeColumn?.id ?? null;
  const openCard = openCardId ? findCard(board, openCardId)?.card ?? null : null;

  // All distinct tags used anywhere on the board, for tag suggestions.
  const boardTags = useMemo(() => collectBoardTags(board), [board]);

  function goToColumn(index: number) {
    const clamped = Math.max(0, Math.min(columns.length - 1, index));
    const target = columns[clamped];
    if (!target || target.id === activeColumnId) return;
    setSlideDir(clamped > activeIndex ? 1 : -1);
    setSelectedColumnId(target.id);
  }

  function handleTouchStart(event: ReactTouchEvent) {
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: ReactTouchEvent) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || columns.length < 2) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Horizontal, deliberate swipe only (ignore vertical scrolls).
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goToColumn(activeIndex + (dx < 0 ? 1 : -1));
  }

  function handleAddCard() {
    if (!activeColumnId || readOnly) return;
    const card = createCard('');
    commitBoard(addCardToColumn(board, activeColumnId, card));
    setOpenCardId(card.id);
  }

  return (
    <div className="screen kanban-screen">
      <header className="note-header">
        <button type="button" className="icon-button" aria-label="Back" onClick={closeSheet}>
          <ArrowLeft size={18} aria-hidden />
        </button>
        <div className="note-title">
          <h1 className="truncate">{currentFile.name}</h1>
          <p>{statusLabel}</p>
        </div>
        <div className="header-side">
          {readOnly ? <ReadOnlyBadge /> : null}
          {saving ? <Spinner size={16} /> : null}
          {!busy && columns.length > 0 ? (
            <button
              type="button"
              className={`icon-button ${showTools || sortField !== 'manual' || filterQuery ? 'active' : ''}`}
              aria-label="Filter and sort"
              aria-pressed={showTools}
              onClick={() => setShowTools((value) => !value)}
            >
              <SlidersHorizontal size={17} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="info">{message}</Banner> : null}

      {pendingFailed ? (
        <div className="banner banner-error sync-recovery">
          <div className="sync-recovery-text">
            <strong>Couldn’t sync this board</strong>
            <span>{describePendingFailure(pending!)}</span>
          </div>
          <div className="sync-recovery-actions">
            <button type="button" className="text-button" onClick={() => void retrySync()} disabled={recovering || !connected}>
              {recovering ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden />}
              Retry
            </button>
            <button type="button" className="text-button destructive" onClick={() => void discardQueued()} disabled={recovering}>
              <Trash2 size={14} aria-hidden />
              Discard
            </button>
          </div>
        </div>
      ) : pending ? (
        <div className="banner banner-info sync-recovery">
          <div className="sync-recovery-text">
            <span className="sync-recovery-badge">
              <CloudOff size={14} aria-hidden />
              Queued offline
            </span>
            <span>
              {connected
                ? 'Syncing this change to the server…'
                : 'This change will sync automatically when you reconnect.'}
            </span>
          </div>
          <div className="sync-recovery-actions">
            {connected ? (
              <button type="button" className="text-button" onClick={() => void retrySync()} disabled={recovering}>
                {recovering ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden />}
                Sync now
              </button>
            ) : null}
            <button type="button" className="text-button destructive" onClick={() => void discardQueued()} disabled={recovering}>
              <Trash2 size={14} aria-hidden />
              Discard
            </button>
          </div>
        </div>
      ) : source === 'cache' ? (
        <Banner tone="info">Showing cached content. Changes you make will sync when you reconnect.</Banner>
      ) : null}

      {busy ? (
        <div className="loading-block">
          <Spinner size={22} />
          <span>Loading board…</span>
        </div>
      ) : columns.length === 0 ? (
        <div className="kanban-empty">
          <span>This board has no columns yet. Open it on the desktop app to set it up.</span>
        </div>
      ) : (
        <>
          <nav className="kanban-columns" aria-label="Columns" ref={columnStripRef}>
            {columns.map((column) => {
              const count = column.cards.filter((card) => !card.archived).length;
              const isActive = column.id === activeColumnId;
              return (
                <button
                  key={column.id}
                  type="button"
                  className={`kanban-column-chip ${isActive ? 'active' : ''}`}
                  style={
                    column.color
                      ? ({ '--column-color': column.color } as CSSProperties)
                      : undefined
                  }
                  onClick={() => setSelectedColumnId(column.id)}
                >
                  {column.color ? (
                    <span className="kanban-column-dot" style={{ background: column.color }} aria-hidden />
                  ) : null}
                  <span className="truncate">{column.title}</span>
                  <span className="kanban-column-count">{count}</span>
                </button>
              );
            })}
          </nav>

          {showTools ? (
            <div className="kanban-tools">
              <div className="kanban-tool-search">
                <Search size={15} aria-hidden />
                <input
                  type="text"
                  placeholder="Filter cards"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
                {filterQuery ? (
                  <button type="button" aria-label="Clear filter" onClick={() => setFilterQuery('')}>
                    <X size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="kanban-tool-sort" role="group" aria-label="Sort cards">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={sortField === option.value ? 'selected' : ''}
                    onClick={() => setSortField(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!readOnly ? (
            <button type="button" className="kanban-add-card" onClick={handleAddCard} disabled={!activeColumnId}>
              <Plus size={16} aria-hidden />
              Add card to {activeColumn?.title ?? 'column'}
            </button>
          ) : null}

          <div className="kanban-scroll" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            <div className="kanban-pager">
            {/* Only the active column is rendered so the pane height always
                matches the current column (no dead scroll on short columns). The
                key remounts the pane on column change, replaying the slide. */}
            <div
              key={activeColumnId ?? 'none'}
              className={`kanban-pane ${slideDir === 1 ? 'from-right' : 'from-left'}`}
            >
              {(() => {
                const paneCards = viewCards(
                  (activeColumn?.cards ?? []).filter((card) => !card.archived),
                  filterQuery,
                  sortField,
                );
                if (paneCards.length === 0) {
                  return (
                    <div className="kanban-empty">
                      <span>{filterQuery ? 'No cards match your filter.' : 'No cards in this column.'}</span>
                    </div>
                  );
                }
                return (
                  <ul className="list kanban-card-list">
                    {paneCards.map((card) => (
                      <li className="list-row" key={card.id}>
                        <button
                          type="button"
                          className="row-main kanban-card-row"
                          onClick={() => setOpenCardId(card.id)}
                        >
                          <div className="kanban-card-main">
                            <div className="kanban-card-title-row">
                              <strong className={card.isDone ? 'kanban-card-done' : ''}>{card.title}</strong>
                            </div>
                            <CardMeta card={card} />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
            </div>
          </div>

          {columns.length > 1 ? (
            <div className="kanban-column-dots" role="tablist" aria-label="Column">
              {columns.map((column, index) => (
                <button
                  key={column.id}
                  type="button"
                  role="tab"
                  aria-selected={index === activeIndex}
                  aria-label={column.title}
                  className={`kanban-dot ${index === activeIndex ? 'active' : ''}`}
                  style={column.color ? ({ '--column-color': column.color } as CSSProperties) : undefined}
                  onClick={() => goToColumn(index)}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      {openCard ? (
        <CardDetailSheet
          card={openCard}
          board={board}
          columnId={findCard(board, openCard.id)?.columnId ?? activeColumnId ?? ''}
          readOnly={readOnly}
          author={author}
          boardTags={boardTags}
          onClose={() => setOpenCardId(null)}
          onChange={commitBoard}
          onDelete={() => {
            commitBoard(removeCard(board, openCard.id));
            setOpenCardId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CardMeta({ card }: { card: KanbanCard }) {
  const due = getCardDueStatus(card);
  const checklist = checklistProgress(card);
  const bits: Array<{ key: string; node: ReactNode }> = [];
  if (card.isDone) bits.push({ key: 'done', node: <span className="kanban-chip done">Done</span> });
  if (card.priority) {
    bits.push({
      key: 'priority',
      node: (
        <span className={`kanban-chip priority-${card.priority}`}>
          <span className={`kanban-priority-dot ${card.priority}`} aria-hidden />
          {PRIORITY_LABEL[card.priority]}
        </span>
      ),
    });
  }
  if (due !== 'none') {
    bits.push({ key: 'due', node: <span className={`kanban-chip due-${due}`}>{DUE_LABEL[due]}</span> });
  }
  if (checklist.total > 0) {
    bits.push({
      key: 'checklist',
      node: (
        <span className="kanban-chip">
          {checklist.done}/{checklist.total}
        </span>
      ),
    });
  }
  if (card.comments.length > 0) {
    bits.push({
      key: 'comments',
      node: (
        <span className="kanban-chip">
          <MessageSquare size={11} aria-hidden /> {card.comments.length}
        </span>
      ),
    });
  }
  for (const tag of card.tags.slice(0, 3)) {
    bits.push({ key: `tag-${tag}`, node: <span className="kanban-tag">{tag}</span> });
  }
  if (bits.length === 0) return null;
  return <div className="kanban-card-meta">{bits.map((bit) => <span key={bit.key}>{bit.node}</span>)}</div>;
}

function CardDetailSheet({
  card,
  board,
  columnId,
  readOnly,
  author,
  boardTags,
  onClose,
  onChange,
  onDelete,
}: {
  card: KanbanCard;
  board: KanbanBoard;
  columnId: string;
  readOnly: boolean;
  author: CommentAuthor;
  boardTags: string[];
  onClose: () => void;
  onChange: (next: KanbanBoard) => void;
  onDelete: () => void;
}) {
  const [tagDraft, setTagDraft] = useState('');
  const [checklistDraft, setChecklistDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const checklist = checklistProgress(card);

  // Board-wide tags not already on this card, filtered by the current draft.
  const tagSuggestions = useMemo(() => {
    const draft = tagDraft.trim().toLowerCase();
    return boardTags
      .filter((tag) => !card.tags.includes(tag))
      .filter((tag) => !draft || tag.toLowerCase().includes(draft))
      .slice(0, 12);
  }, [boardTags, card.tags, tagDraft]);

  const set = (patch: (value: KanbanCard) => KanbanCard) => onChange(updateCard(board, card.id, patch));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet kanban-card-sheet" role="dialog" aria-label={card.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="row-text">
            <strong className="truncate">{card.title || 'Untitled card'}</strong>
            <span>Card details</span>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="kanban-card-form">
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={card.title}
              readOnly={readOnly}
              onChange={(e) => set((value) => ({ ...value, title: e.target.value }))}
            />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              className="kanban-textarea"
              value={card.description ?? ''}
              readOnly={readOnly}
              rows={3}
              onChange={(e) => set((value) => ({ ...value, description: e.target.value }))}
            />
          </label>

          {/* Move / column */}
          {board.columns.length > 1 ? (
            <div className="field">
              <span>Column</span>
              <div className="kanban-move-row">
                {board.columns.map((column) => (
                  <button
                    key={column.id}
                    type="button"
                    className={`kanban-move-chip ${column.id === columnId ? 'active' : ''}`}
                    style={
                      column.color ? ({ '--column-color': column.color } as CSSProperties) : undefined
                    }
                    disabled={readOnly}
                    onClick={() => onChange(moveCardToColumn(board, card.id, column.id))}
                  >
                    {column.color ? (
                      <span className="kanban-column-dot" style={{ background: column.color }} aria-hidden />
                    ) : null}
                    {column.title}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Priority */}
          <div className="field">
            <span>Priority</span>
            <div className="segmented-control kanban-priority-control">
              {PRIORITIES.map((option) => {
                const current = card.priority ?? 'none';
                const selected = current === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${selected ? 'selected' : ''} priority-${option.value}`}
                    disabled={readOnly}
                    onClick={() =>
                      set((value) => ({
                        ...value,
                        priority: option.value === 'none' ? undefined : option.value,
                      }))
                    }
                  >
                    {option.value !== 'none' ? (
                      <span className={`kanban-priority-dot ${option.value}`} aria-hidden />
                    ) : null}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dates */}
          <div className="kanban-form-row">
            <div className="field">
              <span>Start date</span>
              <DateField
                value={card.startDate}
                max={card.dueDate || undefined}
                readOnly={readOnly}
                placeholder="No start date"
                onChange={(next) => set((value) => ({ ...value, startDate: next }))}
              />
            </div>
            <div className="field">
              <span>Due date</span>
              <DateField
                value={card.dueDate}
                min={card.startDate || undefined}
                readOnly={readOnly}
                placeholder="No due date"
                onChange={(next) => set((value) => ({ ...value, dueDate: next }))}
              />
            </div>
          </div>

          <button
            type="button"
            className={`kanban-done-toggle ${card.isDone ? 'done' : ''}`}
            disabled={readOnly}
            onClick={() => onChange(toggleCardDone(board, card.id, !card.isDone))}
          >
            {card.isDone ? <CheckCircle2 size={18} aria-hidden /> : <Circle size={18} aria-hidden />}
            {card.isDone ? 'Marked done' : 'Mark done'}
          </button>

          {/* Tags */}
          <div className="field">
            <span>Tags</span>
            <div className="kanban-tag-row">
              {card.tags.map((tag) => (
                <span className="kanban-tag editable" key={tag}>
                  {tag}
                  {!readOnly ? (
                    <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(removeTag(board, card.id, tag))}>
                      <X size={11} aria-hidden />
                    </button>
                  ) : null}
                </span>
              ))}
              {card.tags.length === 0 ? <span className="kanban-muted">No tags</span> : null}
            </div>
            {!readOnly ? (
              <>
                <form
                  className="kanban-inline-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onChange(addTag(board, card.id, tagDraft));
                    setTagDraft('');
                  }}
                >
                  <input
                    type="text"
                    placeholder="Add a tag"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                  />
                  <button type="submit" className="icon-button" aria-label="Add tag" disabled={!tagDraft.trim()}>
                    <Plus size={16} aria-hidden />
                  </button>
                </form>
                {tagSuggestions.length > 0 ? (
                  <div className="kanban-tag-suggestions">
                    <span className="kanban-muted">Existing</span>
                    {tagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="kanban-tag suggestion"
                        onClick={() => {
                          onChange(addTag(board, card.id, tag));
                          setTagDraft('');
                        }}
                      >
                        <Plus size={11} aria-hidden />
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {/* Checklist */}
          <div className="field">
            <span>
              Checklist {checklist.total > 0 ? `(${checklist.done}/${checklist.total})` : ''}
            </span>
            <ul className="kanban-checklist">
              {card.checklist.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={readOnly}
                      onChange={(e) => onChange(toggleChecklistItem(board, card.id, item.id, e.target.checked))}
                    />
                    <span className={item.checked ? 'checked' : ''}>{item.text}</span>
                  </label>
                  {!readOnly ? (
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => onChange(removeChecklistItem(board, card.id, item.id))}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {!readOnly ? (
              <form
                className="kanban-inline-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  onChange(addChecklistItem(board, card.id, checklistDraft));
                  setChecklistDraft('');
                }}
              >
                <input
                  type="text"
                  placeholder="Add an item"
                  value={checklistDraft}
                  onChange={(e) => setChecklistDraft(e.target.value)}
                />
                <button type="submit" className="icon-button" aria-label="Add item" disabled={!checklistDraft.trim()}>
                  <Plus size={16} aria-hidden />
                </button>
              </form>
            ) : null}
          </div>

          {/* Comments */}
          <div className="field">
            <span>Comments</span>
            <ul className="kanban-comments">
              {card.comments.map((comment) => (
                <li key={comment.id}>
                  <div className="kanban-comment-head">
                    <span className="kanban-comment-author" style={{ color: comment.userColor }}>
                      {comment.userName}
                    </span>
                    <span className="kanban-comment-time">{formatTime(comment.timestamp)}</span>
                  </div>
                  <p>{comment.content}</p>
                </li>
              ))}
              {card.comments.length === 0 ? <span className="kanban-muted">No comments yet</span> : null}
            </ul>
            {!readOnly ? (
              <form
                className="kanban-inline-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  onChange(addComment(board, card.id, commentDraft, author));
                  setCommentDraft('');
                }}
              >
                <input
                  type="text"
                  placeholder="Add a comment"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                />
                <button type="submit" className="icon-button" aria-label="Add comment" disabled={!commentDraft.trim()}>
                  <Plus size={16} aria-hidden />
                </button>
              </form>
            ) : null}
          </div>

          {!readOnly ? (
            <button type="button" className="kanban-delete" onClick={onDelete}>
              <Trash2 size={15} aria-hidden />
              Delete card
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
