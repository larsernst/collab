import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import {
  ReactFlow,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Panel,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type OnReconnect,
  type Viewport,
} from '@xyflow/react';
import {
  Layout,
} from 'lucide-react';
import { nodeTypes, type CanvasNodeData } from '../components/canvas/CanvasNodeTypes';
import {
  DEFAULT_CANVAS_EDGE_STYLE,
  edgeTypes,
  fromFlowEdge,
  getCanvasEdgeData,
  StackedConnectionLine,
  toFlowEdge,
  type CanvasFlowEdge,
} from '../components/canvas/CanvasEdgeTypes';
import { CanvasEdgeInspector } from '../components/canvas/CanvasEdgeInspector';
import { fromFlowNode, toFlowNode } from '../components/canvas/CanvasFlowNodeUtils';
import { CanvasNodeInspector } from '../components/canvas/CanvasNodeInspector';
import { CanvasInsertMenu } from '../components/canvas/CanvasInsertMenu';
import { useCanvasDocumentSession } from '../components/canvas/useCanvasDocumentSession';
import { CanvasToolbar } from '../components/canvas/CanvasToolbar';
import { CanvasPickerDialog, type CanvasPickerMode } from '../components/canvas/CanvasPickerDialog';
import { CanvasSymbolPickerDialog, type CanvasSymbolChoice } from '../components/canvas/CanvasSymbolPickerDialog';
import { useCanvasNodeCommands } from '../components/canvas/useCanvasNodeCommands';
import type { PendingAutoConnect } from '../components/canvas/useCanvasNodeCommands';
import { useCanvasPreviews } from '../components/canvas/useCanvasPreviews';
import { useCanvasViewportControls } from '../components/canvas/useCanvasViewportControls';
import {
  createSplitJunctionNode,
  mergeSingleJunction,
  splitEdgeWithJunction,
} from '../components/canvas/canvasDiagramUtils';
import { isPlanningNodeType } from '../components/canvas/canvasPlanning';
import type { CanvasInsertItem } from '../components/canvas/canvasInsertItems';
import {
  getBaseName,
  getPreviewKey,
  isImageExtension,
} from '../components/canvas/CanvasPreviewUtils';
import {
  DocumentTopBar,
  getDocumentBaseName,
  getDocumentFolderPath,
} from '../components/layout/DocumentTopBar';
import { useEditorStore } from '../store/editorStore';
import { useUiStore } from '../store/uiStore';
import { useVaultStore } from '../store/vaultStore';
import { useCollabStore } from '../store/collabStore';
import type {
  CanvasData,
  CanvasEdge,
  CanvasEdgeLineStyle,
  CanvasEdgeRoutingStyle,
  CanvasNode,
  CanvasPlanningMetadata,
  CanvasSymbolDefinition,
  CanvasSwimlaneOrientation,
  PlanningCanvasNode,
} from '../types/canvas';
import type { NoteFile } from '../types/vault';
import { useDocumentSessionState } from '../lib/documentSession';
import type { OnConnectStartParams, FinalConnectionState } from '@xyflow/react';

const pdfWorkerUrl = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const CANVAS_GRID = 24;
const EMPTY_CANVAS: CanvasData = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

interface SymbolPickerState {
  open: boolean;
  mode: 'insert' | 'edit';
  position: { x: number; y: number } | null;
}

function flattenFiles(nodes: NoteFile[]): NoteFile[] {
  const flattened: NoteFile[] = [];
  for (const node of nodes) {
    flattened.push(node);
    if (node.children?.length) {
      flattened.push(...flattenFiles(node.children));
    }
  }
  return flattened;
}

function getNameWithoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function snapValue(value: number, grid = CANVAS_GRID) {
  return Math.round(value / grid) * grid;
}

function snapSize(value: number, minimum: number, grid = CANVAS_GRID) {
  return Math.max(minimum, snapValue(value, grid));
}

function snapPosition(position: { x: number; y: number }, grid = CANVAS_GRID) {
  return {
    x: snapValue(position.x, grid),
    y: snapValue(position.y, grid),
  };
}

function getMinimumCanvasNodeSize(type: CanvasNode['type']) {
  if (type === 'text') return { width: 200, height: 120 };
  if (type === 'symbol') return { width: 140, height: 140 };
  return { width: 220, height: 140 };
}

function getHandleSide(handleId?: string | null) {
  if (!handleId) return null;
  if (handleId.startsWith('right')) return 'right';
  if (handleId.startsWith('bottom')) return 'bottom';
  if (handleId.startsWith('left')) return 'left';
  if (handleId.startsWith('top')) return 'top';
  return null;
}

function getHandleDatasetFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;
  const handleEl = target.closest('[data-nodeid][data-handleid]');
  if (!(handleEl instanceof HTMLElement)) return null;

  const nodeId = handleEl.dataset.nodeid;
  const handleId = handleEl.dataset.handleid;
  if (!nodeId) return null;

  return {
    nodeId,
    handleId: handleId ?? undefined,
  };
}

function isAltModifiedEvent(event: unknown) {
  return !!event && typeof event === 'object' && 'altKey' in event && !!(event as { altKey?: boolean }).altKey;
}

function logAutoConnect(stage: string, details: Record<string, unknown>) {
  console.debug(`[canvas-auto-connect] ${stage}`, details);
}

interface CanvasInsertSession {
  flowPosition: { x: number; y: number };
  autoConnect: PendingAutoConnect | null;
}

function getAutoConnectTargetHandle(sourceSide?: string | null) {
  if (sourceSide === 'bottom') return 'top-in';
  return 'left-in';
}

function getAutoConnectHandles({
  sourceNode,
  targetPosition,
  sourceHandle,
  sourceSide,
}: {
  sourceNode?: FlowNode<CanvasNodeData>;
  targetPosition: { x: number; y: number };
  sourceHandle?: string;
  sourceSide?: string | null;
}) {
  if (!sourceNode) {
    return {
      sourceHandle,
      targetHandle: getAutoConnectTargetHandle(sourceSide),
    };
  }

  const sourceWidth = typeof sourceNode.width === 'number'
    ? sourceNode.width
    : typeof sourceNode.measured?.width === 'number'
      ? sourceNode.measured.width
      : typeof sourceNode.style?.width === 'number'
        ? sourceNode.style.width
        : 300;
  const sourceHeight = typeof sourceNode.height === 'number'
    ? sourceNode.height
    : typeof sourceNode.measured?.height === 'number'
      ? sourceNode.measured.height
      : typeof sourceNode.style?.height === 'number'
        ? sourceNode.style.height
        : 180;
  const sourceCenterX = sourceNode.position.x + sourceWidth / 2;
  const sourceCenterY = sourceNode.position.y + sourceHeight / 2;
  const deltaX = targetPosition.x - sourceCenterX;
  const deltaY = targetPosition.y - sourceCenterY;

  if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY >= 0) {
    return {
      sourceHandle: sourceSide === 'right' ? 'bottom-out' : (sourceHandle ?? 'bottom-out'),
      targetHandle: 'top-in',
    };
  }

  return {
    sourceHandle: sourceSide === 'bottom' ? 'right-out' : (sourceHandle ?? 'right-out'),
    targetHandle: 'left-in',
  };
}

function getAutoConnectEdge({
  pendingAutoConnect,
  existingNode,
  newNode,
}: {
  pendingAutoConnect: PendingAutoConnect;
  existingNode?: FlowNode<CanvasNodeData>;
  newNode: CanvasNode;
}): CanvasEdge {
  if (pendingAutoConnect.handleType === 'target') {
    return {
      id: crypto.randomUUID(),
      source: newNode.id,
      sourceHandle: pendingAutoConnect.sourceSide === 'top' ? 'bottom-out' : 'right-out',
      target: pendingAutoConnect.source,
      targetHandle: pendingAutoConnect.sourceHandle ?? (pendingAutoConnect.sourceSide === 'top' ? 'top-in' : 'left-in'),
      lineStyle: 'solid',
      routingStyle: 'curved',
      animated: false,
      animationReverse: false,
      markerStart: false,
      markerEnd: true,
    };
  }

  const autoConnectHandles = getAutoConnectHandles({
    sourceNode: existingNode,
    targetPosition: newNode.position,
    sourceHandle: pendingAutoConnect.sourceHandle,
    sourceSide: pendingAutoConnect.sourceSide,
  });

  return {
    id: crypto.randomUUID(),
    source: pendingAutoConnect.source,
    sourceHandle: autoConnectHandles.sourceHandle,
    target: newNode.id,
    targetHandle: autoConnectHandles.targetHandle,
    lineStyle: 'solid',
    routingStyle: 'curved',
    animated: false,
    animationReverse: false,
    markerStart: false,
    markerEnd: true,
  };
}

function dataUrlToUint8Array(dataUrl: string) {
  const [, encoded = ''] = dataUrl.split(',', 2);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function renderPdfPreview(dataUrl: string) {
  const task = getDocument({ data: dataUrlToUint8Array(dataUrl) });
  const pdf = await task.promise;

  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = 520;
    const scale = Math.min(1.2, maxWidth / Math.max(baseViewport.width, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Failed to get PDF preview canvas context');

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    return canvas.toDataURL('image/png');
  } finally {
    await pdf.destroy().catch(() => {});
  }
}


function CanvasBoard({ relativePath }: { relativePath: string | null }) {
  const { vault, fileTree } = useVaultStore();
  const { openTab, markDirty, markSaved, setSavedHash } = useEditorStore();
  const { addConflict, myUserId, myUserName } = useCollabStore();
  const {
    setActiveView,
    canvasWebCardDefaultMode,
    canvasWebCardAutoLoad,
    webPreviewsEnabled,
    hoverWebLinkPreviewsEnabled,
    backgroundWebPreviewPrefetchEnabled,
  } = useUiStore();
  const reactFlow = useReactFlow<FlowNode<CanvasNodeData>, CanvasFlowEdge>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const isDirtyRef = useRef(false);
  const [nodes, setNodes] = useNodesState<FlowNode<CanvasNodeData>>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<CanvasFlowEdge>([]);
  const [viewport, setViewport] = useState(EMPTY_CANVAS.viewport);
  const [pickerMode, setPickerMode] = useState<CanvasPickerMode>(null);
  const [symbolPickerState, setSymbolPickerState] = useState<SymbolPickerState>({
    open: false,
    mode: 'insert',
    position: null,
  });
  const [edgeLabelDraft, setEdgeLabelDraft] = useState('');
  const [insertSession, setInsertSession] = useState<CanvasInsertSession | null>(null);
  const [insertMenuState, setInsertMenuState] = useState<{
    open: boolean;
    x: number;
    y: number;
    flowPosition: { x: number; y: number };
  }>({
    open: false,
    x: 0,
    y: 0,
    flowPosition: { x: 0, y: 0 },
  });
  const { hashRef, lastWriteRef, markLoaded, shouldSkipAutosave, markWriteStarted, shouldCreateSnapshot } = useDocumentSessionState();
  const pendingAutoConnectRef = useRef<PendingAutoConnect | null>(null);
  const duplicateDragSessionRef = useRef<{
    nodeIds: string[];
    originalPositions: Map<string, { x: number; y: number }>;
    duplicateNodes: CanvasNode[];
    duplicateEdges: CanvasEdge[];
  } | null>(null);

  const allFiles = useMemo(() => flattenFiles(fileTree).filter((node) => !node.isFolder), [fileTree]);
  const availableNotes = useMemo(() => allFiles.filter((file) => file.extension.toLowerCase() === 'md'), [allFiles]);
  const availableFiles = useMemo(() => allFiles.filter((file) => file.extension.toLowerCase() !== 'md'), [allFiles]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.selected), [edges]);
  const selectedNode = useMemo(() => nodes.find((node) => node.selected), [nodes]);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const zoomLabel = `${Math.round(viewport.zoom * 100)}%`;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const openRelativePath = useCallback((path: string) => {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const type = isImageExtension(extension)
      ? 'image'
      : extension === 'pdf'
      ? 'pdf'
      : extension === 'canvas'
      ? 'canvas'
      : extension === 'kanban'
      ? 'kanban'
      : 'note';
    openTab(path, getNameWithoutExtension(getBaseName(path)), type);
    if (type === 'canvas') setActiveView('canvas');
    else if (type === 'kanban') setActiveView('kanban');
    else setActiveView('editor');
  }, [openTab, setActiveView]);

  const updateTextContent = useCallback((nodeId: string, content: string) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: { ...node.data, content },
            }
          : node,
      ),
    );
  }, [setNodes]);

  const {
    openExternalUrl,
    previews,
    requestWebPreview,
    resetPreviewState,
    updateWebDisplayModeOverride,
    updateWebUrl,
  } = useCanvasPreviews({
    vault,
    nodes,
    setNodes,
    isMountedRef,
    fromFlowNode,
    renderPdfPreview,
    openRelativePath,
    canvasWebCardDefaultMode,
    canvasWebCardAutoLoad,
    webPreviewsEnabled,
    hoverWebLinkPreviewsEnabled,
    backgroundWebPreviewPrefetchEnabled,
  });

  const snapNodeToGrid = useCallback((nodeId: string) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const minWidth = node.type === 'textCard' ? 200 : 220;
        const minHeight = node.type === 'textCard' ? 120 : 140;
        return {
          ...node,
          position: snapPosition(node.position),
          width: typeof node.width === 'number' ? snapSize(node.width, minWidth) : node.width,
          height: typeof node.height === 'number' ? snapSize(node.height, minHeight) : node.height,
          style: {
            ...node.style,
            width: snapSize(
              typeof node.width === 'number'
                ? node.width
                : typeof node.style?.width === 'number'
                ? node.style.width
                : minWidth,
              minWidth,
            ),
            height: snapSize(
              typeof node.height === 'number'
                ? node.height
                : typeof node.style?.height === 'number'
                ? node.style.height
                : minHeight,
              minHeight,
            ),
          },
        };
      }),
    );
  }, [setNodes]);

  const buildFlowNodes = useCallback((canvas: CanvasData) => (
    canvas.nodes.map((node) => toFlowNode(node, undefined, {
      onOpen: openRelativePath,
      onTextChange: updateTextContent,
      onSnapToGrid: snapNodeToGrid,
      onWebUrlChange: updateWebUrl,
      onWebDisplayModeOverrideChange: updateWebDisplayModeOverride,
      onRequestWebPreview: requestWebPreview,
      onOpenUrl: openExternalUrl,
    }, canvasWebCardDefaultMode, canvasWebCardAutoLoad, webPreviewsEnabled))
  ), [
    canvasWebCardAutoLoad,
    canvasWebCardDefaultMode,
    openExternalUrl,
    openRelativePath,
    requestWebPreview,
    snapNodeToGrid,
    updateTextContent,
    updateWebDisplayModeOverride,
    updateWebUrl,
    webPreviewsEnabled,
  ]);

  const createInteractiveFlowNode = useCallback((node: CanvasNode) => (
    toFlowNode(node, previews[getPreviewKey(node)], {
      onOpen: openRelativePath,
      onTextChange: updateTextContent,
      onSnapToGrid: snapNodeToGrid,
      onWebUrlChange: updateWebUrl,
      onWebDisplayModeOverrideChange: updateWebDisplayModeOverride,
      onRequestWebPreview: requestWebPreview,
      onOpenUrl: openExternalUrl,
    }, canvasWebCardDefaultMode, canvasWebCardAutoLoad, webPreviewsEnabled)
  ), [
    canvasWebCardAutoLoad,
    canvasWebCardDefaultMode,
    openExternalUrl,
    openRelativePath,
    previews,
    requestWebPreview,
    snapNodeToGrid,
    updateTextContent,
    updateWebDisplayModeOverride,
    updateWebUrl,
    webPreviewsEnabled,
  ]);

  useCanvasDocumentSession({
    reactFlow,
    vault,
    relativePath,
    nodes,
    edges,
    viewport,
    setViewport,
    setNodes,
    setEdges,
    buildFlowNode: buildFlowNodes,
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
    markWriteStarted,
    shouldCreateSnapshot,
  });

  useEffect(() => {
    setEdgeLabelDraft(selectedEdge?.data?.label ?? '');
  }, [selectedEdge?.id]);

  const addCanvasNode = useCallback((node: CanvasNode, pendingAutoConnectOverride?: PendingAutoConnect | null) => {
    const minimumSize = getMinimumCanvasNodeSize(node.type);
    const snappedNode: CanvasNode = {
      ...node,
      position: snapPosition(node.position),
      width: snapSize(node.width, minimumSize.width),
      height: snapSize(node.height, minimumSize.height),
    };
    logAutoConnect('add-node', {
      node: snappedNode,
      pendingAutoConnectOverride,
      pendingAutoConnectRef: pendingAutoConnectRef.current,
    });
    setNodes((prev) => [...prev, createInteractiveFlowNode(snappedNode)]);
    const pendingAutoConnect = pendingAutoConnectOverride ?? pendingAutoConnectRef.current;
    if (pendingAutoConnect) {
      const sourceNode = nodes.find((candidate) => candidate.id === pendingAutoConnect.source);
      const nextEdge = getAutoConnectEdge({
        pendingAutoConnect,
        existingNode: sourceNode,
        newNode: snappedNode,
      });
      logAutoConnect('queue-edge', {
        pendingAutoConnect,
        sourceNode: sourceNode ? {
          id: sourceNode.id,
          position: sourceNode.position,
          width: sourceNode.width ?? sourceNode.measured?.width ?? sourceNode.style?.width,
          height: sourceNode.height ?? sourceNode.measured?.height ?? sourceNode.style?.height,
        } : null,
        targetNode: {
          id: snappedNode.id,
          position: snappedNode.position,
        },
        nextEdge,
      });
      setEdges((prev) => [...prev, toFlowEdge(nextEdge)]);
      if (!pendingAutoConnectOverride || pendingAutoConnectRef.current === pendingAutoConnectOverride) {
        pendingAutoConnectRef.current = null;
      }
    }
  }, [createInteractiveFlowNode, nodes, openExternalUrl, openRelativePath, previews, requestWebPreview, setEdges, setNodes]);

  const addCanvasNodes = useCallback((newNodes: CanvasNode[]) => {
    setNodes((prev) => [
      ...prev,
      ...newNodes.map((node) => {
        const minimumSize = getMinimumCanvasNodeSize(node.type);
        return createInteractiveFlowNode({
          ...node,
          position: snapPosition(node.position),
          width: snapSize(node.width, minimumSize.width),
          height: snapSize(node.height, minimumSize.height),
        });
      }),
    ]);
  }, [createInteractiveFlowNode, setNodes]);

  const addCanvasEdges = useCallback((newEdges: CanvasEdge[]) => {
    setEdges((prev) => [...prev, ...newEdges.map((edge) => toFlowEdge(edge))]);
  }, [setEdges]);

  const duplicateSelectedCanvasNodes = useCallback((
    positionOverrides?: Map<string, { x: number; y: number }>,
    sourceCanvasNodesOverride?: CanvasNode[],
    sourceEdgesOverride?: CanvasEdge[],
  ) => {
    const sourceCanvasNodes = sourceCanvasNodesOverride ?? (
      selectedNodes.length > 0
        ? selectedNodes.map(fromFlowNode)
        : selectedNode
        ? [fromFlowNode(selectedNode)]
        : []
    );
    if (sourceCanvasNodes.length === 0) return;

    const sourceNodeIds = new Set(sourceCanvasNodes.map((node) => node.id));
    const nodeIdMap = new Map(sourceCanvasNodes.map((node) => [node.id, crypto.randomUUID()]));
    const duplicatedNodes = sourceCanvasNodes.map((node) => {
      const minimumSize = getMinimumCanvasNodeSize(node.type);
      const nextPosition = positionOverrides?.get(node.id) ?? {
        x: node.position.x + CANVAS_GRID * 2,
        y: node.position.y + CANVAS_GRID * 2,
      };
      return {
        ...node,
        id: nodeIdMap.get(node.id) ?? crypto.randomUUID(),
        position: snapPosition(nextPosition),
        width: snapSize(node.width, minimumSize.width),
        height: snapSize(node.height, minimumSize.height),
      } satisfies CanvasNode;
    });

    const duplicatedEdges = (sourceEdgesOverride ?? edges.map(fromFlowEdge))
      .filter((edge) => sourceNodeIds.has(edge.source) && sourceNodeIds.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        source: nodeIdMap.get(edge.source) ?? edge.source,
        target: nodeIdMap.get(edge.target) ?? edge.target,
      }));

    setNodes((prev) => [
      ...prev.map((node) => ({ ...node, selected: false })),
      ...duplicatedNodes.map((node) => ({ ...createInteractiveFlowNode(node), selected: true })),
    ]);
    if (duplicatedEdges.length > 0) {
      setEdges((prev) => [
        ...prev.map((edge) => ({ ...edge, selected: false })),
        ...duplicatedEdges.map((edge) => toFlowEdge(edge)),
      ]);
    } else {
      setEdges((prev) => prev.map((edge) => ({ ...edge, selected: false })));
    }
  }, [createInteractiveFlowNode, edges, selectedNode, selectedNodes, setEdges, setNodes]);

  const {
    addTextNode,
    addTextNodeAt,
    addWebNode,
    addWebNodeAt,
    addSymbolNodeAt,
    addPlanningNode,
    applyPlanningPreset,
    addPlanningNodeAt,
    handleDropOnCanvas,
    handlePickerSelect,
  } = useCanvasNodeCommands({
    reactFlow,
    viewportRef,
    pickerMode,
    setPickerMode,
    pickerInsertPosition: insertSession?.flowPosition ?? null,
    allFiles,
    addCanvasNode,
    addCanvasNodes,
    addCanvasEdges,
  });

  const handleConnect = useCallback((connection: Connection) => {
    setEdges((prev) => [
      ...prev,
      toFlowEdge({
        ...connection,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        id: crypto.randomUUID(),
        label: undefined,
        lineStyle: 'solid',
        routingStyle: 'curved',
        animated: false,
        animationReverse: false,
        markerStart: false,
        markerEnd: false,
      }),
    ]);
  }, [setEdges]);

  const handleConnectStart = useCallback((event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    const eventTarget = 'target' in event ? event.target : null;
    const datasetHandle = getHandleDatasetFromEventTarget(eventTarget);
    const sourceNodeId = params.nodeId ?? datasetHandle?.nodeId ?? null;
    const sourceHandleId = params.handleId ?? datasetHandle?.handleId;

    pendingAutoConnectRef.current = sourceNodeId
      ? {
          source: sourceNodeId,
          sourceHandle: sourceHandleId ?? undefined,
          sourceSide: getHandleSide(sourceHandleId),
          handleType: params.handleType ?? (sourceHandleId?.endsWith('-in') ? 'target' : 'source'),
        }
      : null;
    logAutoConnect('connect-start', {
      params,
      datasetHandle,
      pendingAutoConnect: pendingAutoConnectRef.current,
    });
  }, []);

  const openInsertMenuAt = useCallback((clientX: number, clientY: number, autoConnect?: PendingAutoConnect | null) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const flowPosition = reactFlow.screenToFlowPosition({ x: clientX, y: clientY });
    setInsertMenuState({
      open: true,
      x: rect ? Math.min(clientX - rect.left, rect.width - 332) : clientX,
      y: rect ? Math.min(clientY - rect.top, rect.height - 340) : clientY,
      flowPosition,
    });
    setInsertSession({
      flowPosition,
      autoConnect: autoConnect ?? null,
    });
  }, [reactFlow]);

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    logAutoConnect('connect-end-initial', {
      connectionState,
      pendingAutoConnect: pendingAutoConnectRef.current,
    });
    if (connectionState.toNode) {
      pendingAutoConnectRef.current = null;
      logAutoConnect('connect-end-to-node', {
        connectionState,
      });
      return;
    }

    if (!pendingAutoConnectRef.current) {
      const sourceNodeId = 'fromHandle' in connectionState
        && connectionState.fromHandle
        && typeof connectionState.fromHandle === 'object'
        && 'nodeId' in connectionState.fromHandle
        && typeof connectionState.fromHandle.nodeId === 'string'
        ? connectionState.fromHandle.nodeId
        : 'fromNode' in connectionState && connectionState.fromNode && typeof connectionState.fromNode === 'object' && 'id' in connectionState.fromNode
        ? String(connectionState.fromNode.id)
        : null;
      const sourceHandleId = 'fromHandle' in connectionState && connectionState.fromHandle && typeof connectionState.fromHandle === 'object' && 'id' in connectionState.fromHandle && typeof connectionState.fromHandle.id === 'string'
        ? connectionState.fromHandle.id
        : undefined;

      if (sourceNodeId) {
        pendingAutoConnectRef.current = {
          source: sourceNodeId,
          sourceHandle: sourceHandleId,
          sourceSide: getHandleSide(sourceHandleId),
          handleType: sourceHandleId?.endsWith('-in') ? 'target' : 'source',
        };
      }
    }

    logAutoConnect('connect-end-open-menu', {
      connectionState,
      pendingAutoConnect: pendingAutoConnectRef.current,
    });

    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    openInsertMenuAt(point.clientX, point.clientY, pendingAutoConnectRef.current);
  }, [openInsertMenuAt]);

  const handleReconnect = useCallback<OnReconnect<CanvasFlowEdge>>((oldEdge, newConnection) => {
    setEdges((prev) => (reconnectEdge(oldEdge, newConnection, prev) as CanvasFlowEdge[]).map((edge) => (
      edge.id === oldEdge.id
        ? toFlowEdge(fromFlowEdge(edge))
        : edge
    )));
  }, [setEdges]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode<CanvasNodeData>>[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, [setNodes]);

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]) => {
    onEdgesChangeBase(changes);
  }, [onEdgesChangeBase]);

  const deleteSelection = useCallback(() => {
    const selectedJunctionIds = nodes
      .filter((node) => node.selected && node.type === 'junctionCard')
      .map((node) => node.id);

    const mergeCandidates = selectedJunctionIds
      .map((nodeId) => mergeSingleJunction(nodeId, edges.map(fromFlowEdge)))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    setNodes((prev) => prev.filter((node) => !node.selected));
    setEdges((prev) => {
      const selectedEdgeIds = prev.filter((edge) => edge.selected).map((edge) => edge.id);
      const removedMergedEdgeIds = new Set(
        mergeCandidates.reduce<string[]>((ids, candidate) => {
          ids.push(...candidate.removedEdgeIds);
          return ids;
        }, []),
      );
      const remaining = prev.filter((edge) => !selectedEdgeIds.includes(edge.id) && !removedMergedEdgeIds.has(edge.id));
      return [
        ...remaining,
        ...mergeCandidates.map((candidate) => toFlowEdge(candidate.mergedEdge)),
      ];
    });
  }, [setEdges, setNodes]);

  const {
    adjustZoom,
    fitCanvasView,
    resetZoom,
  } = useCanvasViewportControls({
    reactFlow,
    viewport,
    setViewport,
    pickerMode,
    setPickerMode,
    addTextNode,
    addWebNode,
    duplicateSelection: duplicateSelectedCanvasNodes,
    deleteSelection,
  });

  const handleNodeDragStart = useCallback((event: unknown, node: FlowNode<CanvasNodeData>) => {
    const altPressed = isAltModifiedEvent(event);
    if (!altPressed) {
      duplicateDragSessionRef.current = null;
      return;
    }

    const draggedFlowNodes = node.selected
      ? nodes.filter((candidate) => candidate.selected)
      : nodes.filter((candidate) => candidate.id === node.id);
    if (draggedFlowNodes.length === 0) {
      duplicateDragSessionRef.current = null;
      return;
    }

    const draggedCanvasNodes = draggedFlowNodes.map(fromFlowNode);
    const draggedNodeIds = new Set(draggedCanvasNodes.map((candidate) => candidate.id));
    duplicateDragSessionRef.current = {
      nodeIds: draggedCanvasNodes.map((candidate) => candidate.id),
      originalPositions: new Map(draggedCanvasNodes.map((candidate) => [candidate.id, candidate.position])),
      duplicateNodes: draggedCanvasNodes,
      duplicateEdges: edges
        .map(fromFlowEdge)
        .filter((edge) => draggedNodeIds.has(edge.source) && draggedNodeIds.has(edge.target)),
    };
  }, [edges, nodes]);

  const handleNodeDragStop = useCallback((event: unknown, node: FlowNode<CanvasNodeData>) => {
    const duplicateSession = duplicateDragSessionRef.current;
    if (!duplicateSession) {
      snapNodeToGrid(node.id);
      return;
    }

    duplicateDragSessionRef.current = null;
    const overridePositions = new Map<string, { x: number; y: number }>();
    for (const duplicateNode of duplicateSession.duplicateNodes) {
      const movedNode = nodes.find((candidate) => candidate.id === duplicateNode.id);
      overridePositions.set(
        duplicateNode.id,
        movedNode?.position ?? (duplicateNode.id === node.id ? node.position : duplicateNode.position),
      );
    }

    setNodes((prev) => prev.map((candidate) => {
      const originalPosition = duplicateSession.originalPositions.get(candidate.id);
      if (!originalPosition) return candidate;
      return {
        ...candidate,
        position: originalPosition,
        selected: false,
      };
    }));

    duplicateSelectedCanvasNodes(
      overridePositions,
      duplicateSession.duplicateNodes,
      duplicateSession.duplicateEdges,
    );
    void event;
  }, [duplicateSelectedCanvasNodes, nodes, setNodes, snapNodeToGrid]);

  const updateSelectedEdge = useCallback((updater: (edge: CanvasEdge) => CanvasEdge) => {
    if (!selectedEdge?.id) return;
    setEdges((prev) => prev.map((edge) => (
      edge.id === selectedEdge.id
        ? {
            ...edge,
            ...toFlowEdge(updater(fromFlowEdge(edge))),
            selected: true,
          }
        : edge
    )));
  }, [selectedEdge?.id, setEdges]);

  const updateSelectedEdgeLabel = useCallback((label: string) => {
    setEdgeLabelDraft(label);
    updateSelectedEdge((edge) => ({ ...edge, label }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeLineStyle = useCallback((lineStyle: CanvasEdgeLineStyle) => {
    updateSelectedEdge((edge) => ({ ...edge, lineStyle }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeRoutingStyle = useCallback((routingStyle: CanvasEdgeRoutingStyle) => {
    updateSelectedEdge((edge) => ({ ...edge, routingStyle }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeAnimation = useCallback((animated: boolean) => {
    updateSelectedEdge((edge) => ({ ...edge, animated }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeAnimationDirection = useCallback((animationReverse: boolean) => {
    updateSelectedEdge((edge) => ({ ...edge, animationReverse }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeMarkerStart = useCallback((markerStart: boolean) => {
    updateSelectedEdge((edge) => ({ ...edge, markerStart }));
  }, [updateSelectedEdge]);

  const updateSelectedEdgeMarkerEnd = useCallback((markerEnd: boolean) => {
    updateSelectedEdge((edge) => ({ ...edge, markerEnd }));
  }, [updateSelectedEdge]);

  const updateSelectedPlanningNode = useCallback((updater: (node: FlowNode<CanvasNodeData>) => FlowNode<CanvasNodeData>) => {
    if (!selectedNode?.id) return;
    setNodes((prev) => prev.map((node) => (
      node.id === selectedNode.id
        ? { ...updater(node), selected: true }
        : node
    )));
  }, [selectedNode?.id, setNodes]);

  const updateSelectedPlanningNodeTitle = useCallback((title: string) => {
    const selectedNodeType = selectedNode?.type ?? '';
    const isSymbolNode = selectedNodeType === 'symbolCard';
    const isEditablePlanningNode = isPlanningNodeType(selectedNodeType.replace(/Card$/, '') as PlanningCanvasNode['type']);
    if (!selectedNode || (!isEditablePlanningNode && !isSymbolNode)) return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: { ...node.data, title },
    }));
  }, [selectedNode, updateSelectedPlanningNode]);

  const updateSelectedPlanningNodeBody = useCallback((content: string) => {
    const selectedNodeType = selectedNode?.type ?? '';
    if (!selectedNode || !isPlanningNodeType(selectedNodeType.replace(/Card$/, '') as PlanningCanvasNode['type'])) return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: { ...node.data, content },
    }));
  }, [selectedNode, updateSelectedPlanningNode]);

  const updateSelectedPlanningNodeLinkedPath = useCallback((linkedRelativePath: string) => {
    const selectedNodeType = selectedNode?.type ?? '';
    if (!selectedNode || !isPlanningNodeType(selectedNodeType.replace(/Card$/, '') as PlanningCanvasNode['type'])) return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: { ...node.data, linkedRelativePath },
    }));
  }, [selectedNode, updateSelectedPlanningNode]);

  const updateSelectedPlanningNodeMeta = useCallback((planning: CanvasPlanningMetadata) => {
    const selectedNodeType = selectedNode?.type ?? '';
    if (!selectedNode || !isPlanningNodeType(selectedNodeType.replace(/Card$/, '') as PlanningCanvasNode['type'])) return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: { ...node.data, planning },
    }));
  }, [selectedNode, updateSelectedPlanningNode]);

  const updateSelectedPlanningNodeOrientation = useCallback((orientation: CanvasSwimlaneOrientation) => {
    if (selectedNode?.type !== 'swimlaneCard') return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: { ...node.data, orientation },
    }));
  }, [selectedNode?.type, updateSelectedPlanningNode]);

  const updateSelectedSymbolNode = useCallback((symbol: CanvasSymbolDefinition) => {
    if (selectedNode?.type !== 'symbolCard') return;
    updateSelectedPlanningNode((node) => ({
      ...node,
      data: {
        ...node.data,
        symbolGlyph: symbol.glyph,
        symbolId: symbol.iconId,
        symbolLabel: symbol.iconLabel,
        subtitle: symbol.iconLabel ?? 'Canvas symbol',
        title: node.data.title || symbol.iconLabel || 'Symbol',
      },
    }));
  }, [selectedNode?.type, updateSelectedPlanningNode]);

  const handleInsertMenuClose = useCallback(() => {
    setInsertMenuState((prev) => ({ ...prev, open: false }));
    if (!pickerMode && !symbolPickerState.open) {
      setInsertSession(null);
      pendingAutoConnectRef.current = null;
    }
  }, [pickerMode, symbolPickerState.open]);

  const handleInsertItemSelect = useCallback((item: CanvasInsertItem) => {
    const flowPosition = insertSession?.flowPosition ?? insertMenuState.flowPosition;
    setInsertMenuState((prev) => ({ ...prev, open: false }));
    logAutoConnect('insert-item-select', {
      itemId: item.id,
      flowPosition,
      pendingAutoConnect: insertSession?.autoConnect ?? pendingAutoConnectRef.current,
    });

    if (item.id === 'note' || item.id === 'file') {
      setPickerMode(item.id);
      return;
    }

    if (item.id === 'text') {
      addTextNodeAt(flowPosition);
      setInsertSession(null);
      pendingAutoConnectRef.current = null;
      return;
    }

    if (item.id === 'web') {
      addWebNodeAt(flowPosition);
      setInsertSession(null);
      pendingAutoConnectRef.current = null;
      return;
    }

    if (item.id === 'symbol') {
      setSymbolPickerState({
        open: true,
        mode: 'insert',
        position: flowPosition,
      });
      return;
    }

    addPlanningNodeAt(item.id, flowPosition);
    setInsertSession(null);
    pendingAutoConnectRef.current = null;
  }, [addPlanningNodeAt, addTextNodeAt, addWebNodeAt, insertMenuState.flowPosition, insertSession, setPickerMode]);

  const handleSymbolSelect = useCallback((choice: CanvasSymbolChoice) => {
    if (symbolPickerState.mode === 'edit') {
      updateSelectedSymbolNode(choice);
      setSymbolPickerState({ open: false, mode: 'insert', position: null });
      return;
    }

    const pendingAutoConnect = insertSession?.autoConnect ?? pendingAutoConnectRef.current;
    addSymbolNodeAt(choice, symbolPickerState.position ?? undefined, pendingAutoConnect);
    setSymbolPickerState({ open: false, mode: 'insert', position: null });
    setInsertSession(null);
    pendingAutoConnectRef.current = null;
  }, [addSymbolNodeAt, insertSession, symbolPickerState.mode, symbolPickerState.position, updateSelectedSymbolNode]);

  const handleSymbolPickerOpenChange = useCallback((open: boolean) => {
    if (open) {
      setSymbolPickerState((prev) => ({ ...prev, open: true }));
      return;
    }

    const mode = symbolPickerState.mode;
    setSymbolPickerState({ open: false, mode: 'insert', position: null });
    if (mode === 'insert') {
      setInsertSession(null);
      pendingAutoConnectRef.current = null;
    }
  }, [symbolPickerState.mode]);

  const handleEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: CanvasFlowEdge) => {
    event.preventDefault();
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const junction = createSplitJunctionNode({
      x: position.x - 36,
      y: position.y - 36,
    });
    const split = splitEdgeWithJunction(fromFlowEdge(edge), junction);
    setNodes((prev) => [
      ...prev,
      toFlowNode(junction, undefined, {
        onOpen: openRelativePath,
        onTextChange: updateTextContent,
        onSnapToGrid: snapNodeToGrid,
        onWebUrlChange: updateWebUrl,
        onWebDisplayModeOverrideChange: updateWebDisplayModeOverride,
        onRequestWebPreview: requestWebPreview,
        onOpenUrl: openExternalUrl,
      }, canvasWebCardDefaultMode, canvasWebCardAutoLoad, webPreviewsEnabled),
    ]);
    setEdges((prev) => [
      ...prev.filter((existing) => existing.id !== edge.id),
      ...split.edges.map((nextEdge: CanvasEdge) => toFlowEdge(nextEdge)),
    ]);
  }, [
    canvasWebCardAutoLoad,
    canvasWebCardDefaultMode,
    openExternalUrl,
    openRelativePath,
    reactFlow,
    requestWebPreview,
    setEdges,
    setNodes,
    snapNodeToGrid,
    updateTextContent,
    updateWebDisplayModeOverride,
    updateWebUrl,
    webPreviewsEnabled,
  ]);

  if (!relativePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground select-none">
        <Layout size={40} className="opacity-30" />
        <p className="text-lg font-medium">Canvas</p>
        <p className="max-w-sm text-center text-sm opacity-60">
          Select or create a canvas board from the sidebar to start building an infinite workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background app-fade-slide-in">
      <DocumentTopBar
        title={getDocumentBaseName(relativePath, 'Canvas')}
        subtitle={getDocumentFolderPath(relativePath)}
        icon={<Layout size={15} />}
        meta={
          <>
            <span className="shrink-0 text-xs text-muted-foreground">
              {nodes.length} {nodes.length === 1 ? 'card' : 'cards'} and {edges.length} {edges.length === 1 ? 'link' : 'links'}
            </span>
          </>
        }
        secondary={
          <CanvasToolbar
            zoomLabel={zoomLabel}
            onAddNote={() => setPickerMode('note')}
            onAddFile={() => setPickerMode('file')}
            onAddText={addTextNode}
            onAddWeb={addWebNode}
            onAddSymbol={() => setSymbolPickerState({ open: true, mode: 'insert', position: null })}
            onAddPlanningNode={addPlanningNode}
            onApplyPreset={applyPlanningPreset}
            onZoomOut={() => adjustZoom(-1)}
            onResetZoom={resetZoom}
            onZoomIn={() => adjustZoom(1)}
            onFitView={fitCanvasView}
          />
        }
      />

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,oklch(0.24_0.04_230_/_0.16),transparent_45%),linear-gradient(to_bottom,transparent,transparent)]"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleDropOnCanvas}
      >
      <CanvasPickerDialog
        open={pickerMode !== null}
        mode={pickerMode}
        files={pickerMode === 'note' ? availableNotes : availableFiles}
        onOpenChange={(open) => {
          if (!open) {
            logAutoConnect('picker-open-change', {
              open,
              selectionCommitted: false,
              pendingAutoConnect: pendingAutoConnectRef.current,
              insertSession,
            });
            setPickerMode(null);
            setInsertSession(null);
            pendingAutoConnectRef.current = null;
          }
        }}
        onSelect={(file) => {
          const pendingAutoConnect = insertSession?.autoConnect
            ? { ...insertSession.autoConnect }
            : pendingAutoConnectRef.current
              ? { ...pendingAutoConnectRef.current }
              : null;
          logAutoConnect('picker-select', {
            file: file.relativePath,
            pendingAutoConnect,
            insertSession,
          });
          handlePickerSelect(file, pendingAutoConnect);
          setInsertSession(null);
          pendingAutoConnectRef.current = null;
        }}
      />
      <CanvasSymbolPickerDialog
        open={symbolPickerState.open}
        title={symbolPickerState.mode === 'edit' ? 'Change canvas symbol' : 'Add symbol to canvas'}
        description={
          symbolPickerState.mode === 'edit'
            ? 'Choose a Nerd Font icon to replace the selected canvas symbol.'
            : 'Search bundled Nerd Font icons and add one as a symbol node on the canvas.'
        }
        onOpenChange={handleSymbolPickerOpenChange}
        onSelect={handleSymbolSelect}
      />
      <CanvasInsertMenu
        open={insertMenuState.open}
        x={insertMenuState.x}
        y={insertMenuState.y}
        onSelect={handleInsertItemSelect}
        onClose={handleInsertMenuClose}
      />

      <ReactFlow<FlowNode<CanvasNodeData>, CanvasFlowEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onReconnect={handleReconnect}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          pendingAutoConnectRef.current = null;
          openInsertMenuAt(event.clientX, event.clientY, null);
        }}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onMoveEnd={(_: MouseEvent | TouchEvent | null, nextViewport: Viewport) => setViewport(nextViewport)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        selectionOnDrag
        panOnDrag={[1]}
        panOnScroll
        zoomOnScroll={false}
        deleteKeyCode={['Backspace', 'Delete']}
        nodesDraggable
        elementsSelectable
        nodesConnectable
        edgesReconnectable
        connectionLineComponent={StackedConnectionLine}
        connectionRadius={36}
        reconnectRadius={36}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className="canvas-flow"
        defaultEdgeOptions={{
          type: 'stacked',
          animated: false,
          style: {
            ...DEFAULT_CANVAS_EDGE_STYLE,
            strokeLinecap: 'butt',
          },
        }}
      >
        <Background
          gap={24}
          size={1.5}
          variant={BackgroundVariant.Dots}
          color="color-mix(in oklch, var(--muted-foreground) 22%, transparent)"
        />
        <Panel position="top-right">
          <CanvasEdgeInspector
            selectedEdgeData={selectedEdge ? getCanvasEdgeData(selectedEdge.data) : null}
            edgeLabelDraft={edgeLabelDraft}
            onEdgeLabelChange={updateSelectedEdgeLabel}
            onLineStyleChange={updateSelectedEdgeLineStyle}
            onRoutingStyleChange={updateSelectedEdgeRoutingStyle}
            onAnimationDirectionChange={updateSelectedEdgeAnimationDirection}
            onAnimationChange={updateSelectedEdgeAnimation}
            onMarkerStartChange={updateSelectedEdgeMarkerStart}
            onMarkerEndChange={updateSelectedEdgeMarkerEnd}
            onDeleteSelected={deleteSelection}
          />
        </Panel>
        <Panel position="top-left">
          <CanvasNodeInspector
            selectedNode={selectedNode ? {
              id: selectedNode.id,
              type: selectedNode.type ?? '',
              title: selectedNode.data.title,
              subtitle: selectedNode.data.subtitle,
              content: selectedNode.data.content,
              symbolGlyph: selectedNode.data.symbolGlyph,
              symbolId: selectedNode.data.symbolId,
              symbolLabel: selectedNode.data.symbolLabel,
              linkedRelativePath: selectedNode.data.linkedRelativePath,
              planning: selectedNode.data.planning,
              orientation: selectedNode.data.orientation,
            } : null}
            onTitleChange={updateSelectedPlanningNodeTitle}
            onBodyChange={updateSelectedPlanningNodeBody}
            onPickSymbol={() => setSymbolPickerState({ open: true, mode: 'edit', position: null })}
            onLinkedPathChange={updateSelectedPlanningNodeLinkedPath}
            onPlanningChange={updateSelectedPlanningNodeMeta}
            onOrientationChange={updateSelectedPlanningNodeOrientation}
            onDeleteSelected={deleteSelection}
          />
        </Panel>
      </ReactFlow>
      </div>
    </div>
  );
}

export default function CanvasPage({ relativePath }: { relativePath: string | null }) {
  return (
    <ReactFlowProvider>
      <CanvasBoard relativePath={relativePath} />
    </ReactFlowProvider>
  );
}
