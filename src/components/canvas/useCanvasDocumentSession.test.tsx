import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node as FlowNode } from '@xyflow/react';

import type { CanvasNodeData } from './CanvasNodeTypes';
import type { CanvasFlowEdge } from './CanvasEdgeTypes';
import { sanitizeLoadedCanvasData, useCanvasDocumentSession } from './useCanvasDocumentSession';

const eventState = vi.hoisted(() => ({
  modifiedHandler: null as null | ((event: { payload: { path: string } }) => void),
}));

const tauriMocks = vi.hoisted(() => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  createSnapshot: vi.fn(),
}));

const liveMocks = vi.hoisted(() => ({
  openLiveJsonSession: vi.fn(async () => null as unknown),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_eventName: string, handler: (event: { payload: { path: string } }) => void) => {
    eventState.modifiedHandler = handler;
    return () => {
      eventState.modifiedHandler = null;
    };
  }),
}));

vi.mock('../../lib/tauri', () => ({
  tauriCommands: {
    readNote: tauriMocks.readNote,
    writeNote: tauriMocks.writeNote,
    createSnapshot: tauriMocks.createSnapshot,
  },
}));

vi.mock('../../lib/liveJsonDocument', () => ({
  openLiveJsonSession: liveMocks.openLiveJsonSession,
}));

describe('useCanvasDocumentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveMocks.openLiveJsonSession.mockResolvedValue(null);
    tauriMocks.readNote.mockResolvedValue({
      content: JSON.stringify({ nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 0.9 } }),
      hash: 'hash-1',
      modifiedAt: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('removes dangling edges from loaded canvas data', () => {
    expect(sanitizeLoadedCanvasData({
      nodes: [
        { id: 'node-a', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
      ],
      edges: [
        { id: 'edge-ok', source: 'node-a', target: 'node-a' },
        { id: 'edge-broken', source: 'node-a', target: 'missing-node' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    })).toEqual({
      changed: true,
      canvas: {
        nodes: [
          { id: 'node-a', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
        ],
        edges: [
          { id: 'edge-ok', source: 'node-a', target: 'node-a' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
  });

  it('drops malformed live nodes and their edges before they reach ReactFlow', () => {
    const result = sanitizeLoadedCanvasData({
      nodes: [
        { id: 'valid', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
        { id: 'partial', type: 'text', content: 'B' },
      ],
      edges: [
        { id: 'valid-edge', source: 'valid', target: 'valid' },
        { id: 'partial-edge', source: 'valid', target: 'partial' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as Parameters<typeof sanitizeLoadedCanvasData>[0]);

    expect(result.changed).toBe(true);
    expect(result.canvas.nodes.map((node) => node.id)).toEqual(['valid']);
    expect(result.canvas.edges.map((edge) => edge.id)).toEqual(['valid-edge']);
  });

  it('loads the canvas document and resets preview state', async () => {
    const setViewport = vi.fn();
    const setNodes = vi.fn();
    const setEdges = vi.fn();
    const resetPreviewState = vi.fn();
    const setSavedHash = vi.fn();
    const markLoaded = vi.fn((hash?: string | null) => {
      hashRef.current = hash ?? undefined;
    });
    const hashRef = { current: undefined as string | undefined };

    renderHook(() => useCanvasDocumentSession({
      reactFlow: { setViewport: vi.fn() },
      vault: { id: 'vault-1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: 1 },
      relativePath: 'Boards/test.canvas',
      nodes: [],
      edges: [] as CanvasFlowEdge[],
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport,
      setNodes,
      setEdges,
      buildFlowNode: () => [] as FlowNode<CanvasNodeData>[],
      toFlowEdge: (edge) => edge as never,
      fromFlowNode: vi.fn(),
      fromFlowEdge: vi.fn(),
      resetPreviewState,
      markDirty: vi.fn(),
      markSaved: vi.fn(),
      setSavedHash,
      addConflict: vi.fn(),
      myUserId: 'user-1',
      myUserName: 'User',
      isMountedRef: { current: true },
      isDirtyRef: { current: false },
      hashRef,
      lastWriteRef: { current: 0 },
      markLoaded,
      shouldSkipAutosave: () => true,
      markWriteStarted: vi.fn(),
      shouldCreateSnapshot: () => false,
      runExclusiveSave: (save: () => Promise<void>) => save(),
    }));

    await waitFor(() => {
      expect(setSavedHash).toHaveBeenCalledWith('Boards/test.canvas', 'hash-1');
    });

    expect(markLoaded).toHaveBeenCalledWith('hash-1');
    expect(resetPreviewState).toHaveBeenCalled();
    expect(setViewport).toHaveBeenCalledWith({ x: 1, y: 2, zoom: 0.9 });
  });

  it('persists a repaired canvas when load removes dangling edges', async () => {
    tauriMocks.readNote.mockResolvedValue({
      content: JSON.stringify({
        nodes: [
          { id: 'node-a', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
        ],
        edges: [
          { id: 'edge-broken', source: 'node-a', target: 'missing-node' },
        ],
        viewport: { x: 1, y: 2, zoom: 0.9 },
      }),
      hash: 'hash-1',
      modifiedAt: 1,
    });
    tauriMocks.writeNote.mockResolvedValue({
      hash: 'hash-repaired',
    });

    const setSavedHash = vi.fn();
    const markLoaded = vi.fn((hash?: string | null) => {
      hashRef.current = hash ?? undefined;
    });
    const hashRef = { current: undefined as string | undefined };

    renderHook(() => useCanvasDocumentSession({
      reactFlow: { setViewport: vi.fn() },
      vault: { id: 'vault-1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: 1 },
      relativePath: 'Boards/test.canvas',
      nodes: [],
      edges: [] as CanvasFlowEdge[],
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: vi.fn(),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      buildFlowNode: () => [] as FlowNode<CanvasNodeData>[],
      toFlowEdge: (edge) => edge as never,
      fromFlowNode: vi.fn(),
      fromFlowEdge: vi.fn(),
      resetPreviewState: vi.fn(),
      markDirty: vi.fn(),
      markSaved: vi.fn(),
      setSavedHash,
      addConflict: vi.fn(),
      myUserId: 'user-1',
      myUserName: 'User',
      isMountedRef: { current: true },
      isDirtyRef: { current: false },
      hashRef,
      lastWriteRef: { current: 0 },
      markLoaded,
      shouldSkipAutosave: () => true,
      markWriteStarted: vi.fn(),
      shouldCreateSnapshot: () => false,
      runExclusiveSave: (save: () => Promise<void>) => save(),
    }));

    await waitFor(() => {
      expect(tauriMocks.writeNote).toHaveBeenCalledWith(
        '/vault',
        'Boards/test.canvas',
        JSON.stringify({
          nodes: [
            { id: 'node-a', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
          ],
          edges: [],
          viewport: { x: 1, y: 2, zoom: 0.9 },
        }, null, 2),
        'hash-1',
        JSON.stringify({
          nodes: [
            { id: 'node-a', type: 'text', content: 'A', position: { x: 0, y: 0 }, width: 100, height: 100 },
          ],
          edges: [
            { id: 'edge-broken', source: 'node-a', target: 'missing-node' },
          ],
          viewport: { x: 1, y: 2, zoom: 0.9 },
        }),
      );
    });

    expect(setSavedHash).toHaveBeenCalledWith('Boards/test.canvas', 'hash-repaired');
    expect(markLoaded).toHaveBeenCalledWith('hash-repaired');
  });

  it('autosaves current canvas content and creates a snapshot on success', async () => {
    vi.useFakeTimers();
    const hashRef = { current: 'hash-1' as string | undefined };
    let skipAutosave = true;
    tauriMocks.writeNote.mockResolvedValue({ hash: 'hash-2' });

    const baseOptions = {
      reactFlow: { setViewport: vi.fn() },
      vault: { id: 'vault-1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: 1 },
      relativePath: 'Boards/test.canvas',
      setViewport: vi.fn(),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      buildFlowNode: () => [] as FlowNode<CanvasNodeData>[],
      toFlowEdge: (edge: unknown) => edge as never,
      fromFlowNode: vi.fn((node: FlowNode<CanvasNodeData>) => ({ id: node.id, type: 'text' as const, content: node.data.content ?? '', position: node.position, width: 100, height: 100 })),
      fromFlowEdge: vi.fn((edge: CanvasFlowEdge) => edge as never),
      resetPreviewState: vi.fn(),
      markDirty: vi.fn(),
      markSaved: vi.fn(),
      setSavedHash: vi.fn(),
      addConflict: vi.fn(),
      myUserId: 'user-1',
      myUserName: 'User',
      isMountedRef: { current: true },
      isDirtyRef: { current: false },
      hashRef,
      lastWriteRef: { current: 0 },
      markLoaded: vi.fn((hash?: string | null) => {
        hashRef.current = hash ?? undefined;
      }),
      shouldSkipAutosave: () => skipAutosave,
      markWriteStarted: vi.fn(),
      shouldCreateSnapshot: () => true,
      runExclusiveSave: (save: () => Promise<void>) => save(),
    };

    const { rerender } = renderHook((props: { nodes: FlowNode<CanvasNodeData>[] }) => useCanvasDocumentSession({
      ...baseOptions,
      nodes: props.nodes,
      edges: [] as CanvasFlowEdge[],
      viewport: { x: 0, y: 0, zoom: 1 },
    }), {
      initialProps: {
        nodes: [] as FlowNode<CanvasNodeData>[],
      },
    });

    await Promise.resolve();
    expect(tauriMocks.readNote).toHaveBeenCalled();

    skipAutosave = false;
    rerender({
      nodes: [{
        id: 'node-1',
        type: 'textCard',
        position: { x: 0, y: 0 },
        data: { content: 'hello' },
      } as FlowNode<CanvasNodeData>],
    });

    await vi.advanceTimersByTimeAsync(650);
    await Promise.resolve();

    expect(tauriMocks.writeNote).toHaveBeenCalled();

    expect(tauriMocks.createSnapshot).toHaveBeenCalledWith(
      '/vault',
      'Boards/test.canvas',
      JSON.stringify({
        nodes: [{ id: 'node-1', type: 'text', content: 'hello', position: { x: 0, y: 0 }, width: 100, height: 100 }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }, null, 2),
      'user-1',
      'User',
      undefined,
    );
  });

  it('opens a hosted canvas live session but only writes after hydration', async () => {
    const writeJson = vi.fn();
    liveMocks.openLiveJsonSession.mockResolvedValue({
      readJson: () => ({
        nodes: [{ id: 'node-1', type: 'text', content: 'server', position: { x: 0, y: 0 }, width: 100, height: 100 }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      writeJson,
      onChange: () => () => {},
      awareness: { setLocalStateField: vi.fn() },
      destroy: vi.fn(),
    });

    const baseOptions = {
      reactFlow: { setViewport: vi.fn() },
      vault: {
        kind: 'hosted' as const,
        id: 'hosted-vault',
        hostedVaultId: 'hosted-vault',
        serverUrl: 'https://collab.example.test',
        role: 'editor' as const,
        path: 'hosted://hosted-vault',
        name: 'Hosted',
        isEncrypted: false,
        lastOpened: 1,
      },
      relativePath: 'Boards/test.canvas',
      edges: [] as CanvasFlowEdge[],
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: vi.fn(),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      buildFlowNode: (canvas: { nodes: Array<{ id: string; content?: string; position: { x: number; y: number } }> }) => (
        canvas.nodes.map((node) => ({
          id: node.id,
          type: 'textCard',
          position: node.position,
          data: { title: 'Text', content: node.content ?? '' },
        })) as FlowNode<CanvasNodeData>[]
      ),
      toFlowEdge: (edge: unknown) => edge as never,
      fromFlowNode: vi.fn((node: FlowNode<CanvasNodeData>) => ({
        id: node.id,
        type: 'text' as const,
        content: node.data.content ?? '',
        position: node.position,
        width: 100,
        height: 100,
      })),
      fromFlowEdge: vi.fn((edge: CanvasFlowEdge) => edge as never),
      resetPreviewState: vi.fn(),
      markDirty: vi.fn(),
      markSaved: vi.fn(),
      setSavedHash: vi.fn(),
      addConflict: vi.fn(),
      myUserId: 'user-1',
      myUserName: 'User',
      isMountedRef: { current: true },
      isDirtyRef: { current: false },
      hashRef: { current: undefined as string | undefined },
      lastWriteRef: { current: 0 },
      markLoaded: vi.fn(),
      shouldSkipAutosave: () => true,
      markWriteStarted: vi.fn(),
      shouldCreateSnapshot: () => false,
      runExclusiveSave: (save: () => Promise<void>) => save(),
    };

    const { rerender } = renderHook(
      ({ nodes }: { nodes: FlowNode<CanvasNodeData>[] }) => useCanvasDocumentSession({
        ...baseOptions,
        nodes,
      }),
      { initialProps: { nodes: [] as FlowNode<CanvasNodeData>[] } },
    );

    // The hosted canvas now opens a live session (after the REST load resolves
    // the gate). Before the editor state has hydrated to match the server
    // snapshot, the initial (empty) React state must never be written.
    await waitFor(() => expect(liveMocks.openLiveJsonSession).toHaveBeenCalled());
    expect(writeJson).not.toHaveBeenCalled();

    const hydratedNode = {
      id: 'node-1',
      type: 'textCard',
      position: { x: 0, y: 0 },
      data: { title: 'Text', content: 'server' },
    } as FlowNode<CanvasNodeData>;
    // ReactFlow state now exactly matches the seeded snapshot: this clears the
    // hydration barrier but is not itself an edit, so still no write.
    rerender({ nodes: [hydratedNode] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(writeJson).not.toHaveBeenCalled();

    // A genuine post-hydration edit is pushed into the live doc.
    rerender({ nodes: [{ ...hydratedNode, data: { title: 'Text', content: 'edited' } }] });
    await waitFor(() => expect(writeJson).toHaveBeenCalledTimes(1));
  });

  it('publishes the selected node ids as ephemeral canvas awareness', async () => {
    const setLocalStateField = vi.fn();
    liveMocks.openLiveJsonSession.mockResolvedValue({
      readJson: () => ({
        nodes: [{ id: 'node-1', type: 'text', content: 'server', position: { x: 0, y: 0 }, width: 100, height: 100 }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      writeJson: vi.fn(),
      onChange: () => () => {},
      awareness: { setLocalStateField },
      destroy: vi.fn(),
    });

    const baseOptions = {
      reactFlow: { setViewport: vi.fn() },
      vault: {
        kind: 'hosted' as const,
        id: 'hosted-vault',
        hostedVaultId: 'hosted-vault',
        serverUrl: 'https://collab.example.test',
        role: 'editor' as const,
        path: 'hosted://hosted-vault',
        name: 'Hosted',
        isEncrypted: false,
        lastOpened: 1,
      },
      relativePath: 'Boards/test.canvas',
      edges: [] as CanvasFlowEdge[],
      viewport: { x: 0, y: 0, zoom: 1 },
      setViewport: vi.fn(),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      buildFlowNode: (canvas: { nodes: Array<{ id: string; content?: string; position: { x: number; y: number } }> }) => (
        canvas.nodes.map((node) => ({
          id: node.id,
          type: 'textCard',
          position: node.position,
          data: { title: 'Text', content: node.content ?? '' },
        })) as FlowNode<CanvasNodeData>[]
      ),
      toFlowEdge: (edge: unknown) => edge as never,
      fromFlowNode: vi.fn((node: FlowNode<CanvasNodeData>) => ({
        id: node.id,
        type: 'text' as const,
        content: node.data.content ?? '',
        position: node.position,
        width: 100,
        height: 100,
      })),
      fromFlowEdge: vi.fn((edge: CanvasFlowEdge) => edge as never),
      resetPreviewState: vi.fn(),
      markDirty: vi.fn(),
      markSaved: vi.fn(),
      setSavedHash: vi.fn(),
      addConflict: vi.fn(),
      myUserId: 'user-1',
      myUserName: 'User',
      isMountedRef: { current: true },
      isDirtyRef: { current: false },
      hashRef: { current: undefined as string | undefined },
      lastWriteRef: { current: 0 },
      markLoaded: vi.fn(),
      shouldSkipAutosave: () => true,
      markWriteStarted: vi.fn(),
      shouldCreateSnapshot: () => false,
      runExclusiveSave: (save: () => Promise<void>) => save(),
    };

    const { rerender } = renderHook(
      ({ nodes }: { nodes: FlowNode<CanvasNodeData>[] }) => useCanvasDocumentSession({
        ...baseOptions,
        nodes,
      }),
      { initialProps: { nodes: [] as FlowNode<CanvasNodeData>[] } },
    );

    await waitFor(() => expect(liveMocks.openLiveJsonSession).toHaveBeenCalled());
    // Identity + document context are published; an empty selection is not.
    await waitFor(() => expect(setLocalStateField).toHaveBeenCalledWith('document', { kind: 'canvas', relativePath: 'Boards/test.canvas' }));
    expect(setLocalStateField).not.toHaveBeenCalledWith('canvas', { selectedNodeIds: [] });

    // Selecting a node publishes it as ephemeral canvas awareness.
    rerender({
      nodes: [{
        id: 'node-1',
        type: 'textCard',
        position: { x: 0, y: 0 },
        selected: true,
        data: { title: 'Text', content: 'server' },
      } as FlowNode<CanvasNodeData>],
    });
    await waitFor(() => expect(setLocalStateField).toHaveBeenCalledWith('canvas', { selectedNodeIds: ['node-1'] }));
  });
});
