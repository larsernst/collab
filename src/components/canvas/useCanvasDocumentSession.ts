import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node as FlowNode, Viewport } from '@xyflow/react';

import { createVaultClient } from '../../lib/vaultClient';
import type { CanvasData, CanvasEdge } from '../../types/canvas';
import type { VaultMeta } from '../../types/vault';
import type { CanvasNodeData } from './CanvasNodeTypes';
import type { CanvasFlowEdge } from './CanvasEdgeTypes';

const SAVE_DEBOUNCE_MS = 600;
const EMPTY_CANVAS: CanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export function sanitizeLoadedCanvasData(canvas: CanvasData) {
  const nodeIds = new Set(canvas.nodes.map((node) => node.id));
  const edges = canvas.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const changed = edges.length !== canvas.edges.length;

  if (!changed) {
    return { canvas, changed: false };
  }

  return {
    canvas: {
      ...canvas,
      edges,
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
}: UseCanvasDocumentSessionOptions) {
  const client = useMemo(() => (vault ? createVaultClient(vault) : null), [vault]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingViewportRef = useRef<Viewport | null>(null);
  const savedCanvasContentRef = useRef<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  const loadCanvas = useCallback(async (isInitial = false) => {
    if (!client || !relativePath) return;

    try {
      const { content, version } = await client.readDocument(relativePath);
      if (!isMountedRef.current) return;

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
        if (sanitized.changed && !readOnly) {
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

      markLoaded(currentHash);
      isDirtyRef.current = false;
      setSavedHash(relativePath, currentHash);
      resetPreviewState();
      setViewport(canvas.viewport ?? EMPTY_CANVAS.viewport);
      setNodes(buildFlowNode(canvas));
      setEdges(canvas.edges.map(toFlowEdge));
      pendingViewportRef.current = canvas.viewport ?? EMPTY_CANVAS.viewport;
      setLoadRevision((prev) => prev + 1);
    } catch {}
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
    if (pauseAutosave || readOnly) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      return;
    }
    if (shouldSkipAutosave()) {
      return;
    }
    isDirtyRef.current = true;
    markDirty(relativePath);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void saveCanvas();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [edges, isDirtyRef, markDirty, nodes, pauseAutosave, readOnly, relativePath, saveCanvas, shouldSkipAutosave, vault, viewport]);
}
