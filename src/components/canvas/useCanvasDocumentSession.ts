import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node as FlowNode, Viewport } from '@xyflow/react';

import { createVaultClient } from '../../lib/vaultClient';
import { openLiveJsonSession, type LiveJsonSession, type JsonObject } from '../../lib/liveJsonDocument';
import { onReplicaMutated } from '../../lib/vaultReplica';
import type { CanvasData, CanvasEdge } from '../../types/canvas';
import type { VaultMeta } from '../../types/vault';
import type { CanvasNodeData } from './CanvasNodeTypes';
import type { CanvasFlowEdge } from './CanvasEdgeTypes';

const SAVE_DEBOUNCE_MS = 600;
const LIVE_WRITE_DEBOUNCE_MS = 300;
// Re-enabled once the canvas CRDT path gained safety guarantees: the client only
// writes after the live state exactly matches the initial server snapshot
// (`liveHydratedRef`), refuses to open a session whose live state has lost REST
// nodes (`lostRestNodes`), and falls back to REST on an empty live root; the
// server refuses to materialize a node-losing canvas over a populated revision
// and reseeds a degenerate room from the canonical revision on load.
const LIVE_CANVAS_ENABLED = true;

/** Plain-JSON snapshot of canvas data for the live CRDT structure. */
function canvasToJson(canvas: CanvasData): JsonObject {
  return JSON.parse(JSON.stringify(canvas)) as JsonObject;
}
const EMPTY_CANVAS: CanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export function sanitizeLoadedCanvasData(canvas: CanvasData) {
  const inputNodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const inputEdges = Array.isArray(canvas?.edges) ? canvas.edges : [];
  const nodes = inputNodes.filter((node) => (
    !!node
    && typeof node.id === 'string'
    && typeof node.type === 'string'
    && !!node.position
    && Number.isFinite(node.position.x)
    && Number.isFinite(node.position.y)
  ));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = inputEdges.filter((edge) => (
    !!edge
    && typeof edge.id === 'string'
    && typeof edge.source === 'string'
    && typeof edge.target === 'string'
    && nodeIds.has(edge.source)
    && nodeIds.has(edge.target)
  ));
  const viewport = canvas?.viewport
    && Number.isFinite(canvas.viewport.x)
    && Number.isFinite(canvas.viewport.y)
    && Number.isFinite(canvas.viewport.zoom)
    ? canvas.viewport
    : EMPTY_CANVAS.viewport;
  const changed = nodes.length !== inputNodes.length
    || edges.length !== inputEdges.length
    || viewport !== canvas?.viewport;

  if (!changed) {
    return { canvas, changed: false };
  }

  return {
    canvas: {
      ...canvas,
      nodes,
      edges,
      viewport,
    },
    changed: true,
  };
}

interface ReactFlowViewportApi {
  setViewport: (viewport: Viewport, options?: { duration?: number }) => void | Promise<unknown>;
}

interface UseCanvasDocumentSessionOptions {
  reactFlow: ReactFlowViewportApi;
  vault: VaultMeta | null;
  relativePath: string | null;
  nodes: FlowNode<CanvasNodeData>[];
  edges: CanvasFlowEdge[];
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  setNodes: React.Dispatch<React.SetStateAction<FlowNode<CanvasNodeData>[]>>;
  setEdges: React.Dispatch<React.SetStateAction<CanvasFlowEdge[]>>;
  buildFlowNode: (canvas: CanvasData) => FlowNode<CanvasNodeData>[];
  toFlowEdge: (edge: CanvasEdge) => CanvasFlowEdge;
  fromFlowNode: (node: FlowNode<CanvasNodeData>) => CanvasData['nodes'][number];
  fromFlowEdge: (edge: CanvasFlowEdge) => CanvasEdge;
  resetPreviewState: () => void;
  markDirty: (path: string) => void;
  markSaved: (path: string, hash: string) => void;
  setSavedHash: (path: string, hash: string) => void;
  addConflict: (conflict: { relativePath: string; ourContent: string; theirContent: string }) => void;
  myUserId: string;
  myUserName: string;
  myUserColor?: string;
  isMountedRef: React.RefObject<boolean>;
  isDirtyRef: React.RefObject<boolean>;
  hashRef: React.RefObject<string | undefined>;
  lastWriteRef: React.RefObject<number>;
  markLoaded: (hash?: string | null) => void;
  shouldSkipAutosave: () => boolean;
  pauseAutosave?: boolean;
  /** Viewer access to a hosted vault: never persist or auto-create the canvas. */
  readOnly?: boolean;
  markWriteStarted: () => void;
  shouldCreateSnapshot: (hash: string) => boolean;
  runExclusiveSave: (save: () => Promise<void>) => Promise<void>;
}

export function useCanvasDocumentSession({
  reactFlow,
  vault,
  relativePath,
  nodes,
  edges,
  viewport,
  setViewport,
  setNodes,
  setEdges,
  buildFlowNode,
  toFlowEdge,
  fromFlowNode,
  fromFlowEdge,
  resetPreviewState,
  markDirty,
  markSaved,
  setSavedHash,
  addConflict,
  myUserId,
  myUserName,
  myUserColor,
  isMountedRef,
  isDirtyRef,
  hashRef,
  lastWriteRef,
  markLoaded,
  shouldSkipAutosave,
  pauseAutosave = false,
  readOnly = false,
  markWriteStarted,
  shouldCreateSnapshot,
  runExclusiveSave,
}: UseCanvasDocumentSessionOptions) {
  const client = useMemo(() => (vault ? createVaultClient(vault) : null), [vault]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshPulseTimerRef = useRef<number | null>(null);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const savedCanvasContentRef = useRef<string | null>(null);
  const restCanvasRef = useRef<CanvasData | null>(null);
  const [restLoadedPath, setRestLoadedPath] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshPulse, setRefreshPulse] = useState(false);
  // Live co-editing session for hosted canvases; null = REST optimistic writes.
  const [liveSession, setLiveSession] = useState<LiveJsonSession | null>(null);
  const liveWriteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveHydratedRef = useRef(false);
  const expectedLiveCanvasRef = useRef<string | null>(null);

  // Applies a canvas document (remote live change or seed) to the editor state.
  const applyCanvas = useCallback((canvas: CanvasData) => {
    const sanitized = sanitizeLoadedCanvasData(canvas).canvas;
    resetPreviewState();
    setViewport(sanitized.viewport ?? EMPTY_CANVAS.viewport);
    setNodes(buildFlowNode(sanitized));
    setEdges((sanitized.edges ?? []).map(toFlowEdge));
    pendingViewportRef.current = sanitized.viewport ?? EMPTY_CANVAS.viewport;
    setLoadRevision((prev) => prev + 1);
  }, [buildFlowNode, resetPreviewState, setEdges, setNodes, setViewport, toFlowEdge]);

  const applyLiveCanvas = useCallback((canvas: CanvasData) => {
    const sanitized = sanitizeLoadedCanvasData(canvas).canvas;
    liveHydratedRef.current = false;
    // Compare hydration against the exact ReactFlow round-trip because flow
    // conversion normalizes defaults and object key order.
    expectedLiveCanvasRef.current = JSON.stringify(canvasToJson({
      nodes: buildFlowNode(sanitized).map(fromFlowNode),
      edges: sanitized.edges.map(toFlowEdge).map(fromFlowEdge),
      viewport: sanitized.viewport,
    }));
    applyCanvas(sanitized);
  }, [applyCanvas, buildFlowNode, fromFlowEdge, fromFlowNode, toFlowEdge]);

  const loadCanvas = useCallback(async (isInitial = false): Promise<boolean> => {
    if (!client || !relativePath) return false;
    if (isInitial) setIsLoading(true);

    try {
      const { content, version } = await client.readDocument(relativePath);
      if (!isMountedRef.current) return false;

      let canvas = EMPTY_CANVAS;
      let currentHash = version;

      if (content.trim()) {
        canvas = JSON.parse(content) as CanvasData;
        const sanitized = sanitizeLoadedCanvasData(canvas);
        canvas = sanitized.canvas;
        const sanitizedContent = sanitized.changed ? JSON.stringify(canvas, null, 2) : content;

        savedCanvasContentRef.current = sanitizedContent;

        // Viewers cannot persist; skip the dangling-edge repair write and keep
        // the sanitized canvas in memory only.
        if (sanitized.changed && !readOnly && client.capabilities.nativeFilesystem) {
          try {
            const repairedResult = await client.writeDocument(
              relativePath,
              sanitizedContent,
              currentHash ?? undefined,
              content,
            );
            currentHash = repairedResult.version;
          } catch {}
        }
      } else if (isInitial && !readOnly) {
        const blank = EMPTY_CANVAS;
        const result = await client.writeDocument(relativePath, JSON.stringify(blank, null, 2));
        currentHash = result.version;
        canvas = blank;
        savedCanvasContentRef.current = JSON.stringify(blank, null, 2);
      }

      const changed = currentHash !== hashRef.current;
      markLoaded(currentHash);
      restCanvasRef.current = canvas;
      setRestLoadedPath(relativePath);
      isDirtyRef.current = false;
      setSavedHash(relativePath, currentHash);
      resetPreviewState();
      setViewport(canvas.viewport ?? EMPTY_CANVAS.viewport);
      setNodes(buildFlowNode(canvas));
      setEdges(canvas.edges.map(toFlowEdge));
      pendingViewportRef.current = canvas.viewport ?? EMPTY_CANVAS.viewport;
      setLoadRevision((prev) => prev + 1);
      return changed;
    } catch {
      setRestLoadedPath(relativePath);
      return false;
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [
    buildFlowNode,
    client,
    isDirtyRef,
    isMountedRef,
    markLoaded,
    readOnly,
    relativePath,
    resetPreviewState,
    setEdges,
    setNodes,
    setSavedHash,
    setViewport,
    toFlowEdge,
  ]);

  useEffect(() => {
    if (!relativePath) return;
    void loadCanvas(true);
  }, [loadCanvas, relativePath]);

  // Open a live co-editing session for hosted canvases; fall back to REST when
  // unavailable. Remote changes flow in through `onChange`.
  useEffect(() => {
    if (
      !LIVE_CANVAS_ENABLED
      || !client
      || !relativePath
      || !client.resolveLiveSession
      || restLoadedPath !== relativePath
    ) {
      liveHydratedRef.current = false;
      expectedLiveCanvasRef.current = null;
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
          const liveCanvas = sanitizeLoadedCanvasData(initial as unknown as CanvasData).canvas;
          const restCanvas = restCanvasRef.current;
          const liveNodeIds = new Set(liveCanvas.nodes.map((node) => node.id));
          const lostRestNodes = restCanvas?.nodes.some((node) => !liveNodeIds.has(node.id)) ?? false;
          if (lostRestNodes) {
            // A live room must not replace the current canonical revision with a
            // suspiciously sparse state. This recovers rooms damaged by the
            // early structured-live startup/bigint regressions without
            // automatically writing or guessing at the missing content. Discard
            // the offline replica seed too so a degenerate cached state cannot
            // persist and re-trigger this on the next open.
            session.discardOfflineState();
            session.destroy();
            opened = null;
            return;
          }
          applyLiveCanvas(liveCanvas);
        } else {
          // The server owns seeding from the current REST revision. An empty
          // root means it could not provide a valid live canvas; keep the REST
          // document visible instead of seeding from potentially stale React
          // state (which may still be the initial empty canvas). Discard the
          // (empty) offline seed so it is not persisted back.
          session.discardOfflineState();
          session.destroy();
          opened = null;
          return;
        }
        off = session.onChange((json) => {
          if (!cancelled) applyLiveCanvas(json as unknown as CanvasData);
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
      liveHydratedRef.current = false;
      expectedLiveCanvasRef.current = null;
      setLiveSession(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyLiveCanvas, client, relativePath, restLoadedPath]);

  useEffect(() => {
    if (!liveSession) return;
    liveSession.awareness.setLocalStateField('user', {
      id: myUserId,
      name: myUserName,
      color: myUserColor,
    });
    liveSession.awareness.setLocalStateField('document', {
      kind: 'canvas',
      relativePath,
    });
  }, [liveSession, myUserColor, myUserId, myUserName, relativePath]);

  // Publish the nodes this client currently has selected as ephemeral canvas
  // awareness so peers can see what each collaborator is working on. Only sent
  // when the selection set actually changes (not on every drag tick), and never
  // persisted as document content.
  const publishedSelectionRef = useRef<string>('');
  useEffect(() => {
    if (!liveSession) return;
    const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
    const key = selectedNodeIds.join(',');
    if (key === publishedSelectionRef.current) return;
    publishedSelectionRef.current = key;
    liveSession.awareness.setLocalStateField('canvas', { selectedNodeIds });
  }, [liveSession, nodes]);

  // Push local canvas edits into the live structure (debounced). Writing a value
  // that already matches the shared document is a no-op, so remote-applied
  // changes do not echo back.
  useEffect(() => {
    if (!liveSession || readOnly) return;
    const localCanvas = canvasToJson({
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport,
    });
    if (!liveHydratedRef.current) {
      if (JSON.stringify(localCanvas) === expectedLiveCanvasRef.current) {
        liveHydratedRef.current = true;
      }
      return;
    }
    if (liveWriteTimerRef.current) clearTimeout(liveWriteTimerRef.current);
    liveWriteTimerRef.current = setTimeout(() => {
      liveSession.writeJson(localCanvas);
    }, LIVE_WRITE_DEBOUNCE_MS);
    return () => {
      if (liveWriteTimerRef.current) clearTimeout(liveWriteTimerRef.current);
    };
  }, [liveSession, readOnly, nodes, edges, viewport, fromFlowNode, fromFlowEdge]);

  useEffect(() => {
    const nextViewport = pendingViewportRef.current;
    if (!nextViewport) return;
    pendingViewportRef.current = null;
    requestAnimationFrame(() => {
      void reactFlow.setViewport(nextViewport, { duration: 0 });
    });
  }, [loadRevision, reactFlow]);

  useEffect(() => {
    if (!client || !client.capabilities.filesystemWatch || !relativePath) return;
    let unsub: (() => void) | undefined;

    listen<{ path: string }>('vault:file-modified', (event) => {
      if (event.payload.path !== relativePath) return;
      if (isDirtyRef.current) return;
      if (Date.now() - lastWriteRef.current < 2000) return;
      void loadCanvas(false);
    }).then((cleanup) => {
      unsub = cleanup;
    });

    return () => {
      unsub?.();
    };
  }, [client, isDirtyRef, lastWriteRef, loadCanvas, relativePath]);

  useEffect(() => {
    if (!client || client.kind !== 'hosted' || !relativePath) return;
    return onReplicaMutated(async () => {
      if (isDirtyRef.current || liveSession) return;
      if (await loadCanvas(false)) {
        setRefreshPulse(true);
        if (refreshPulseTimerRef.current !== null) window.clearTimeout(refreshPulseTimerRef.current);
        refreshPulseTimerRef.current = window.setTimeout(() => setRefreshPulse(false), 420);
      }
    });
  }, [client, isDirtyRef, liveSession, loadCanvas, relativePath]);

  useEffect(() => () => {
    if (refreshPulseTimerRef.current !== null) window.clearTimeout(refreshPulseTimerRef.current);
  }, []);

  const saveCanvas = useCallback(async () => {
    if (!client || !relativePath || readOnly) return;
    const payload: CanvasData = {
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport,
    };
    const serialized = JSON.stringify(payload, null, 2);

    markWriteStarted();
    try {
      const result = await client.writeDocument(
        relativePath,
        serialized,
        hashRef.current ?? undefined,
        savedCanvasContentRef.current ?? undefined,
      );
      if (result.conflict) {
        addConflict({ ...result.conflict, ourContent: serialized });
        return;
      }
      if (isMountedRef.current) {
        const mergedSerialized = result.mergedContent ?? serialized;
        if (mergedSerialized !== serialized) {
          markLoaded(result.version);
          const mergedCanvas = JSON.parse(mergedSerialized) as CanvasData;
          resetPreviewState();
          setViewport(mergedCanvas.viewport ?? EMPTY_CANVAS.viewport);
          setNodes(buildFlowNode(mergedCanvas));
          setEdges(mergedCanvas.edges.map(toFlowEdge));
          pendingViewportRef.current = mergedCanvas.viewport ?? EMPTY_CANVAS.viewport;
          setLoadRevision((prev) => prev + 1);
        }
        savedCanvasContentRef.current = mergedSerialized;
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
  }, [
    addConflict,
    buildFlowNode,
    client,
    edges,
    fromFlowEdge,
    fromFlowNode,
    hashRef,
    isDirtyRef,
    isMountedRef,
    markLoaded,
    markSaved,
    markWriteStarted,
    myUserId,
    myUserName,
    nodes,
    readOnly,
    relativePath,
    resetPreviewState,
    setEdges,
    setNodes,
    setViewport,
    shouldCreateSnapshot,
    toFlowEdge,
    viewport,
  ]);

  useEffect(() => {
    if (!vault || !relativePath) return;
    // Live sessions persist through the server, not the REST autosave path.
    if (pauseAutosave || readOnly || liveSession) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      return;
    }
    if (shouldSkipAutosave()) {
      return;
    }
    isDirtyRef.current = true;
    markDirty(relativePath);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Serialize writes so a slow save never overlaps the next one with a stale
    // revision; the trailing save coalesces to the latest canvas state.
    saveTimerRef.current = setTimeout(() => {
      void runExclusiveSave(saveCanvas);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [edges, isDirtyRef, liveSession, markDirty, nodes, pauseAutosave, readOnly, relativePath, runExclusiveSave, saveCanvas, shouldSkipAutosave, vault, viewport]);

  return { liveSession, isLoading, refreshPulse };
}
