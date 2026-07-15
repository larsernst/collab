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
  createNote: vi.fn(),
  createFolder: vi.fn(),
  hostedVaultRequest: vi.fn(),
  listLogicComponents: vi.fn(),
  saveLogicComponent: vi.fn(),
  deleteLogicComponent: vi.fn(),
}));

const liveJsonMocks = vi.hoisted(() => ({
  useLiveJsonDocumentSession: vi.fn(() => null),
  writeJson: vi.fn(),
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
    createNote: tauriMocks.createNote,
    createFolder: tauriMocks.createFolder,
    hostedVaultRequest: tauriMocks.hostedVaultRequest,
    listLogicComponents: tauriMocks.listLogicComponents,
    saveLogicComponent: tauriMocks.saveLogicComponent,
    deleteLogicComponent: tauriMocks.deleteLogicComponent,
  },
}));

vi.mock('../lib/vaultReplica', () => ({
  emitReplicaMutated: vi.fn(),
  enqueuePendingOperation: vi.fn(),
  isLikelyConnectivityError: vi.fn(() => false),
  onReplicaMutated: vi.fn(() => () => {}),
  replicaMutationAffectsPath: vi.fn(() => true),
  readCachedReplicaManifest: vi.fn(async () => null),
  syncReplicaManifestDelta: vi.fn(async () => null),
  writeOptimisticReplicaManifest: vi.fn(),
}));

vi.mock('../lib/liveJsonDocument', () => ({
  useLiveJsonDocumentSession: liveJsonMocks.useLiveJsonDocumentSession,
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

function schematicDoc(kinds: string[]) {
  return JSON.stringify({
    schemaVersion: 3,
    kind: 'logic-diagram',
    diagramMode: 'schematic',
    title: 'test',
    nodes: kinds.map((kind, i) => ({ id: `s${i}`, kind, position: { x: i * 144, y: 0 } })),
    wires: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

function seedVault() {
  useVaultStore.setState({
    vault: { id: 'v1', path: '/vault', name: 'Vault', isEncrypted: false, lastOpened: Date.now() },
    fileTree: [],
    refreshFileTree: vi.fn(async () => {}),
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
    liveJsonMocks.useLiveJsonDocumentSession.mockReturnValue(null);
    logicEvents.fileModifiedHandler = null;
    seedVault();
    tauriMocks.writeNote.mockResolvedValue({ hash: 'v-write' });
    tauriMocks.createNote.mockResolvedValue({ relativePath: 'Pictures/test.svg', name: 'test.svg', isFolder: false, extension: 'svg' });
    tauriMocks.createFolder.mockResolvedValue(undefined);
    tauriMocks.hostedVaultRequest.mockReset();
    tauriMocks.listLogicComponents.mockResolvedValue([]);
    tauriMocks.saveLogicComponent.mockImplementation(async (_vaultPath, component) => component);
    tauriMocks.deleteLogicComponent.mockResolvedValue(undefined);
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

  it('writes local structural edits to the live JSON session instead of REST autosave', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({ content: logicDoc([]), hash: 'v1', modifiedAt: 1 });
    liveJsonMocks.useLiveJsonDocumentSession.mockReturnValue({
      writeJson: liveJsonMocks.writeJson,
      awareness: {
        clientID: 1,
        getStates: () => new Map(),
        on: vi.fn(),
        off: vi.fn(),
        setLocalStateField: vi.fn(),
      },
      getStatus: () => 'connected',
      onStatus: vi.fn(() => () => {}),
      discardOfflineState: vi.fn(),
      destroy: vi.fn(),
    } as never);

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(liveJsonMocks.writeJson).toHaveBeenCalled());
    expect(tauriMocks.writeNote).not.toHaveBeenCalled();
  });

  it('toggles an input node on the second pointer down of a double click', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({ content: logicDoc(['input']), hash: 'logic-v1', modifiedAt: 1 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/1 gates/)).toBeTruthy();

    const inputNode = screen
      .getAllByText('Input')
      .map((element) => element.closest('[data-logic-node]'))
      .find((element): element is HTMLElement => element instanceof HTMLElement);

    if (!inputNode) throw new Error('Expected rendered input node.');
    const inputNodeSurface = inputNode.firstElementChild;
    if (!(inputNodeSurface instanceof HTMLElement)) throw new Error('Expected rendered input node surface.');
    expect(inputNode.textContent).toContain('unset');
    fireEvent.mouseDown(inputNodeSurface, { button: 0, detail: 2 });

    await waitFor(() => expect(inputNode.textContent).toContain('1'));
  });

  it('renders electronic schematics as static symbols', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({
      content: schematicDoc(['voltage-source', 'resistor', 'ground']),
      hash: 'schematic-v1',
      modifiedAt: 1,
    });

    render(<LogicDiagramView relativePath={PATH} />);

    expect(await screen.findByText(/3 symbols/)).toBeTruthy();
    expect(screen.getByText('Voltage source')).toBeTruthy();
    expect(screen.getAllByText('Resistor').length).toBeGreaterThan(0);
    expect(screen.queryByText(/unset/)).toBeNull();
  });

  it('exports the current diagram SVG and appends it to an open note', async () => {
    useEditorStore.setState({
      openTabs: [
        { relativePath: PATH, title: 'test', isDirty: false, savedHash: null, type: 'logic' },
        { relativePath: 'Notes/target.md', title: 'target', isDirty: false, savedHash: 'note-v1', type: 'note' },
      ],
      activeTabPath: PATH,
    } as never);
    tauriMocks.readNote
      .mockResolvedValueOnce({ content: logicDoc(['input', 'and']), hash: 'logic-v1', modifiedAt: 1 })
      .mockRejectedValueOnce(new Error('missing svg'))
      .mockResolvedValueOnce({ content: '# Target\n', hash: 'note-v1', modifiedAt: 2 });
    tauriMocks.writeNote.mockResolvedValue({ hash: 'note-v2' });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/2 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /insert in note/i }));

    await waitFor(() => expect(tauriMocks.writeNote).toHaveBeenCalledWith(
      '/vault',
      'Pictures/test.svg',
      expect.stringContaining('<svg'),
      undefined,
      undefined,
    ));
    expect(tauriMocks.createFolder).toHaveBeenCalledWith('/vault', 'Pictures');
    await waitFor(() => expect(tauriMocks.writeNote).toHaveBeenCalledWith(
      '/vault',
      'Notes/target.md',
      expect.stringContaining('![test](../Pictures/test.svg)'),
      'note-v1',
      '# Target\n',
    ));
    expect(useEditorStore.getState().forceReloadPath).toBe('Notes/target.md');
  });

  it('uses a unique image export when inserting with shift-click', async () => {
    useVaultStore.setState({
      fileTree: [
        {
          name: 'Pictures',
          relativePath: 'Pictures',
          isFolder: true,
          children: [{ name: 'test.svg', relativePath: 'Pictures/test.svg', isFolder: false, extension: 'svg' }],
        },
      ],
    } as never);
    useEditorStore.setState({
      openTabs: [
        { relativePath: PATH, title: 'test', isDirty: false, savedHash: null, type: 'logic' },
        { relativePath: 'Notes/target.md', title: 'target', isDirty: false, savedHash: 'note-v1', type: 'note' },
      ],
      activeTabPath: PATH,
    } as never);
    tauriMocks.readNote
      .mockResolvedValueOnce({ content: logicDoc(['input']), hash: 'logic-v1', modifiedAt: 1 })
      .mockRejectedValueOnce(new Error('missing svg'))
      .mockResolvedValueOnce({ content: '', hash: 'note-v1', modifiedAt: 2 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/1 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /insert in note/i }), { shiftKey: true });

    await waitFor(() => expect(tauriMocks.writeNote).toHaveBeenCalledWith(
      '/vault',
      'Pictures/test-2.svg',
      expect.stringContaining('<svg'),
      undefined,
      undefined,
    ));
  });

  it('keeps templates as node-collection insertion', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({ content: logicDoc([]), hash: 'logic-v1', modifiedAt: 1 });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /templates/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Half-Adder/i }));

    await waitFor(() => expect(screen.getByText(/6 gates/)).toBeTruthy());
    expect(screen.getByText(/0 components/)).toBeTruthy();
  });

  it('saves the whole logic file as a component when no nodes are selected', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({
      content: JSON.stringify({
        schemaVersion: 1,
        kind: 'logic-diagram',
        title: 'Adder',
        nodes: [
          { id: 'a', kind: 'input', label: 'A', position: { x: 0, y: 0 } },
          { id: 'sum', kind: 'output', label: 'Sum', position: { x: 220, y: 0 } },
        ],
        wires: [{ id: 'a-sum', source: 'a', target: 'sum', sourceHandle: 'out', targetHandle: 'in' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      hash: 'logic-v1',
      modifiedAt: 1,
    });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/2 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^save component$/i }));
    const saveComponentButtons = screen.getAllByRole('button', { name: /^save component$/i });
    fireEvent.click(saveComponentButtons[saveComponentButtons.length - 1]);

    await waitFor(() => expect(tauriMocks.saveLogicComponent).toHaveBeenCalledWith(
      '/vault',
      expect.objectContaining({
        name: 'test',
        ports: expect.arrayContaining([
          expect.objectContaining({ direction: 'input', label: 'A' }),
          expect.objectContaining({ direction: 'output', label: 'Sum' }),
        ]),
      }),
    ));
  });

  it('inserts saved components as component nodes', async () => {
    tauriMocks.readNote.mockResolvedValueOnce({ content: logicDoc([]), hash: 'logic-v1', modifiedAt: 1 });
    tauriMocks.listLogicComponents.mockResolvedValue([{
      id: 'component-1',
      name: 'Reusable Inverter',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      ports: [
        { id: 'in', direction: 'input', label: 'In', sourceNodeId: 'in' },
        { id: 'out', direction: 'output', label: 'Out', sourceNodeId: 'out' },
      ],
      nodes: [
        { id: 'in', kind: 'input', position: { x: 0, y: 0 } },
        { id: 'not', kind: 'not', position: { x: 120, y: 0 } },
        { id: 'out', kind: 'output', position: { x: 240, y: 0 } },
      ],
      wires: [
        { id: 'in-not', source: 'in', target: 'not', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'not-out', source: 'not', target: 'out', sourceHandle: 'out', targetHandle: 'in' },
      ],
    }]);

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /components/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Reusable Inverter/i }));

    await waitFor(() => expect(screen.getByText(/1 components/)).toBeTruthy());
  });

  it('loads and inserts hosted vault components through the server library', async () => {
    const hostedFile = {
      id: 'file-logic',
      parentId: null,
      name: 'test.logic',
      relativePath: PATH,
      kind: 'document',
      documentType: 'logic',
      state: 'active',
      currentRevision: {
        id: 'revision-1',
        sequence: 1,
        contentHash: 'hash-1',
        sizeBytes: 0,
        createdByDisplayName: 'Test User',
        createdAt: '2026-07-14T08:00:00Z',
      },
      createdAt: '2026-07-14T08:00:00Z',
      updatedAt: '2026-07-14T08:00:00Z',
    };
    const component = {
      id: 'component-1',
      name: 'Hosted Inverter',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      ports: [
        { id: 'in', direction: 'input', label: 'In', sourceNodeId: 'in' },
        { id: 'out', direction: 'output', label: 'Out', sourceNodeId: 'out' },
      ],
      nodes: [
        { id: 'in', kind: 'input', position: { x: 0, y: 0 } },
        { id: 'not', kind: 'not', position: { x: 120, y: 0 } },
        { id: 'out', kind: 'output', position: { x: 240, y: 0 } },
      ],
      wires: [
        { id: 'in-not', source: 'in', target: 'not', sourceHandle: 'out', targetHandle: 'in' },
        { id: 'not-out', source: 'not', target: 'out', sourceHandle: 'out', targetHandle: 'in' },
      ],
    };
    useVaultStore.setState({
      vault: {
        kind: 'hosted',
        id: 'hosted-vault',
        hostedVaultId: 'hosted-vault',
        serverUrl: 'https://collab.example.test',
        role: 'editor',
        name: 'Hosted Vault',
        path: 'hosted://hosted-vault',
        lastOpened: Date.now(),
        isEncrypted: false,
        capabilities: ['vault.read', 'file.write'],
      },
    } as never);
    tauriMocks.hostedVaultRequest.mockImplementation(async (_serverUrl, method, path) => {
      if (method === 'GET' && path.endsWith('/manifest')) {
        return { vaultId: 'hosted-vault', sequence: 1, files: [hostedFile] };
      }
      if (method === 'GET' && path.endsWith('/files/file-logic')) {
        return { file: hostedFile, content: logicDoc([]) };
      }
      if (method === 'GET' && path.endsWith('/logic-components')) {
        return [component];
      }
      throw new Error(`unexpected hosted request: ${method} ${path}`);
    });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /components/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Hosted Inverter/i }));

    await waitFor(() => expect(screen.getByText(/1 components/)).toBeTruthy());
    expect(tauriMocks.hostedVaultRequest).toHaveBeenCalledWith(
      'https://collab.example.test',
      'GET',
      '/api/v1/vaults/hosted-vault/logic-components',
      undefined,
    );
  });

  it('disables authoring controls and shortcuts for hosted viewers', async () => {
    const hostedFile = {
      id: 'file-logic',
      parentId: null,
      name: 'test.logic',
      relativePath: PATH,
      kind: 'document',
      documentType: 'logic',
      state: 'active',
      currentRevision: {
        id: 'revision-1',
        sequence: 1,
        contentHash: 'hash-1',
        sizeBytes: 0,
        createdByDisplayName: 'Test User',
        createdAt: '2026-07-14T08:00:00Z',
      },
      createdAt: '2026-07-14T08:00:00Z',
      updatedAt: '2026-07-14T08:00:00Z',
    };
    useVaultStore.setState({
      vault: {
        kind: 'hosted',
        id: 'hosted-vault',
        hostedVaultId: 'hosted-vault',
        serverUrl: 'https://collab.example.test',
        role: 'viewer',
        name: 'Hosted Vault',
        path: 'hosted://hosted-vault',
        lastOpened: Date.now(),
        isEncrypted: false,
        capabilities: ['vault.read'],
      },
    } as never);
    tauriMocks.hostedVaultRequest.mockImplementation(async (_serverUrl, method, path) => {
      if (method === 'GET' && path.endsWith('/manifest')) {
        return { vaultId: 'hosted-vault', sequence: 1, files: [hostedFile] };
      }
      if (method === 'GET' && path.endsWith('/files/file-logic')) {
        return { file: hostedFile, content: logicDoc([]) };
      }
      if (method === 'GET' && path.endsWith('/logic-components')) {
        return [];
      }
      throw new Error(`unexpected hosted request: ${method} ${path}`);
    });

    render(<LogicDiagramView relativePath={PATH} />);
    expect(await screen.findByText(/0 gates/)).toBeTruthy();

    const addButton = screen.getByRole('button', { name: /^add$/i });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(addButton);
    fireEvent.keyDown(document, { key: 'a' });

    expect(screen.getByText(/0 gates/)).toBeTruthy();
    expect(tauriMocks.writeNote).not.toHaveBeenCalled();
  });
});
