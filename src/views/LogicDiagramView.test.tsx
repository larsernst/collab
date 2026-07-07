import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../store/editorStore';
import { useDocumentStatusStore } from '../store/documentStatusStore';
import { useVaultStore } from '../store/vaultStore';

const logicEvents = vi.hoisted(() => ({
  fileModifiedHandler: null as null | ((event: { payload: { path: string } }) => void | Promise<void>),
}));

const tauriMocks = vi.hoisted(() => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, handler: (event: { payload: { path: string } }) => void | Promise<void>) => {
    if (eventName === 'vault:file-modified') logicEvents.fileModifiedHandler = handler;
    return () => {
      if (eventName === 'vault:file-modified') logicEvents.fileModifiedHandler = null;
    };
  }),
}));

vi.mock('../lib/tauri', () => ({
  tauriCommands: {
    readNote: tauriMocks.readNote,
    writeNote: tauriMocks.writeNote,
  },
}));

vi.mock('../lib/vaultReplica', () => ({
  onReplicaMutated: vi.fn(() => () => {}),
  replicaMutationAffectsPath: vi.fn(() => true),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

vi.mock('@xyflow/react', async () => {
  const react = await import('react');
  // Stable API object, mirroring real ReactFlow (whose useReactFlow return is
  // referentially stable across renders).
  const reactFlowApi = {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    fitView: vi.fn(async () => {}),
    setViewport: vi.fn(async () => {}),
  };
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ReactFlow: ({ children }: { children: React.ReactNode } & Record<string, unknown>) => (
      <div data-testid="react-flow">{children}</div>
    ),
    Background: () => null,
    BaseEdge: () => null,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    ConnectionMode: { Loose: 'loose' },
    BackgroundVariant: { Dots: 'dots' },
    getSmoothStepPath: () => ['', 0, 0],
    addEdge: vi.fn((edge, edges) => [...edges, edge]),
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = react.useState(initial);
      return [nodes, setNodes, vi.fn()] as const;
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = react.useState(initial);
      return [edges, setEdges, vi.fn()] as const;
    },
    useReactFlow: () => reactFlowApi,
  };
});

import LogicDiagramView from './LogicDiagramView';

const PATH = 'Diagrams/test.logic';

function logicDoc(kinds: string[]) {
  return JSON.stringify({
    schemaVersion: 1,
    kind: 'logic-diagram',
    title: 'test',
    nodes: kinds.map((kind, i) => ({ id: `g${i}`, kind, position: { x: i * 120, y: 0 } })),
    wires: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

function seedVault() {
  useVaultStore.setState({
    vault: { id: 'v1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: Date.now() },
  } as never);
  useEditorStore.setState({
    sessionVaultPath: '/vault',
    openTabs: [{ relativePath: PATH, title: 'test', isDirty: false, savedHash: null, type: 'logic' }],
    activeTabPath: PATH,
    forceReloadPath: null,
  } as never);
}

describe('LogicDiagramView safe reload policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logicEvents.fileModifiedHandler = null;
    seedVault();
    tauriMocks.writeNote.mockResolvedValue({ hash: 'v-write' });
  });

  afterEach(() => {
    cleanup();
    useDocumentStatusStore.setState({ statuses: {} });
  });

  it('auto-applies a clean external change from a watcher event', async () => {
    tauriMocks.readNote
      .mockResolvedValueOnce({ content: logicDoc([]), hash: 'v1', modifiedAt: 1 })
      .mockResolvedValueOnce({ content: logicDoc(['and']), hash: 'v2', modifiedAt: 2 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    await act(async () => {
      await logicEvents.fileModifiedHandler?.({ payload: { path: PATH } });
    });

    await waitFor(() => expect(screen.getByText(/1 gates/)).toBeTruthy());
  });

  it('preserves an unsaved local edit and queues the remote change while dirty', async () => {
    tauriMocks.readNote
      .mockResolvedValueOnce({ content: logicDoc([]), hash: 'v1', modifiedAt: 1 })
      .mockResolvedValue({ content: logicDoc(['and', 'or']), hash: 'v2', modifiedAt: 2 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    // Add a gate → the document is now dirty locally.
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(screen.getByText(/1 gates/)).toBeTruthy());

    // A remote change (2 gates) arrives while dirty: it must be queued, not applied.
    await act(async () => {
      await logicEvents.fileModifiedHandler?.({ payload: { path: PATH } });
    });

    // Local single-gate edit is preserved; the remote 2-gate state is not applied.
    expect(screen.getByText(/1 gates/)).toBeTruthy();
    await waitFor(() => {
      expect(useDocumentStatusStore.getState().statuses[PATH]?.status).toBe('remote-pending');
    });
  });

  it('ignores a stale watcher event whose version matches the loaded version', async () => {
    tauriMocks.readNote
      .mockResolvedValueOnce({ content: logicDoc([]), hash: 'v1', modifiedAt: 1 })
      // Same version token as the loaded doc → stale, must be ignored even though
      // the content differs.
      .mockResolvedValueOnce({ content: logicDoc(['and']), hash: 'v1', modifiedAt: 2 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    await act(async () => {
      await logicEvents.fileModifiedHandler?.({ payload: { path: PATH } });
    });

    expect(screen.getByText(/0 gates/)).toBeTruthy();
  });
});
