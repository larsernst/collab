import { useEffect, useCallback, useMemo, useRef, useState, createContext, useContext } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LayoutDashboard } from 'lucide-react';
import { createVaultClient } from '../lib/vaultClient';
import { useVaultStore } from '../store/vaultStore';
import { useCollabStore } from '../store/collabStore';
import { useCollabIdentity } from '../lib/collabIdentity';
import { normalizeKanbanBoard, runKanbanAutomations, type KanbanBoard } from '../types/kanban';
import { isVaultReadOnly, type KnownUser } from '../types/vault';
import KanbanBoardView from '../components/kanban/KanbanBoard';
import { ReadOnlyBanner } from '../components/layout/ReadOnlyBanner';
import { useEditorStore } from '../store/editorStore';
import { useDocumentSessionState } from '../lib/documentSession';
import { useCollabContext } from '../components/collaboration/CollabProvider';

// ── Context ───────────────────────────────────────────────────────────────────

interface KanbanCtx {
  board: KanbanBoard;
  updateBoard: (updater: (b: KanbanBoard) => KanbanBoard) => void;
  knownUsers: KnownUser[];
  relativePath: string;
  /** Viewer access to a hosted vault: board mutations are disabled. */
  readOnly: boolean;
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function KanbanPage({ relativePath }: { relativePath: string | null }) {
  const { vault } = useVaultStore();
  const client = useMemo(() => (vault ? createVaultClient(vault) : null), [vault]);
  const readOnly = isVaultReadOnly(vault);
  const { markDirty, markSaved, setSavedHash } = useEditorStore();
  const { peers, addConflict } = useCollabStore();
  // Snapshot authorship follows the effective identity (server-authoritative for hosted).
  const { userId: myUserId, userName: myUserName } = useCollabIdentity();
  const collabTransport = useCollabContext();
  const [board, setBoard]           = useState<KanbanBoard>({ columns: [] });
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const isMountedRef    = useRef(true);
  const isDirtyRef      = useRef(false);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedBoardContentRef = useRef<string | null>(null);
  const { hashRef, lastWriteRef, markLoaded, markWriteStarted, shouldCreateSnapshot } = useDocumentSessionState();

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
    setBoard(prev => {
      const next = updater(prev);
      if (next === prev) return prev;
      isDirtyRef.current = true;
      if (relativePath) markDirty(relativePath);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveBoard(next), 600);
      return next;
    });
  }, [markDirty, readOnly, relativePath, saveBoard]);

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
    <KanbanContext.Provider value={{ board, updateBoard, knownUsers, relativePath, readOnly }}>
      {readOnly && <ReadOnlyBanner />}
      <KanbanBoardView />
    </KanbanContext.Provider>
  );
}
