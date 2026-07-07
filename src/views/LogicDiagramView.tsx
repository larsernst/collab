import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import '@xyflow/react/dist/style.css';
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import {
  CircuitBoard,
  Group,
  Image,
  Loader2,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Plus as PlusIcon,
  Power,
  RotateCcw,
  Save,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  DocumentTopBar,
  DocumentTopBarButton,
  DocumentTopBarIconButton,
  documentTopBarGroupClass,
  getDocumentBaseName,
  getDocumentFolderPath,
} from '../components/layout/DocumentTopBar';
import {
  fromFlowGraph,
  logicNodeLabel,
  toFlowGraph,
  type LogicFlowEdge,
  type LogicFlowNode,
} from '../components/logic/logicDiagramFlow';
import {
  evaluateLogicDiagram,
  getLogicInputHandles,
  getLogicOutputHandles,
} from '../components/logic/logicDiagramEvaluator';
import { listen } from '@tauri-apps/api/event';

import { useEditorStore } from '../store/editorStore';
import { useVaultStore } from '../store/vaultStore';
import { useUiStore } from '../store/uiStore';
import { createVaultClient, type VaultClient } from '../lib/vaultClient';
import {
  compareDocumentVersions,
  useDocumentSessionController,
  type DocumentSessionController,
  type DocumentSessionSnapshot,
} from '../lib/documentSessionController';
import { saveConflictedCopy } from '../lib/conflictedCopy';
import { onReplicaMutated, replicaMutationAffectsPath } from '../lib/vaultReplica';
import { isVaultReadOnly } from '../types/vault';
import { useDocumentStatusRegistration } from '../store/documentStatusStore';
import { useCollabIdentity } from '../lib/collabIdentity';
import LivePeers from '../components/collaboration/LivePeers';
import { DocumentStatusPill } from '../components/layout/DocumentStatusPill';
import { useLivePeers } from '../lib/liveAwareness';
import { useLiveJsonDocumentSession, type JsonObject, type LiveJsonSession } from '../lib/liveJsonDocument';
import { useLiveDocumentStatus } from '../lib/useLiveDocumentStatus';
import { getMarkdownImageTarget } from '../lib/noteAssets';
import { buildLogicDiagramSvg } from '../lib/logicDiagramExport';
import { flattenVaultFiles } from '../lib/vaultLinks';
import {
  createEmptyLogicDiagram,
  normalizeLogicDiagramDocument,
  type LogicDiagramDocument,
  type LogicGateKind,
} from '../types/logicDiagram';
import type { NoteFile } from '../types/vault';
import { cn } from '../lib/utils';

interface Props {
  relativePath: string;
}

const GATE_CHOICES: Array<{ kind: LogicGateKind; label: string }> = [
  { kind: 'input', label: 'Input' },
  { kind: 'output', label: 'Output' },
  { kind: 'and', label: 'AND' },
  { kind: 'or', label: 'OR' },
  { kind: 'not', label: 'NOT' },
  { kind: 'xor', label: 'XOR' },
  { kind: 'nand', label: 'NAND' },
  { kind: 'nor', label: 'NOR' },
  { kind: 'xnor', label: 'XNOR' },
];
const SAVE_DEBOUNCE_MS = 600;
const LOGIC_GRID = 24;
const DEFAULT_GATE_WIDTH = 112;
const DEFAULT_GATE_HEIGHT = 64;
const GROUP_PADDING = 48;
const MIN_LOGIC_ZOOM = 0.2;
const MAX_LOGIC_ZOOM = 2.5;
const LOGIC_ZOOM_STEP = 1.15;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const CONTEXT_MENU_WIDTH = 280;
const CONTEXT_MENU_HEIGHT = 420;
const LOGIC_SIGNAL_ON = 'color-mix(in oklch, var(--primary) 82%, white 18%)';
const LOGIC_SIGNAL_OFF = 'color-mix(in oklch, var(--muted-foreground) 72%, transparent)';
const LOGIC_SIGNAL_UNKNOWN = 'color-mix(in oklch, var(--border) 88%, white 12%)';
const LOGIC_SIGNAL_ON_PULSE = 'color-mix(in oklch, white 84%, var(--primary) 16%)';
const LOGIC_NODE_ACTIVE_WASH = 'color-mix(in oklch, var(--primary) 26%, transparent)';

type LogicContextMenu =
  | {
      kind: 'pane';
      x: number;
      y: number;
      flowPosition: { x: number; y: number };
    }
  | {
      kind: 'node';
      x: number;
      y: number;
      nodeId: string;
    }
  | {
      kind: 'edge';
      x: number;
      y: number;
      edgeId: string;
    };

function snapValue(value: number, grid = LOGIC_GRID) {
  return Math.round(value / grid) * grid;
}

function snapPosition(position: { x: number; y: number }, grid = LOGIC_GRID) {
  return {
    x: snapValue(position.x, grid),
    y: snapValue(position.y, grid),
  };
}

function canConnectLogicNodes(connection: Connection) {
  return Boolean(connection.source && connection.target && connection.source !== connection.target);
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && target.matches('input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="combobox"]');
}

function parseLogicDocumentContent(content: string, title: string): LogicDiagramDocument {
  if (!content.trim()) return createEmptyLogicDiagram(title);
  try {
    return normalizeLogicDiagramDocument(JSON.parse(content));
  } catch {
    toast.error('This logic diagram could not be parsed. Opening an empty recovery view.');
    return createEmptyLogicDiagram(title);
  }
}

function logicDocumentToJson(document: LogicDiagramDocument): JsonObject {
  return JSON.parse(JSON.stringify(normalizeLogicDiagramDocument(document))) as JsonObject;
}

function logicDocumentFromJson(value: JsonObject): LogicDiagramDocument | null {
  const document = normalizeLogicDiagramDocument(value);
  if (document.kind !== 'logic-diagram') return null;
  if (!Array.isArray(document.nodes) || !Array.isArray(document.wires)) return null;
  return document;
}

function logicExportFileName(relativePath: string) {
  const base = getDocumentBaseName(relativePath, 'logic-diagram').replace(/\.logic$/i, '');
  return `${base.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'logic-diagram'}.svg`;
}

function uniqueLogicExportPath(relativePath: string, existingPaths: Set<string>) {
  const fileName = logicExportFileName(relativePath);
  const stem = fileName.replace(/\.svg$/i, '');
  let candidate = `Pictures/${fileName}`;
  let index = 2;
  while (existingPaths.has(candidate.toLowerCase())) {
    candidate = `Pictures/${stem}-${index}.svg`;
    index += 1;
  }
  return candidate;
}

function vaultTreeHasPath(entries: NoteFile[], relativePath: string): boolean {
  for (const entry of entries) {
    if (entry.relativePath.toLowerCase() === relativePath.toLowerCase()) return true;
    if (entry.children?.length && vaultTreeHasPath(entry.children, relativePath)) {
      return true;
    }
  }
  return false;
}

async function writeLogicSvgExport(client: VaultClient, relativePath: string, svg: string) {
  try {
    const existing = await client.readDocument(relativePath);
    return client.writeDocument(relativePath, svg, existing.version, existing.content);
  } catch {
    await client.createDocument(relativePath);
    return client.writeDocument(relativePath, svg);
  }
}

function liveLogicStatePreservesCanonicalEntities(
  live: LogicDiagramDocument,
  canonical: LogicDiagramDocument | null,
): boolean {
  if (!canonical) return true;
  const liveNodeIds = new Set(live.nodes.map((node) => node.id));
  const liveWireIds = new Set(live.wires.map((wire) => wire.id));
  return canonical.nodes.every((node) => liveNodeIds.has(node.id))
    && canonical.wires.every((wire) => liveWireIds.has(wire.id));
}

function logicNodeActiveOverlay(kind: LogicGateKind, data: LogicFlowNode['data']): CSSProperties | undefined {
  if (kind === 'group') return undefined;
  if (data.evaluatedValue === true || (kind === 'input' && data.value === true)) {
    return {
      background: LOGIC_NODE_ACTIVE_WASH,
    };
  }

  const inputHandles = getLogicInputHandles(kind);
  const firstInputOn = data.inputSignals?.['in-a'] === true || data.inputSignals?.in === true;
  const secondInputOn = data.inputSignals?.['in-b'] === true;
  if ((firstInputOn && secondInputOn) || (inputHandles.length === 1 && firstInputOn)) {
    return {
      background: `linear-gradient(90deg, ${LOGIC_NODE_ACTIVE_WASH}, transparent 72%)`,
    };
  }
  if (firstInputOn) {
    return {
      background: `linear-gradient(135deg, ${LOGIC_NODE_ACTIVE_WASH}, transparent 70%)`,
    };
  }
  if (secondInputOn) {
    return {
      background: `linear-gradient(45deg, ${LOGIC_NODE_ACTIVE_WASH}, transparent 70%)`,
    };
  }
  return undefined;
}

function LogicGateNode({ data, selected }: NodeProps<LogicFlowNode>) {
  const kind = data.kind;
  if (kind === 'group') {
    return (
      <div
        className={cn(
          'flex h-full w-full items-start rounded border border-dashed bg-card/35 px-3 py-2 text-[11px] font-medium text-muted-foreground shadow-none',
          selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/80',
        )}
      >
        {logicNodeLabel({ kind, label: data.label })}
      </div>
    );
  }

  const inputHandles = getLogicInputHandles(kind);
  const outputHandles = getLogicOutputHandles(kind);
  const isInversion = kind === 'not' || kind === 'nand' || kind === 'nor' || kind === 'xnor';
  const displayValue = kind === 'output' ? data.evaluatedValue : data.value;
  const activeOverlay = logicNodeActiveOverlay(kind, data);

  return (
    <div
      className={cn(
        'relative flex h-16 w-28 items-center justify-center overflow-hidden rounded border bg-card px-3 py-2 text-center shadow-sm transition-colors',
        selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70',
      )}
    >
      {activeOverlay ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
          style={activeOverlay}
        />
      ) : null}
      {inputHandles.map((handleId, index) => (
        <Handle
          key={handleId}
          id={handleId}
          type="target"
          position={Position.Left}
          className="z-20 size-2.5 border-border bg-background"
          style={{ top: inputHandles.length === 1 ? '50%' : `${34 + index * 32}%` }}
        />
      ))}
      <div className="relative z-10 min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-normal text-foreground">
          {logicNodeLabel({ kind, label: data.label })}
        </div>
        {(kind === 'input' || kind === 'output') && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            {typeof displayValue === 'boolean' ? (displayValue ? '1' : '0') : 'unset'}
          </div>
        )}
      </div>
      {isInversion && (
        <span className="absolute right-[-7px] top-1/2 z-20 size-3 -translate-y-1/2 rounded-full border border-border bg-background" />
      )}
      {outputHandles.map((handleId) => (
        <Handle
          key={handleId}
          id={handleId}
          type="source"
          position={Position.Right}
          className="z-20 size-2.5 border-border bg-background"
        />
      ))}
    </div>
  );
}

function LogicWireEdge(props: EdgeProps<LogicFlowEdge>) {
  const signal = props.data?.signal;
  const stroke = signal === true
    ? LOGIC_SIGNAL_ON
    : signal === false
    ? LOGIC_SIGNAL_OFF
    : LOGIC_SIGNAL_UNKNOWN;
  const markerId = `logic-wire-arrow-${props.id}`;
  const strokeWidth = signal === true ? 2.4 : 2;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 12,
  });

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 12 10"
          refX="5.6"
          refY="5"
          markerWidth="10"
          markerHeight="10"
          markerUnits="strokeWidth"
          orient="auto"
        >
          <path
            d="M10.6 5L5.2 1.6C3.6 0.6 1.6 1.75 1.6 3.62V6.38C1.6 8.25 3.6 9.4 5.2 8.4L10.6 5Z"
            fill={stroke}
            stroke="color-mix(in oklch, var(--background) 88%, transparent)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
          <path
            d="M9.1 5H5.75"
            fill="none"
            stroke="color-mix(in oklch, var(--background) 84%, transparent)"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
        </marker>
      </defs>
      {props.selected ? (
        <path
          d={path}
          fill="none"
          stroke="color-mix(in oklch, var(--primary) 48%, white 22%)"
          strokeWidth={strokeWidth + 5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.22}
          pointerEvents="none"
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
      />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={signal === undefined ? '7 7' : undefined}
        markerEnd={`url(#${markerId})`}
        style={{
          filter: props.selected ? 'drop-shadow(0 0 10px color-mix(in oklch, var(--primary) 35%, transparent))' : undefined,
        }}
      />
      {signal === true ? (
        <path
          d={path}
          fill="none"
          stroke={LOGIC_SIGNAL_ON_PULSE}
          strokeWidth={strokeWidth + 0.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="28 240"
          opacity={1}
          pointerEvents="none"
          style={{
            filter: 'drop-shadow(0 0 3px color-mix(in oklch, var(--primary) 32%, transparent))',
          }}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="268"
            to="0"
            dur="1200ms"
            repeatCount="indefinite"
          />
        </path>
      ) : null}
      <BaseEdge
        {...props}
        path={path}
        labelX={labelX}
        labelY={labelY}
        interactionWidth={16}
        style={{
          stroke: 'transparent',
          strokeWidth: 0,
          opacity: 0,
        }}
      />
    </>
  );
}

const nodeTypes = { logicGate: LogicGateNode };
const edgeTypes = { logicWire: LogicWireEdge };

function LogicDiagramEditor({ relativePath }: Props) {
  const vault = useVaultStore((state) => state.vault);
  const fileTree = useVaultStore((state) => state.fileTree);
  const refreshFileTree = useVaultStore((state) => state.refreshFileTree);
  const client = useMemo(() => (vault ? createVaultClient(vault) : null), [vault]);
  const markDirty = useEditorStore((state) => state.markDirty);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setSavedHash = useEditorStore((state) => state.setSavedHash);
  const setForceReloadPath = useEditorStore((state) => state.setForceReloadPath);
  const openTabs = useEditorStore((state) => state.openTabs);
  const activeTabPath = useEditorStore((state) => state.activeTabPath);
  const openTab = useEditorStore((state) => state.openTab);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const readOnly = vault ? isVaultReadOnly(vault) : false;
  const { userId: myUserId, userName: myUserName, userColor: myUserColor } = useCollabIdentity();
  const [nodes, setNodes, onNodesChange] = useNodesState<LogicFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LogicFlowEdge>([]);
  const [diagram, setDiagram] = useState<LogicDiagramDocument>(() =>
    createEmptyLogicDiagram(getDocumentBaseName(relativePath, 'Logic Diagram').replace(/\.logic$/i, '')),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedGate, setSelectedGate] = useState<LogicGateKind>('and');
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupLabel, setRenameGroupLabel] = useState('');
  const [viewport, setViewportState] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [contextMenu, setContextMenu] = useState<LogicContextMenu | null>(null);
  const idCounterRef = useRef(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Structural signature of what is currently persisted; used to skip autosaves
  // that carry no real change (selection, measurement, fit-view, pan).
  const savedStructuralRef = useRef<string | null>(null);
  const canonicalLogicRef = useRef<LogicDiagramDocument | null>(null);
  // True only after a successful load, so a failed read never overwrites the
  // file with an empty/default diagram.
  const readyRef = useRef(false);
  const liveSessionRef = useRef<LiveJsonSession | null>(null);
  const [refreshPulse, setRefreshPulse] = useState(false);
  const refreshPulseTimerRef = useRef<number | null>(null);
  const { getViewport, screenToFlowPosition, fitView, setViewport } = useReactFlow<LogicFlowNode, LogicFlowEdge>();

  const structuralSignature = useCallback((flowNodes: LogicFlowNode[], flowEdges: LogicFlowEdge[]) =>
    JSON.stringify({
      nodes: flowNodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        label: node.data.label ?? null,
        value: node.data.value ?? null,
        parentId: node.parentId ?? null,
        x: node.position.x,
        y: node.position.y,
        w: node.data.kind === 'group' && typeof node.style?.width === 'number' ? node.style.width : null,
        h: node.data.kind === 'group' && typeof node.style?.height === 'number' ? node.style.height : null,
      })),
      wires: flowEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        label: typeof edge.label === 'string' ? edge.label : null,
      })),
    }), []);

  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );
  const selectedEdgeIds = useMemo(
    () => edges.filter((edge) => edge.selected).map((edge) => edge.id),
    [edges],
  );
  const evaluation = useMemo(() => {
    const graph = fromFlowGraph(diagram, nodes, edges, viewport);
    return evaluateLogicDiagram(graph.nodes, graph.wires);
  }, [diagram, edges, nodes, viewport]);
  const renderedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      evaluatedValue: evaluation.nodeValues[node.id],
      inputSignals: edges.reduce<Record<string, boolean | undefined>>((signals, edge) => {
        if (edge.target !== node.id) return signals;
        const targetHandles = getLogicInputHandles(node.data.kind);
        const targetHandle = edge.targetHandle && targetHandles.includes(edge.targetHandle)
          ? edge.targetHandle
          : targetHandles[0];
        if (targetHandle) signals[targetHandle] = evaluation.wireValues[edge.id];
        return signals;
      }, {}),
    },
  })), [edges, evaluation.nodeValues, evaluation.wireValues, nodes]);
  const renderedEdges = useMemo(() => edges.map((edge) => {
    const signal = evaluation.wireValues[edge.id];
    return {
      ...edge,
      type: 'logicWire' as const,
      data: {
        ...edge.data,
        signal,
      },
    };
  }), [edges, evaluation.wireValues]);

  const title = getDocumentBaseName(relativePath, 'Logic Diagram').replace(/\.logic$/i, '');
  const noteTarget = useMemo(() => (
    openTabs.find((tab) => tab.type === 'note' && tab.relativePath === activeTabPath)
    ?? openTabs.find((tab) => tab.type === 'note')
    ?? null
  ), [activeTabPath, openTabs]);

  // Push an adopted document (initial load, backend merge, or a safe remote
  // apply) into the ReactFlow editor and re-baseline the structural signature so
  // the autosave effect does not immediately re-fire.
  const applyLogicDocument = useCallback((loaded: LogicDiagramDocument) => {
    const graph = toFlowGraph(loaded);
    setDiagram(loaded);
    canonicalLogicRef.current = loaded;
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setViewportState(loaded.viewport);
    savedStructuralRef.current = structuralSignature(graph.nodes, graph.edges);
    readyRef.current = true;
    window.setTimeout(() => {
      void setViewport(loaded.viewport, { duration: 0 });
    }, 0);
  }, [setEdges, setNodes, setViewport, structuralSignature]);

  const { controller, snapshot } = useDocumentSessionController<LogicDiagramDocument>({
    serialize: (doc) => JSON.stringify(doc, null, 2),
    deserialize: (content) => parseLogicDocumentContent(content, title),
    applyDocument: (candidate) => applyLogicDocument(candidate.document),
    read: async () => {
      if (!client) return null;
      const doc = await client.readDocument(relativePath);
      return { content: doc.content, version: doc.version, source: doc.source && doc.source !== 'network' ? 'cache' : 'rest' };
    },
    write: async ({ content, expectedVersion, baseContent }) => {
      if (!client) return { version: expectedVersion ?? '' };
      const result = await client.writeDocument(relativePath, content, expectedVersion ?? undefined, baseContent);
      if (result.conflict) {
        // ConflictInfo carries the other side's content but no version token;
        // read the current server version so keep-mine/load-latest can rebase.
        let theirVersion: string | null = null;
        try {
          theirVersion = (await client.readDocument(relativePath)).version;
        } catch {
          // Best-effort; a null version makes the next save force-overwrite.
        }
        return {
          version: expectedVersion ?? '',
          conflict: { theirContent: result.conflict.theirContent, baseContent, theirVersion },
        };
      }
      if (result.offlineQueued) return { version: result.version, offlineQueued: true };
      return { version: result.version, mergedContent: result.mergedContent };
    },
    autosaveDebounceMs: SAVE_DEBOUNCE_MS,
    compareVersions: compareDocumentVersions,
    isLive: () => liveSessionRef.current !== null,
  });

  // Initial load: establish the session baseline (force explicit reload policy).
  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    readyRef.current = false;
    setLoading(true);
    client.readDocument(relativePath)
      .then((document) => {
        if (cancelled) return;
        controller.load(document.content, document.version, 'rest');
        setSavedHash(relativePath, document.version);
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to open logic diagram: ${error}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, controller, relativePath, setSavedHash]);

  const applyLiveLogicDocument = useCallback((document: LogicDiagramDocument) => {
    applyLogicDocument(document);
  }, [applyLogicDocument]);

  const validateInitialLiveLogicDocument = useCallback((document: LogicDiagramDocument) => (
    liveLogicStatePreservesCanonicalEntities(document, canonicalLogicRef.current)
  ), []);

  const liveSession = useLiveJsonDocumentSession<LogicDiagramDocument>({
    client,
    relativePath,
    enabled: !loading && Boolean(client?.resolveLiveSession),
    fromJson: logicDocumentFromJson,
    validateInitial: validateInitialLiveLogicDocument,
    applyDocument: applyLiveLogicDocument,
  });

  useLiveDocumentStatus(controller, liveSession);

  useEffect(() => {
    liveSessionRef.current = liveSession;
  }, [liveSession]);

  useEffect(() => {
    if (!liveSession) return;
    liveSession.awareness.setLocalStateField('user', {
      id: myUserId,
      name: myUserName,
      color: myUserColor,
    });
    liveSession.awareness.setLocalStateField('document', {
      kind: 'logic',
      relativePath,
    });
  }, [liveSession, myUserColor, myUserId, myUserName, relativePath]);

  const livePeers = useLivePeers(liveSession);

  // Debounced autosave via the shared controller: only marks a local change when
  // the structural signature actually changes, so selection, node measurement,
  // fit-view, and pan do not trigger writes. The controller serializes
  // overlapping saves, rejects stale remote reloads, queues remote changes while
  // dirty, and latches autosave off on conflict. `lastMarkedSigRef` makes the
  // mark idempotent per distinct signature so a re-render (from the controller's
  // own state change) never re-marks the same edit.
  const lastMarkedSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vault || readOnly || !readyRef.current) return;
    const sig = structuralSignature(nodes, edges);
    if (sig === savedStructuralRef.current) {
      lastMarkedSigRef.current = sig;
      return;
    }
    if (sig === lastMarkedSigRef.current) return;
    lastMarkedSigRef.current = sig;
    const next = fromFlowGraph(diagram, nodes, edges, getViewport() as Viewport);
    if (liveSessionRef.current) {
      liveSessionRef.current.writeJson(logicDocumentToJson(next));
    } else {
      controller.markLocalChange(next);
    }
  }, [controller, diagram, edges, getViewport, nodes, readOnly, structuralSignature, vault]);

  // Re-baseline the structural signature when a save (without a merge adoption,
  // which reseeds via applyDocument) completes cleanly, so the autosave effect
  // stops firing for already-persisted state.
  const prevSavingRef = useRef(false);
  useEffect(() => {
    if (prevSavingRef.current && !snapshot.saving && !snapshot.dirty && !snapshot.conflicted) {
      savedStructuralRef.current = structuralSignature(nodes, edges);
    }
    prevSavingRef.current = snapshot.saving;
  }, [edges, nodes, snapshot.conflicted, snapshot.dirty, snapshot.saving, structuralSignature]);

  // Bridge the controller's dirty/version state to the tab dirty indicator.
  useEffect(() => {
    if (!relativePath) return;
    if (liveSession) return;
    if (snapshot.dirty) markDirty(relativePath);
    else if (snapshot.loadedVersion) markSaved(relativePath, snapshot.loadedVersion);
  }, [liveSession, markDirty, markSaved, relativePath, snapshot.dirty, snapshot.loadedVersion]);

  const pulseRefresh = useCallback(() => {
    setRefreshPulse(true);
    if (refreshPulseTimerRef.current !== null) window.clearTimeout(refreshPulseTimerRef.current);
    refreshPulseTimerRef.current = window.setTimeout(() => setRefreshPulse(false), 420);
  }, []);

  // Local filesystem watcher: another writer changed this file. The controller
  // decides — auto-apply when clean, queue when dirty, ignore our own echo.
  useEffect(() => {
    if (!client || !client.capabilities.filesystemWatch || !relativePath) return;
    let unsub: (() => void) | undefined;
    listen<{ path: string }>('vault:file-modified', (event) => {
      if (event.payload.path !== relativePath) return;
      if (Date.now() - controller.getSnapshot().lastLocalWriteStartedAt < 2000) return;
      void controller.handleExternalMutation('rest').then((decision) => {
        if (decision === 'applied') pulseRefresh();
      });
    }).then((cleanup) => { unsub = cleanup; });
    return () => { unsub?.(); };
  }, [client, controller, pulseRefresh, relativePath]);

  // Hosted replica refresh: route through the same safe remote policy.
  useEffect(() => {
    if (!client || client.kind !== 'hosted' || !relativePath) return;
    return onReplicaMutated((event) => {
      if (!replicaMutationAffectsPath(event, relativePath)) return;
      void controller.handleExternalMutation('cache').then((decision) => {
        if (decision === 'applied') pulseRefresh();
      });
    }, { kinds: ['manifest'] });
  }, [client, controller, pulseRefresh, relativePath]);

  useEffect(() => () => {
    if (refreshPulseTimerRef.current !== null) window.clearTimeout(refreshPulseTimerRef.current);
  }, []);

  const handleSave = useCallback(async () => {
    if (!vault || readOnly) return;
    setSaving(true);
    try {
      await controller.requestSave('manual');
      const snap = controller.getSnapshot();
      if (snap.conflicted) {
        toast.error('This logic diagram changed elsewhere. Review the conflict before saving.');
      } else if (snap.offlineQueued) {
        toast.message('Saved offline — changes will sync when reconnected.');
      } else {
        toast.success('Saved logic diagram.');
      }
    } catch (error) {
      toast.error(`Failed to save logic diagram: ${error}`);
    } finally {
      setSaving(false);
    }
  }, [controller, readOnly, vault]);

  const handleExportToNote = useCallback(async (uniqueName = false) => {
    if (!vault || !client || readOnly) return;
    if (!noteTarget) {
      toast.error('Open a note before inserting this diagram.');
      return;
    }
    setExporting(true);
    try {
      await controller.requestSave('manual');
      const current = fromFlowGraph(diagram, nodes, edges, getViewport() as Viewport);
      const svg = buildLogicDiagramSvg(current, relativePath);
      const existingPaths = new Set(flattenVaultFiles(fileTree).map((entry) => entry.relativePath.toLowerCase()));
      if (!vaultTreeHasPath(fileTree, 'Pictures')) {
        await client.createFolder('Pictures');
      }
      const exportedPath = uniqueName
        ? uniqueLogicExportPath(relativePath, existingPaths)
        : `Pictures/${logicExportFileName(relativePath)}`;
      await writeLogicSvgExport(client, exportedPath, svg);
      await refreshFileTree();
      const note = await client.readDocument(noteTarget.relativePath);
      const markdownTarget = getMarkdownImageTarget(noteTarget.relativePath, exportedPath);
      const markdown = `![${title}](${markdownTarget})`;
      const separator = note.content.trim().length > 0 && !note.content.endsWith('\n') ? '\n\n' : '';
      const nextContent = `${note.content}${separator}${markdown}\n`;
      const result = await client.writeDocument(noteTarget.relativePath, nextContent, note.version, note.content);
      markSaved(noteTarget.relativePath, result.version);
      setForceReloadPath(noteTarget.relativePath);
      openTab(noteTarget.relativePath, noteTarget.title, 'note');
      setActiveView('editor');
      toast.success(`Inserted diagram into ${noteTarget.title}`);
    } catch (error) {
      toast.error(`Failed to export logic diagram: ${error}`);
    } finally {
      setExporting(false);
    }
  }, [client, controller, diagram, edges, fileTree, getViewport, markSaved, nodes, noteTarget, openTab, readOnly, refreshFileTree, relativePath, setActiveView, setForceReloadPath, title, vault]);

  const markChanged = useCallback(() => {
    if (liveSessionRef.current) return;
    markDirty(relativePath);
  }, [markDirty, relativePath]);

  const getMenuPosition = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return {
      x: Math.max(12, Math.min(clientX - rect.left, rect.width - CONTEXT_MENU_WIDTH - 12)),
      y: Math.max(12, Math.min(clientY - rect.top, rect.height - CONTEXT_MENU_HEIGHT - 12)),
    };
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const syncViewport = useCallback((nextViewport: Viewport, duration = 180) => {
    setViewportState(nextViewport);
    void setViewport(nextViewport, { duration });
  }, [setViewport]);

  const adjustZoom = useCallback((direction: 1 | -1) => {
    const current = getViewport();
    const nextZoom = Math.min(
      MAX_LOGIC_ZOOM,
      Math.max(MIN_LOGIC_ZOOM, current.zoom * (direction > 0 ? LOGIC_ZOOM_STEP : 1 / LOGIC_ZOOM_STEP)),
    );
    syncViewport({ ...current, zoom: nextZoom });
  }, [getViewport, syncViewport]);

  const resetZoom = useCallback(() => {
    const current = getViewport();
    syncViewport({ ...current, zoom: 1 });
  }, [getViewport, syncViewport]);

  const fitLogicView = useCallback(() => {
    void fitView({ padding: 0.25, duration: 180 }).then(() => {
      setViewportState(getViewport());
    });
  }, [fitView, getViewport]);

  const resolveLogicConnection = useCallback((connection: Connection) => {
    if (!canConnectLogicNodes(connection)) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const sourceHandles = getLogicOutputHandles(sourceNode.data.kind);
    const targetHandles = getLogicInputHandles(targetNode.data.kind);
    const sourceHandle = connection.sourceHandle && sourceHandles.includes(connection.sourceHandle)
      ? connection.sourceHandle
      : sourceHandles[0];
    const requestedTargetHandle = connection.targetHandle && targetHandles.includes(connection.targetHandle)
      ? connection.targetHandle
      : targetHandles.find((handleId) => !edges.some((edge) => (
          edge.target === targetNode.id
          && (edge.targetHandle && targetHandles.includes(edge.targetHandle) ? edge.targetHandle : targetHandles[0]) === handleId
        )));

    if (!sourceHandle || !requestedTargetHandle) return;
    if (edges.some((edge) => (
      edge.target === targetNode.id
      && (edge.targetHandle && targetHandles.includes(edge.targetHandle) ? edge.targetHandle : targetHandles[0]) === requestedTargetHandle
    ))) return;

    return { sourceHandle, targetHandle: requestedTargetHandle };
  }, [edges, nodes]);

  const isValidLogicConnection = useCallback((connection: Connection | Edge) => (
    Boolean(resolveLogicConnection({
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    }))
  ), [resolveLogicConnection]);

  const onConnect = useCallback((connection: Connection) => {
    const resolved = resolveLogicConnection(connection);
    if (!resolved) return;
    setEdges((current) => addEdge({
      ...connection,
      id: `wire-${Date.now()}-${current.length}`,
      sourceHandle: resolved.sourceHandle,
      targetHandle: resolved.targetHandle,
      type: 'logicWire',
    }, current));
    markChanged();
  }, [markChanged, resolveLogicConnection, setEdges]);

  const snapDraggedNodesToGrid = useCallback((nodeId: string) => {
    setNodes((current) => {
      const draggedNode = current.find((candidate) => candidate.id === nodeId);
      return current.map((node) => {
        const shouldSnap = node.id === nodeId
          || (draggedNode?.selected && node.selected && node.data.kind !== 'group');
        return shouldSnap ? { ...node, position: snapPosition(node.position) } : node;
      });
    });
    markChanged();
  }, [markChanged, setNodes]);

  const selectedGroups = useMemo(
    () => nodes.filter((node) => node.selected && node.data.kind === 'group'),
    [nodes],
  );

  const openRenameGroup = useCallback((groupId: string) => {
    const groupNode = nodes.find((node) => node.id === groupId && node.data.kind === 'group');
    if (!groupNode) return;
    setRenameGroupId(groupId);
    setRenameGroupLabel(logicNodeLabel({ kind: groupNode.data.kind, label: groupNode.data.label }));
  }, [nodes]);

  const renameSelectedGroup = useCallback(() => {
    if (selectedGroups.length !== 1) return;
    openRenameGroup(selectedGroups[0].id);
  }, [openRenameGroup, selectedGroups]);

  const applyGroupRename = useCallback(() => {
    if (!renameGroupId) return;
    const nextLabel = renameGroupLabel.trim() || 'Group';
    setNodes((current) => current.map((node) => (
      node.id === renameGroupId && node.data.kind === 'group'
        ? { ...node, data: { ...node.data, label: nextLabel } }
        : node
    )));
    setRenameGroupId(null);
    setRenameGroupLabel('');
    markChanged();
  }, [markChanged, renameGroupId, renameGroupLabel, setNodes]);

  const groupSelection = useCallback(() => {
    const selected = nodes.filter((node) => node.selected && node.data.kind !== 'group' && !node.parentId);
    if (selected.length < 2) {
      toast.error('Select at least two ungrouped gates to group them.');
      return;
    }

    const left = Math.min(...selected.map((node) => node.position.x));
    const top = Math.min(...selected.map((node) => node.position.y));
    const right = Math.max(...selected.map((node) => node.position.x + (typeof node.style?.width === 'number' ? node.style.width : DEFAULT_GATE_WIDTH)));
    const bottom = Math.max(...selected.map((node) => node.position.y + (typeof node.style?.height === 'number' ? node.style.height : DEFAULT_GATE_HEIGHT)));
    const groupPosition = snapPosition({ x: left - GROUP_PADDING, y: top - GROUP_PADDING });
    const groupId = `group-${Date.now()}`;

    const groupNode: LogicFlowNode = {
      id: groupId,
      type: 'logicGate',
      position: groupPosition,
      data: { kind: 'group', label: 'Group' },
      zIndex: 0,
      style: {
        width: Math.max(240, right - left + GROUP_PADDING * 2),
        height: Math.max(160, bottom - top + GROUP_PADDING * 2),
      },
      selected: true,
    };

    const selectedIds = new Set(selected.map((node) => node.id));
    setNodes((current) => [
      groupNode,
      ...current.map((node) => {
        if (!selectedIds.has(node.id)) return { ...node, selected: false };
        return {
          ...node,
          parentId: groupId,
          extent: 'parent' as const,
          zIndex: 1,
          position: {
            x: node.position.x - groupPosition.x,
            y: node.position.y - groupPosition.y,
          },
          selected: false,
        };
      }),
    ]);
    markChanged();
  }, [markChanged, nodes, setNodes]);

  const ungroupSelection = useCallback(() => {
    const selectedGroupIds = nodes
      .filter((node) => node.selected && node.data.kind === 'group')
      .map((node) => node.id);
    if (selectedGroupIds.length === 0) return;

    const selectedGroupIdSet = new Set(selectedGroupIds);
    const groupPositions = new Map(
      nodes
        .filter((node) => selectedGroupIdSet.has(node.id))
        .map((node) => [node.id, node.position]),
    );

    setNodes((current) => current
      .filter((node) => !selectedGroupIdSet.has(node.id))
      .map((node) => {
        if (!node.parentId || !selectedGroupIdSet.has(node.parentId)) return node;
        const groupPosition = groupPositions.get(node.parentId) ?? { x: 0, y: 0 };
        return {
          ...node,
          parentId: undefined,
          extent: undefined,
          position: snapPosition({
            x: groupPosition.x + node.position.x,
            y: groupPosition.y + node.position.y,
          }),
          selected: true,
        };
      }));
    markChanged();
  }, [markChanged, nodes, setNodes]);

  const addGateAt = useCallback((kind: LogicGateKind, position: { x: number; y: number }) => {
    const index = idCounterRef.current++;
    const id = `${kind}-${Date.now()}-${index}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'logicGate',
        position: snapPosition(position),
        zIndex: 1,
        data: { kind, value: kind === 'input' ? false : undefined },
      },
    ]);
    markChanged();
  }, [markChanged, setNodes]);

  const addGate = useCallback((kind: LogicGateKind) => {
    addGateAt(kind, screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }));
  }, [addGateAt, screenToFlowPosition]);

  const toggleInputNodes = useCallback((nodeIds: string[]) => {
    const targetIds = new Set(nodeIds);
    if (targetIds.size === 0) return;
    let changed = false;
    setNodes((current) => current.map((node) => {
      if (!targetIds.has(node.id) || node.data.kind !== 'input') return node;
      changed = true;
      return {
        ...node,
        data: {
          ...node.data,
          value: node.data.value !== true,
        },
      };
    }));
    if (changed) markChanged();
  }, [markChanged, setNodes]);

  const handleNodeDoubleClick = useCallback<NodeMouseHandler<LogicFlowNode>>((event, node) => {
    if (readOnly) return;
    if (node.data.kind === 'input') {
      event.preventDefault();
      toggleInputNodes([node.id]);
      return;
    }
    if (node.data.kind === 'group') openRenameGroup(node.id);
  }, [openRenameGroup, readOnly, toggleInputNodes]);

  const deleteSelection = useCallback(() => {
    const selectedNodeIdSet = new Set([
      ...selectedNodeIds,
      ...nodes.filter((node) => node.selected).map((node) => node.id),
    ]);
    const selectedEdgeIdSet = new Set([
      ...selectedEdgeIds,
      ...edges.filter((edge) => edge.selected).map((edge) => edge.id),
    ]);
    if (selectedNodeIdSet.size === 0 && selectedEdgeIdSet.size === 0) return;

    const nodeIds = new Set(selectedNodeIdSet);
    for (const node of nodes) {
      if (node.parentId && nodeIds.has(node.parentId)) nodeIds.add(node.id);
    }
    setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
    setEdges((current) => current.filter((edge) => (
      !selectedEdgeIdSet.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)
    )));
    markChanged();
  }, [edges, markChanged, nodes, selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    markChanged();
  }, [markChanged, setEdges]);

  const changeSelectedGateKind = useCallback((kind: LogicGateKind) => {
    if (kind === 'group') return;
    const selectedIds = new Set(selectedNodeIds);
    if (selectedIds.size === 0) return;
    const nextKindById = new Map(
      nodes
        .filter((node) => selectedIds.has(node.id) && node.data.kind !== 'group')
        .map((node) => [node.id, kind]),
    );
    setNodes((current) => current.map((node) => (
      selectedIds.has(node.id) && node.data.kind !== 'group'
        ? {
            ...node,
            data: {
              ...node.data,
              kind,
              value: kind === 'input' ? (typeof node.data.value === 'boolean' ? node.data.value : false) : undefined,
            },
        }
        : node
    )));
    const kindForNode = (nodeId: string) => nextKindById.get(nodeId)
      ?? nodes.find((node) => node.id === nodeId)?.data.kind;
    setEdges((current) => {
      const usedTargetHandles = new Set<string>();
      return current.flatMap((edge) => {
        const sourceKind = kindForNode(edge.source);
        const targetKind = kindForNode(edge.target);
        if (!sourceKind || !targetKind) return [];

        const sourceHandles = getLogicOutputHandles(sourceKind);
        const targetHandles = getLogicInputHandles(targetKind);
        if (sourceHandles.length === 0 || targetHandles.length === 0) return [];

        const sourceHandle = edge.sourceHandle && sourceHandles.includes(edge.sourceHandle)
          ? edge.sourceHandle
          : sourceHandles[0];
        const targetHandle = edge.targetHandle && targetHandles.includes(edge.targetHandle)
          ? edge.targetHandle
          : targetHandles[0];
        const targetKey = `${edge.target}:${targetHandle}`;
        if (usedTargetHandles.has(targetKey)) return [];
        usedTargetHandles.add(targetKey);

        return [{
          ...edge,
          sourceHandle,
          targetHandle,
        }];
      });
    });
    markChanged();
  }, [markChanged, nodes, selectedNodeIds, setEdges, setNodes]);

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    const position = getMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: 'pane',
      ...position,
      flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [getMenuPosition, readOnly, screenToFlowPosition]);

  const handleNodeContextMenu = useCallback<NodeMouseHandler<LogicFlowNode>>((event, node) => {
    if (readOnly) return;
    event.preventDefault();
    const position = getMenuPosition(event.clientX, event.clientY);
    if (!node.selected) {
      setNodes((current) => current.map((candidate) => ({
        ...candidate,
        selected: candidate.id === node.id,
      })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    }
    setContextMenu({
      kind: 'node',
      ...position,
      nodeId: node.id,
    });
  }, [getMenuPosition, readOnly, setEdges, setNodes]);

  const handleEdgeContextMenu = useCallback<EdgeMouseHandler<LogicFlowEdge>>((event, edge) => {
    if (readOnly) return;
    event.preventDefault();
    const position = getMenuPosition(event.clientX, event.clientY);
    if (!edge.selected) {
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
      setEdges((current) => current.map((candidate) => ({
        ...candidate,
        selected: candidate.id === edge.id,
      })));
    }
    setContextMenu({
      kind: 'edge',
      ...position,
      edgeId: edge.id,
    });
  }, [getMenuPosition, readOnly, setEdges, setNodes]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey) return;
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }

      if (!modifier && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitLogicView();
        return;
      }

      if (!modifier && event.key === 'F2') {
        event.preventDefault();
        renameSelectedGroup();
        return;
      }

      if ((modifier || !event.shiftKey) && event.key === '0') {
        event.preventDefault();
        resetZoom();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setNodes((current) => current.map((node) => ({ ...node, selected: true })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: true })));
        return;
      }

      if (!modifier && (event.key === ' ' || event.key === 'Enter')) {
        const selectedInputIds = nodes
          .filter((node) => node.selected && node.data.kind === 'input')
          .map((node) => node.id);
        if (selectedInputIds.length > 0) {
          event.preventDefault();
          toggleInputNodes(selectedInputIds);
          return;
        }
      }

      if (!modifier && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        addGate('input');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        addGate('output');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        addGate('and');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addGate('not');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        addGate('xor');
        return;
      }

      if (modifier && event.key === 'ArrowUp') {
        event.preventDefault();
        adjustZoom(1);
        return;
      }
      if (modifier && event.key === 'ArrowDown') {
        event.preventDefault();
        adjustZoom(-1);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const hasLogicSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
        if (hasLogicSelection) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          deleteSelection();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true } as EventListenerOptions);
  }, [addGate, adjustZoom, deleteSelection, fitLogicView, groupSelection, nodes, renameSelectedGroup, resetZoom, selectedEdgeIds.length, selectedNodeIds.length, setEdges, setNodes, toggleInputNodes, ungroupSelection]);

  const zoomLabel = `${Math.round(viewport.zoom * 100)}%`;
  const selectedGateNodes = nodes.filter((node) => node.selected && node.data.kind !== 'group');
  const selectedUngroupedGateNodes = selectedGateNodes.filter((node) => !node.parentId);
  const selectedInputNodes = selectedGateNodes.filter((node) => node.data.kind === 'input');
  const selectedGroupCount = selectedGroups.length;
  const selectedItemCount = selectedNodeIds.length + selectedEdgeIds.length;
  const contextTargetNode = contextMenu?.kind === 'node'
    ? nodes.find((node) => node.id === contextMenu.nodeId)
    : null;
  const contextTargetEdge = contextMenu?.kind === 'edge'
    ? edges.find((edge) => edge.id === contextMenu.edgeId)
    : null;

  const runContextAction = (action: () => void) => {
    action();
    closeContextMenu();
  };

  const secondary = (
    <>
      <div className={documentTopBarGroupClass}>
        <Select value={selectedGate} onValueChange={(value) => setSelectedGate(value as LogicGateKind)}>
          <SelectTrigger size="sm" className="h-8 min-w-28 border-0 bg-transparent text-xs shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" position="popper">
            {GATE_CHOICES.map((gate) => (
              <SelectItem key={gate.kind} value={gate.kind}>{gate.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DocumentTopBarButton onClick={() => addGate(selectedGate)}>
          <Plus size={14} />
          Add
        </DocumentTopBarButton>
      </div>
      <div className={documentTopBarGroupClass}>
        <DocumentTopBarIconButton
          title="Delete selected gates or wires"
          onClick={deleteSelection}
          disabled={selectedNodeIds.length === 0 && selectedEdgeIds.length === 0}
        >
          <Trash2 size={14} />
        </DocumentTopBarIconButton>
        <DocumentTopBarButton
          onClick={groupSelection}
          disabled={nodes.filter((node) => node.selected && node.data.kind !== 'group' && !node.parentId).length < 2}
        >
          <Group size={14} />
          Group
        </DocumentTopBarButton>
        <DocumentTopBarIconButton
          title="Ungroup selected groups"
          onClick={ungroupSelection}
          disabled={!nodes.some((node) => node.selected && node.data.kind === 'group')}
        >
          <Ungroup size={14} />
        </DocumentTopBarIconButton>
        <DocumentTopBarIconButton
          title="Rename selected group"
          onClick={renameSelectedGroup}
          disabled={selectedGroups.length !== 1}
        >
          <Pencil size={14} />
        </DocumentTopBarIconButton>
      </div>
      <div className={documentTopBarGroupClass}>
        <DocumentTopBarIconButton onClick={() => adjustZoom(-1)} title="Zoom out">
          <Minus size={15} />
        </DocumentTopBarIconButton>
        <DocumentTopBarButton
          onClick={resetZoom}
          className="min-w-[78px] justify-center px-2 text-center font-medium text-muted-foreground"
          title="Reset zoom to 100%"
        >
          {zoomLabel}
        </DocumentTopBarButton>
        <DocumentTopBarIconButton onClick={() => adjustZoom(1)} title="Zoom in">
          <PlusIcon size={15} />
        </DocumentTopBarIconButton>
        <DocumentTopBarIconButton onClick={fitLogicView} title="Fit view">
          <Maximize2 size={14} />
        </DocumentTopBarIconButton>
        <DocumentTopBarIconButton onClick={resetZoom} title="Reset zoom">
          <RotateCcw size={14} />
        </DocumentTopBarIconButton>
      </div>
      <div className={documentTopBarGroupClass}>
        <DocumentTopBarButton
          onClick={(event) => handleExportToNote(event.shiftKey)}
          disabled={exporting || loading || readOnly}
          title="Insert in note. Shift-click saves a unique export."
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
          Insert in note
        </DocumentTopBarButton>
        <DocumentTopBarButton onClick={handleSave} disabled={saving || loading}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </DocumentTopBarButton>
      </div>
    </>
  );

  const handleSaveAsNew = useCallback(async (localContent: string) => {
    if (!client || !relativePath) return;
    await saveConflictedCopy(client, relativePath, localContent);
  }, [client, relativePath]);

  const documentStatus = useMemo(() => (
    !loading
      ? {
          status: snapshot.status,
          controller: controller as DocumentSessionController<unknown>,
          snapshot: snapshot as DocumentSessionSnapshot<unknown>,
          onSaveAsNew: handleSaveAsNew,
          readOnly,
        }
      : null
  ), [controller, handleSaveAsNew, loading, readOnly, snapshot]);
  useDocumentStatusRegistration(relativePath, documentStatus);

  const counts = useMemo(() => {
    const gateCount = nodes.filter((node) => node.data.kind !== 'group').length;
    const groupCount = nodes.length - gateCount;
    return { gateCount, groupCount };
  }, [nodes]);

  const meta = (
    <div className="flex items-center gap-2">
      <DocumentStatusPill status={snapshot.status} compact />
      <LivePeers peers={livePeers} />
      <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
        {counts.gateCount} gates · {counts.groupCount} groups · {edges.length} wires
      </div>
    </div>
  );

  return (
    <div className={`flex h-full min-h-0 flex-col bg-background app-document-ready ${refreshPulse ? 'app-refresh-pulse' : ''}`}>
      <DocumentTopBar
        title={title}
        subtitle={getDocumentFolderPath(relativePath)}
        icon={<CircuitBoard size={18} />}
        meta={meta}
        secondary={secondary}
      />
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Loading logic diagram...
          </div>
        )}
        {contextMenu && (
          <>
            <button
              type="button"
              aria-label="Close logic diagram context menu"
              className="absolute inset-0 z-20 cursor-default bg-transparent"
              onClick={closeContextMenu}
            />
            <div
              className="absolute z-30 w-[280px] max-w-[calc(100%-24px)] overflow-hidden rounded-xl border border-border/70 bg-popover/96 p-1 text-popover-foreground shadow-2xl ring-1 ring-black/5 backdrop-blur-xs-webkit app-panel-enter"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
                {contextMenu.kind === 'pane'
                  ? 'Add element'
                  : contextMenu.kind === 'edge'
                  ? 'Wire'
                  : contextTargetNode?.data.kind === 'group'
                  ? logicNodeLabel({ kind: 'group', label: contextTargetNode.data.label })
                  : 'Gate'}
              </div>

              {contextMenu.kind === 'pane' && (
                <div className="grid grid-cols-2 gap-1">
                  {GATE_CHOICES.map((gate) => (
                    <button
                      key={gate.kind}
                      type="button"
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                      onClick={() => runContextAction(() => addGateAt(gate.kind, contextMenu.flowPosition))}
                    >
                      <span>{gate.label}</span>
                      <Plus size={13} className="text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {contextMenu.kind === 'edge' && contextTargetEdge && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10"
                  onClick={() => runContextAction(() => deleteEdge(contextTargetEdge.id))}
                >
                  <Trash2 size={14} />
                  Delete wire
                </button>
              )}

              {contextMenu.kind === 'node' && contextTargetNode?.data.kind === 'group' && (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => runContextAction(() => openRenameGroup(contextTargetNode.id))}
                  >
                    <Pencil size={14} />
                    Rename group
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => runContextAction(ungroupSelection)}
                  >
                    <Ungroup size={14} />
                    Ungroup
                  </button>
                </div>
              )}

              {contextMenu.kind === 'node' && contextTargetNode?.data.kind !== 'group' && selectedGateNodes.length > 0 && (
                <>
                  {selectedInputNodes.length > 0 && (
                    <>
                      <div className="my-1 h-px bg-border/60" />
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                        onClick={() => runContextAction(() => toggleInputNodes(selectedInputNodes.map((node) => node.id)))}
                      >
                        <Power size={14} />
                        Toggle {selectedInputNodes.length > 1 ? `${selectedInputNodes.length} inputs` : 'input'}
                      </button>
                    </>
                  )}
                  <div className="my-1 h-px bg-border/60" />
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    Change {selectedGateNodes.length > 1 ? `${selectedGateNodes.length} gates` : 'gate'} to
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {GATE_CHOICES.map((gate) => (
                      <button
                        key={gate.kind}
                        type="button"
                        className="rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                        onClick={() => runContextAction(() => changeSelectedGateKind(gate.kind))}
                      >
                        {gate.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedItemCount > 0 && (
                <>
                  <div className="my-1 h-px bg-border/60" />
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    Selection
                  </div>
                  {selectedUngroupedGateNodes.length >= 2 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                      onClick={() => runContextAction(groupSelection)}
                    >
                      <Group size={14} />
                      Group selection
                    </button>
                  )}
                  {selectedGroupCount > 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                      onClick={() => runContextAction(ungroupSelection)}
                    >
                      <Ungroup size={14} />
                      Ungroup selected groups
                    </button>
                  )}
                  {selectedGroupCount === 1 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                      onClick={() => runContextAction(renameSelectedGroup)}
                    >
                      <Pencil size={14} />
                      Rename selected group
                    </button>
                  )}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10"
                    onClick={() => runContextAction(deleteSelection)}
                  >
                    <Trash2 size={14} />
                    Delete selection
                  </button>
                </>
              )}
            </div>
          </>
        )}
        <ReactFlow<LogicFlowNode, LogicFlowEdge>
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (changes.some((change) => change.type !== 'select')) markChanged();
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            if (changes.some((change) => change.type !== 'select')) markChanged();
          }}
          onConnect={onConnect}
          isValidConnection={isValidLogicConnection}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeDragStop={(_event, node) => snapDraggedNodesToGrid(node.id)}
          onMoveEnd={(_: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
            setViewportState(nextViewport);
          }}
          connectionMode={ConnectionMode.Loose}
          selectionOnDrag
          panOnDrag={[1]}
          panOnScroll
          zoomOnScroll={false}
          deleteKeyCode={null}
          nodesDraggable
          elementsSelectable
          nodesConnectable
          fitView
          minZoom={0.2}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        </ReactFlow>
      </div>
      <Dialog open={renameGroupId !== null} onOpenChange={(open) => {
        if (!open) {
          setRenameGroupId(null);
          setRenameGroupLabel('');
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename group</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              applyGroupRename();
            }}
          >
            <Input
              autoFocus
              value={renameGroupLabel}
              onChange={(event) => setRenameGroupLabel(event.target.value)}
              placeholder="Group name"
            />
            <DialogFooter className="border-none bg-transparent -mx-0 -mb-0 px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setRenameGroupId(null)}>
                Cancel
              </Button>
              <Button type="submit">
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LogicDiagramView(props: Props) {
  return (
    <ReactFlowProvider>
      <LogicDiagramEditor {...props} />
    </ReactFlowProvider>
  );
}
