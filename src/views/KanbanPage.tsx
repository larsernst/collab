import { useEffect, useCallback, useMemo, useRef, useState, createContext, useContext } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LayoutDashboard } from 'lucide-react';
import { createVaultClient } from '../lib/vaultClient';
import { useVaultStore } from '../store/vaultStore';
import { useCollabStore } from '../store/collabStore';
import { useCollabIdentity } from '../lib/collabIdentity';
import { normalizeKanbanBoard, runKanbanAutomations, type KanbanBoard } from '../types/kanban';
import { isVaultReadOnly, vaultCan, type KnownUser } from '../types/vault';
import KanbanBoardView from '../components/kanban/KanbanBoard';
import { ReadOnlyBanner } from '../components/layout/ReadOnlyBanner';
import { useEditorStore } from '../store/editorStore';
import { useDocumentSessionState } from '../lib/documentSession';
import { openLiveJsonSession, type LiveJsonSession, type JsonObject } from '../lib/liveJsonDocument';
import { useCollabContext } from '../components/collaboration/CollabProvider';
import { buildKanbanCardEditors, useLivePeers, type LivePeer, type LiveAwarenessUser } from '../lib/liveAwareness';
import { useKanbanStore } from '../store/kanbanStore';

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * Per-action kanban capabilities for the open vault. Local vaults are always
 * fully capable; hosted vaults resolve each flag from the caller's effective
 * capabilities so controls that would be rejected by the server's semantic
 * kanban enforcement are never offered.
 */
export interface KanbanCapabilities {
  addCard: boolean;
  editContent: boolean;
  move: boolean;
  comment: boolean;
  archive: boolean;
  deleteCard: boolean;
  columnManage: boolean;
}

/** All capabilities granted — the default for local vaults and isolated tests. */
export const FULL_KANBAN_CAPABILITIES: KanbanCapabilities = {
  addCard: true,
  editContent: true,
  move: true,
  comment: true,
  archive: true,
  deleteCard: true,
  columnManage: true,
};

interface KanbanCtx {
  board: KanbanBoard;
  updateBoard: (updater: (b: KanbanBoard) => KanbanBoard) => void;
  knownUsers: KnownUser[];
  relativePath: string;
  /** Viewer access to a hosted vault: board mutations are disabled. */
  readOnly: boolean;
  /** Fine-grained capability gates for individual board actions. */
  caps: KanbanCapabilities;
  /**
   * Remote co-editors of this board from the live awareness relay (empty when
   * editing over REST). Drives the live co-editor strip.
   */
  livePeers: LivePeer[];
  /**
   * Map of card id -> remote peer currently editing that card, so cards can show
   * a "being edited by X" indicator. Empty when no live session is active.
   */
  remoteCardEditors: Map<string, LiveAwarenessUser>;
}

const KanbanContext = createContext<KanbanCtx | null>(null);

export function useKanbanContext(): KanbanCtx {
  const ctx = useContext(KanbanContext);
  if (!ctx) throw new Error('useKanbanContext must be used inside KanbanPage');
  return ctx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDefaultBoard(): KanbanBoard {
  return normalizeKanbanBoard({
    columns: [
      { id: crypto.randomUUID(), title: 'To Do',       cards: [] },
      { id: crypto.randomUUID(), title: 'In Progress', cards: [] },
      { id: crypto.randomUUID(), title: 'Done',        cards: [] },
    ],
  });
}

/** Plain-JSON snapshot of a board for the live CRDT structure. */
function boardToJson(board: KanbanBoard): JsonObject {
  return JSON.parse(JSON.stringify(normalizeKanbanBoard(board))) as JsonObject;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KanbanPage({ relativePath }: { relativePath: string | null }) {
  const { vault } = useVaultStore();
  const client = useMemo(() => (vault ? createVaultClient(vault) : null), [vault]);
  const readOnly = isVaultReadOnly(vault);
  // Per-action capability gates. A viewer (readOnly) holds none; local vaults
  // hold all. Hosted writes also require baseline file.write, which the viewer
  // role already reflects, so an editor-or-better resolves these from their
  // effective kanban capabilities.
  const caps = useMemo<KanbanCapabilities>(() => ({
    addCard: vaultCan(vault, 'kanban.card.create'),
    editContent: vaultCan(vault, 'kanban.card.editContent'),
    move: vaultCan(vault, 'kanban.card.move'),
    comment: vaultCan(vault, 'kanban.card.comment'),
    archive: vaultCan(vault, 'kanban.card.archive'),
    deleteCard: vaultCan(vault, 'kanban.card.delete'),
    columnManage: vaultCan(vault, 'kanban.column.manage'),
  }), [vault]);
  const { markDirty, markSaved, setSavedHash } = useEditorStore();
  const { peers, addConflict } = useCollabStore();
  // Snapshot authorship follows the effective identity (server-authoritative for hosted).
  const { userId: myUserId, userName: myUserName, userColor: myUserColor } = useCollabIdentity();
  const collabTransport = useCollabContext();
  const [board, setBoard]           = useState<KanbanBoard>({ columns: [] });
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  // Live co-editing session for hosted boards; null = REST optimistic-write path.
  const [liveSession, setLiveSession] = useState<LiveJsonSession | null>(null);
  // Mirrors the latest board so live edits and remote merges always derive from
  // the freshest state (including just-applied remote changes).
  const boardRef = useRef(board);
  boardRef.current = board;
  const isMountedRef    = useRef(true);
  const isDirtyRef      = useRef(false);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedBoardContentRef = useRef<string | null>(null);
  // Latest board pending a save, so a coalesced trailing save writes current state.
  const latestBoardRef = useRef<KanbanBoard | null>(null);
  const { hashRef, lastWriteRef, markLoaded, markWriteStarted, shouldCreateSnapshot, runExclusiveSave } = useDocumentSessionState();

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const saveBoard = useCallback(async (newBoard: KanbanBoard) => {
    if (!client || !relativePath) return;
    markWriteStarted();
    try {
      const automatedBoard = runKanbanAutomations(normalizeKanbanBoard(newBoard), 'onBoardSave');
      const serialized = JSON.stringify(automatedBoard, null, 2);
      const result = await client.writeDocument(
        relativePath,
        serialized,
        hashRef.current,
        savedBoardContentRef.current ?? undefined,
      );
      if (result.conflict) {
        addConflict({
          ...result.conflict,
          ourContent: serialized,
        });
        return;
      }
      if (isMountedRef.current) {
        const mergedSerialized = result.mergedContent ?? serialized;
        const mergedBoard = mergedSerialized === serialized
          ? automatedBoard
          : runKanbanAutomations(normalizeKanbanBoard(JSON.parse(mergedSerialized) as KanbanBoard), 'onBoardSave');
        if (mergedSerialized !== serialized) {
          markLoaded(result.version);
        }
        setBoard(mergedBoard);
        savedBoardContentRef.current = mergedSerialized;
        hashRef.current = result.version;
        isDirtyRef.current = false;
        markSaved(relativePath, result.version);
        if (shouldCreateSnapshot(result.version)) {
          client.createSnapshot(
            relativePath,
            mergedSerialized,
            myUserId,
            myUserName,
          ).catch(() => {});
        }
      }
    } catch {}
  }, [addConflict, client, markSaved, markWriteStarted, myUserId, myUserName, relativePath, shouldCreateSnapshot]);

  const updateBoard = useCallback((updater: (b: KanbanBoard) => KanbanBoard) => {
    // Viewers cannot modify the board; drop every mutation so no write is attempted.
    if (readOnly) return;
    // Live session: apply the edit to the shared CRDT structure; the server
    // persists it. Derive from the latest board (which includes remote merges)
    // and avoid mutating inside a setState updater so a double-invoked updater
    // cannot apply the edit twice.
    if (liveSession) {
      const next = updater(boardRef.current);
      if (next === boardRef.current) return;
      boardRef.current = next;
      setBoard(next);
      liveSession.writeJson(boardToJson(next));
      return;
    }
    setBoard(prev => {
      const next = updater(prev);
      if (next === prev) return prev;
      isDirtyRef.current = true;
      latestBoardRef.current = next;
      if (relativePath) markDirty(relativePath);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Serialize writes so a slow save never overlaps the next one with a stale
      // revision; the trailing save always writes the latest board.
      saveTimerRef.current = setTimeout(
        () => { void runExclusiveSave(() => saveBoard(latestBoardRef.current ?? next)); },
        600,
      );
      return next;
    });
  }, [liveSession, markDirty, readOnly, relativePath, runExclusiveSave, saveBoard]);

  const loadBoard = useCallback(async (isInitial = false) => {
    if (!client || !relativePath) return;
    try {
      const { content, version } = await client.readDocument(relativePath);
      if (!isMountedRef.current) return;
      if (content.trim()) {
        const parsed: KanbanBoard = JSON.parse(content);
        setBoard(runKanbanAutomations(normalizeKanbanBoard(parsed), 'onBoardOpen'));
        savedBoardContentRef.current = content;
        isDirtyRef.current = false;
        markLoaded(version);
        setSavedHash(relativePath, version);
      } else if (isInitial && !readOnly) {
        const def = makeDefaultBoard();
        setBoard(def);
        const result = await client.writeDocument(
          relativePath, JSON.stringify(def, null, 2), undefined,
        );
        savedBoardContentRef.current = JSON.stringify(def, null, 2);
        isDirtyRef.current = false;
        markLoaded(result.version);
        setSavedHash(relativePath, result.version);
      }
    } catch {}
  }, [client, markLoaded, readOnly, relativePath, setSavedHash]);

  useEffect(() => {
    loadBoard(true);
  }, [loadBoard]);

  // Open a live co-editing session for hosted boards; fall back to REST when
  // unavailable. Remote changes (and the initial seeded state) flow in through
  // `onChange`; the board seeds the room if the server has not already.
  useEffect(() => {
    if (!client || !relativePath || !client.resolveLiveSession) {
      setLiveSession(null);
      return;
    }
    let cancelled = false;
    let opened: LiveJsonSession | null = null;
    let off: (() => void) | undefined;
    openLiveJsonSession(client, relativePath)
      .then((session) => {
        if (cancelled || !session) {
          session?.destroy();
          return;
        }
        opened = session;
        const initial = session.readJson();
        if (initial && Object.keys(initial).length > 0) {
          const next = runKanbanAutomations(normalizeKanbanBoard(initial as unknown as KanbanBoard), 'onBoardOpen');
          boardRef.current = next;
          setBoard(next);
        } else {
          // The server owns seeding from the current REST revision. Do not seed
          // an empty live root from React state that may still be the initial
          // blank board.
          session.destroy();
          opened = null;
          return;
        }
        off = session.onChange((json) => {
          if (cancelled) return;
          const next = runKanbanAutomations(normalizeKanbanBoard(json as unknown as KanbanBoard), 'onBoardOpen');
          boardRef.current = next;
          setBoard(next);
        });
        setLiveSession(session);
      })
      .catch(() => {
        // Best-effort; REST remains available.
      });
    return () => {
      cancelled = true;
      off?.();
      opened?.destroy();
      setLiveSession(null);
    };
  }, [client, relativePath]);

  useEffect(() => {
    if (!liveSession) return;
    liveSession.awareness.setLocalStateField('user', {
      id: myUserId,
      name: myUserName,
      color: myUserColor,
    });
    liveSession.awareness.setLocalStateField('document', {
      kind: 'kanban',
      relativePath,
    });
  }, [liveSession, myUserColor, myUserId, myUserName, relativePath]);

  // ── Live awareness: publish the open card, consume remote peers ──────────
  const { boardPath: editingBoardPath, cardId: editingCardId } = useKanbanStore();
  const myOpenCardId = editingBoardPath === relativePath ? editingCardId : null;
  useEffect(() => {
    if (!liveSession) return;
    // Ephemeral only — the card a client has open is awareness, never persisted
    // as board content.
    liveSession.awareness.setLocalStateField('kanban', { editingCardId: myOpenCardId ?? null });
  }, [liveSession, myOpenCardId]);
  const livePeers = useLivePeers(liveSession);
  const remoteCardEditors = useMemo(() => buildKanbanCardEditors(livePeers), [livePeers]);

  // ── Collab: reload on peer edits ─────────────────────────────────────────

  useEffect(() => {
    if (!client || !client.capabilities.filesystemWatch || !relativePath) return;
    let unsub: (() => void) | undefined;
    listen<{ path: string }>('vault:file-modified', (event) => {
      if (event.payload.path !== relativePath) return;
      if (isDirtyRef.current) return;
      if (Date.now() - lastWriteRef.current < 2000) return;
      loadBoard(false);
    }).then(u => { unsub = u; });
    return () => { unsub?.(); };
  }, [client, relativePath, loadBoard, lastWriteRef]);

  // ── Known users (for assignee picker) ────────────────────────────────────

  useEffect(() => {
    if (!vault || !collabTransport) return;
    collabTransport.readVaultConfig()
      .then(config => { if (isMountedRef.current) setKnownUsers(config.knownUsers ?? []); })
      .catch(() => {});
  }, [collabTransport, vault?.path, peers.length]);

  // ── Empty state ──────────────────────────────────────────────────────────

  if (!relativePath) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground gap-3 select-none">
        <LayoutDashboard size={40} className="opacity-30" />
        <p className="text-lg font-medium">Kanban Board</p>
        <p className="text-sm opacity-60">Select or create a board from the sidebar.</p>
      </div>
    );
  }

  if (!vault) return null;

  return (
    <KanbanContext.Provider value={{ board, updateBoard, knownUsers, relativePath, readOnly, caps, livePeers, remoteCardEditors }}>
      {readOnly && <ReadOnlyBanner />}
      <KanbanBoardView />
    </KanbanContext.Provider>
  );
}
