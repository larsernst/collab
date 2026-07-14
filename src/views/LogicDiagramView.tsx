import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { getSmoothStepPath, type Connection, type Viewport } from '@xyflow/react';
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
  Shapes,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  captureLogicComponent,
  instantiateLogicComponentNode,
} from '../components/logic/logicDiagramComponents';
import {
  getLogicDiagramTemplates,
  instantiateLogicDiagramTemplate,
  type LogicDiagramTemplate,
} from '../components/logic/logicDiagramTemplates';
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
  type LogicComponentDefinition,
  type LogicComponentInstanceMode,
  type LogicGateKind,
  type LogicNodeKind,
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
const LOGIC_WHEEL_ZOOM_SENSITIVITY = 0.0008;
const LOGIC_CONNECTION_SNAP_RADIUS = 28;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const CONTEXT_MENU_WIDTH = 280;
const CONTEXT_MENU_HEIGHT = 420;
const LOGIC_SIGNAL_ON = 'color-mix(in oklch, var(--primary) 82%, white 18%)';
const LOGIC_SIGNAL_OFF = 'color-mix(in oklch, var(--muted-foreground) 72%, transparent)';
const LOGIC_SIGNAL_UNKNOWN = 'color-mix(in oklch, var(--border) 88%, white 12%)';
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

function nodeBaseWidth(node: LogicFlowNode) {
  if (node.data.kind === 'group') return typeof node.style?.width === 'number' ? node.style.width : 240;
  if (node.data.kind === 'component') return 144;
  return DEFAULT_GATE_WIDTH;
}

function nodeBaseHeight(node: LogicFlowNode) {
  if (node.data.kind === 'group') return typeof node.style?.height === 'number' ? node.style.height : 160;
  if (node.data.kind === 'component') return 80;
  return DEFAULT_GATE_HEIGHT;
}

function absoluteNodePosition(node: LogicFlowNode, nodesById: Map<string, LogicFlowNode>): { x: number; y: number } {
  if (!node.parentId) return node.position;
  const parent = nodesById.get(node.parentId);
  if (!parent) return node.position;
  const parentPosition = absoluteNodePosition(parent, nodesById);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

function flowToScreen(position: { x: number; y: number }, viewport: Viewport) {
  return {
    x: position.x * viewport.zoom + viewport.x,
    y: position.y * viewport.zoom + viewport.y,
  };
}

function screenToFlow(position: { x: number; y: number }, viewport: Viewport) {
  return {
    x: (position.x - viewport.x) / viewport.zoom,
    y: (position.y - viewport.y) / viewport.zoom,
  };
}

function getHandleAnchor(
  node: LogicFlowNode,
  handleId: string,
  type: 'source' | 'target',
  nodesById: Map<string, LogicFlowNode>,
) {
  const absolute = absoluteNodePosition(node, nodesById);
  const handles = type === 'source'
    ? getLogicOutputHandles(node.data.kind, node.data.component)
    : getLogicInputHandles(node.data.kind, node.data.component);
  const index = Math.max(0, handles.indexOf(handleId));
  const width = nodeBaseWidth(node);
  const height = nodeBaseHeight(node);
  const yRatio = handles.length <= 1 ? 0.5 : (0.34 + index * 0.32);
  return {
    x: absolute.x + (type === 'source' ? width : 0),
    y: absolute.y + height * yRatio,
  };
}

function logicEdgePath(
  edge: LogicFlowEdge,
  nodesById: Map<string, LogicFlowNode>,
  viewport: Viewport,
) {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!sourceNode || !targetNode) return null;
  const sourceHandles = getLogicOutputHandles(sourceNode.data.kind, sourceNode.data.component);
  const targetHandles = getLogicInputHandles(targetNode.data.kind, targetNode.data.component);
  const sourceHandle = edge.sourceHandle && sourceHandles.includes(edge.sourceHandle)
    ? edge.sourceHandle
    : sourceHandles[0];
  const targetHandle = edge.targetHandle && targetHandles.includes(edge.targetHandle)
    ? edge.targetHandle
    : targetHandles[0];
  if (!sourceHandle || !targetHandle) return null;
  const source = flowToScreen(getHandleAnchor(sourceNode, sourceHandle, 'source', nodesById), viewport);
  const target = flowToScreen(getHandleAnchor(targetNode, targetHandle, 'target', nodesById), viewport);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: 'right' as never,
    targetX: target.x,
    targetY: target.y,
    targetPosition: 'left' as never,
    borderRadius: 12 * viewport.zoom,
  });
  return { path, labelX, labelY, source, target };
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

function logicNodeActiveOverlay(kind: LogicNodeKind, data: LogicFlowNode['data']): CSSProperties | undefined {
  if (kind === 'group') return undefined;
  if (data.evaluatedValue === true || (kind === 'input' && data.value === true)) {
    return {
      background: LOGIC_NODE_ACTIVE_WASH,
    };
  }

  const inputHandles = getLogicInputHandles(kind, data.component);
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

function SharpLogicNode({
  node,
  viewport,
  nodesById,
  readOnly,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onHandlePointerDown,
  onHandlePointerUp,
}: {
  node: LogicFlowNode;
  viewport: Viewport;
  nodesById: Map<string, LogicFlowNode>;
  readOnly: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: LogicFlowNode) => void;
  onDoubleClick: (node: LogicFlowNode) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, node: LogicFlowNode) => void;
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, node: LogicFlowNode, handleId: string) => void;
  onHandlePointerUp: (event: ReactPointerEvent<HTMLButtonElement>, node: LogicFlowNode, handleId: string) => void;
}) {
  const { data, selected } = node;
  const kind = data.kind;
  const absolute = absoluteNodePosition(node, nodesById);
  const screen = flowToScreen(absolute, viewport);
  const width = nodeBaseWidth(node) * viewport.zoom;
  const height = nodeBaseHeight(node) * viewport.zoom;
  const zoom = viewport.zoom;
  if (kind === 'group') {
    return (
      <div
        onPointerDown={(event) => onPointerDown(event, node)}
        onDoubleClick={() => onDoubleClick(node)}
        onContextMenu={(event) => onContextMenu(event, node)}
        className={cn(
          'absolute flex items-start rounded border border-dashed bg-card/35 font-medium text-muted-foreground shadow-none',
          selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/80',
        )}
        style={{
          left: screen.x,
          top: screen.y,
          width,
          height,
          padding: `${8 * zoom}px ${12 * zoom}px`,
          fontSize: 11 * zoom,
          lineHeight: 1.25,
          borderRadius: 4 * zoom,
        }}
      >
        {logicNodeLabel({ kind, label: data.label })}
      </div>
    );
  }

  const inputHandles = getLogicInputHandles(kind, data.component);
  const outputHandles = getLogicOutputHandles(kind, data.component);
  const isInversion = kind === 'not' || kind === 'nand' || kind === 'nor' || kind === 'xnor';
  const displayValue = kind === 'output' ? data.evaluatedValue : data.value;
  const activeOverlay = logicNodeActiveOverlay(kind, data);
  const componentPorts = data.component?.definition.ports ?? [];
  const componentInputs = componentPorts.filter((port) => port.direction === 'input');
  const componentOutputs = componentPorts.filter((port) => port.direction === 'output');

  return (
    <div
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={() => onDoubleClick(node)}
      onContextMenu={(event) => onContextMenu(event, node)}
      className={cn(
        'absolute flex items-center justify-center overflow-hidden rounded border bg-card text-center shadow-sm transition-colors',
        kind === 'component' && 'bg-violet-500/5',
        selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70',
      )}
      style={{
        left: screen.x,
        top: screen.y,
        width,
        height,
        padding: `${8 * zoom}px ${kind === 'component' ? 16 * zoom : 12 * zoom}px`,
        borderRadius: 4 * zoom,
      }}
    >
      {activeOverlay ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
          style={activeOverlay}
        />
      ) : null}
      {inputHandles.map((handleId, index) => (
        <button
          key={handleId}
          type="button"
          data-logic-handle
          aria-label={`${logicNodeLabel({ kind, label: data.label })} input ${handleId}`}
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => onHandlePointerUp(event, node, handleId)}
          className="absolute z-20 cursor-crosshair rounded-full border border-border bg-background"
          style={{
            left: -5 * zoom,
            top: (inputHandles.length === 1 ? 0.5 : 0.34 + index * 0.32) * height,
            width: 10 * zoom,
            height: 10 * zoom,
            transform: 'translateY(-50%)',
          }}
        />
      ))}
      <div className="relative z-10 min-w-0">
        <div className="font-semibold uppercase tracking-normal text-foreground" style={{ fontSize: 11 * zoom, lineHeight: 1.2 }}>
          {logicNodeLabel({ kind, label: data.label })}
        </div>
        {kind === 'component' && (
          <div
            className="grid grid-cols-2 text-muted-foreground"
            style={{ marginTop: 4 * zoom, columnGap: 12 * zoom, fontSize: 9 * zoom, lineHeight: 1.2 }}
          >
            <span className="truncate text-left">{componentInputs.map((port) => port.label).join(', ')}</span>
            <span className="truncate text-right">{componentOutputs.map((port) => port.label).join(', ')}</span>
          </div>
        )}
        {(kind === 'input' || kind === 'output') && (
          <div className="text-muted-foreground" style={{ marginTop: 4 * zoom, fontSize: 10 * zoom, lineHeight: 1.2 }}>
            {typeof displayValue === 'boolean' ? (displayValue ? '1' : '0') : 'unset'}
          </div>
        )}
      </div>
      {isInversion && (
        <span
          className="absolute top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-background"
          style={{ right: -7 * zoom, width: 12 * zoom, height: 12 * zoom }}
        />
      )}
      {outputHandles.map((handleId, index) => (
        <button
          key={handleId}
          type="button"
          data-logic-handle
          aria-label={`${logicNodeLabel({ kind, label: data.label })} output ${handleId}`}
          disabled={readOnly}
          onPointerDown={(event) => onHandlePointerDown(event, node, handleId)}
          className="absolute z-20 cursor-crosshair rounded-full border border-border bg-background"
          style={{
            right: -5 * zoom,
            top: (outputHandles.length === 1 ? 0.5 : 0.34 + index * 0.32) * height,
            width: 10 * zoom,
            height: 10 * zoom,
            transform: 'translateY(-50%)',
          }}
        />
      ))}
    </div>
  );
}

function SharpLogicEdge({
  edge,
  geometry,
  selected,
  zoom,
  onPointerDown,
  onContextMenu,
  onDoubleClick,
}: {
  edge: LogicFlowEdge;
  geometry: NonNullable<ReturnType<typeof logicEdgePath>>;
  selected: boolean;
  zoom: number;
  onPointerDown: (event: ReactPointerEvent<SVGPathElement>, edge: LogicFlowEdge) => void;
  onContextMenu: (event: ReactMouseEvent<SVGPathElement>, edge: LogicFlowEdge) => void;
  onDoubleClick: (edge: LogicFlowEdge) => void;
}) {
  const signal = edge.data?.signal;
  const stroke = signal === true
    ? LOGIC_SIGNAL_ON
    : signal === false
    ? LOGIC_SIGNAL_OFF
    : LOGIC_SIGNAL_UNKNOWN;
  const markerId = `logic-wire-arrow-${edge.id}`;
  const strokeWidth = (signal === true ? 2.4 : 2) * zoom;
  const path = geometry.path;

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
      {selected ? (
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
        data-logic-edge
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16 * zoom}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
        style={{ cursor: 'pointer' }}
        onPointerDown={(event) => onPointerDown(event, edge)}
        onContextMenu={(event) => onContextMenu(event, edge)}
        onDoubleClick={() => onDoubleClick(edge)}
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
        pointerEvents="none"
      />
    </>
  );
}

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
  const [nodes, setNodes] = useState<LogicFlowNode[]>([]);
  const [edges, setEdges] = useState<LogicFlowEdge[]>([]);
  const [diagram, setDiagram] = useState<LogicDiagramDocument>(() =>
    createEmptyLogicDiagram(getDocumentBaseName(relativePath, 'Logic Diagram').replace(/\.logic$/i, '')),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedGate, setSelectedGate] = useState<LogicGateKind>('and');
  // Rename state — supports gates, groups, and wires via a discriminated target.
  const [renameTarget, setRenameTarget] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [componentPickerOpen, setComponentPickerOpen] = useState(false);
  const [componentSaveOpen, setComponentSaveOpen] = useState(false);
  const [componentName, setComponentName] = useState('');
  const [componentDescription, setComponentDescription] = useState('');
  const [componentInsertMode, setComponentInsertMode] = useState<LogicComponentInstanceMode>('snapshot');
  const [logicComponents, setLogicComponents] = useState<LogicComponentDefinition[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
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
  const panSessionRef = useRef<{ pointerId: number; start: { x: number; y: number }; viewport: Viewport } | null>(null);
  const dragSessionRef = useRef<{
    pointerId: number;
    nodeId: string;
    start: { x: number; y: number };
    positions: Map<string, { x: number; y: number }>;
    moved: boolean;
  } | null>(null);
  const selectionSessionRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    current: { x: number; y: number };
    additive: boolean;
    baseNodeIds: Set<string>;
    baseEdgeIds: Set<string>;
    moved: boolean;
  } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const connectionSessionRef = useRef<{
    sourceNodeId: string;
    sourceHandle: string;
    pointer: { x: number; y: number };
    target: { nodeId: string; handleId: string } | null;
  } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{
    sourceNodeId: string;
    sourceHandle: string;
    pointer: { x: number; y: number };
    target: { nodeId: string; handleId: string } | null;
  } | null>(null);
  const getViewport = useCallback(() => viewport, [viewport]);

  const structuralSignature = useCallback((flowNodes: LogicFlowNode[], flowEdges: LogicFlowEdge[]) =>
    JSON.stringify({
      nodes: flowNodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        label: node.data.label ?? null,
        value: node.data.value ?? null,
        component: node.data.component ?? null,
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
  const logicComponentsCapability = client?.runtime.logicComponents ?? null;
  const selectedEdgeIds = useMemo(
    () => edges.filter((edge) => edge.selected).map((edge) => edge.id),
    [edges],
  );
  const evaluation = useMemo(() => {
    const graph = fromFlowGraph(diagram, nodes, edges, viewport);
    return evaluateLogicDiagram(graph.nodes, graph.wires, { components: [...(diagram.components ?? []), ...logicComponents] });
  }, [diagram, edges, logicComponents, nodes, viewport]);
  const renderedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      evaluatedValue: evaluation.nodeValues[node.id],
      inputSignals: edges.reduce<Record<string, boolean | undefined>>((signals, edge) => {
        if (edge.target !== node.id) return signals;
        const targetHandles = getLogicInputHandles(node.data.kind, node.data.component);
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
  const nodesById = useMemo(() => new Map(renderedNodes.map((node) => [node.id, node])), [renderedNodes]);
  const edgeGeometries = useMemo(() => new Map(renderedEdges
    .map((edge) => [edge.id, logicEdgePath(edge, nodesById, viewport)] as const)
    .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof logicEdgePath>>] => entry[1] !== null)),
  [nodesById, renderedEdges, viewport]);

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
  }, [setEdges, setNodes, structuralSignature]);

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

  const markChanged = useCallback(() => {
    if (liveSessionRef.current) return;
    markDirty(relativePath);
  }, [markDirty, relativePath]);

  const reloadLogicComponents = useCallback(async () => {
    if (!logicComponentsCapability) {
      setLogicComponents([]);
      return;
    }
    setLoadingComponents(true);
    try {
      setLogicComponents(await logicComponentsCapability.list());
    } catch (error) {
      toast.error(`Failed to load logic components: ${error}`);
    } finally {
      setLoadingComponents(false);
    }
  }, [logicComponentsCapability]);

  useEffect(() => {
    void reloadLogicComponents();
  }, [reloadLogicComponents]);

  useEffect(() => {
    if (logicComponents.length === 0) return;
    const byId = new Map(logicComponents.map((component) => [component.id, component]));
    let changed = false;
    setNodes((current) => current.map((node) => {
      if (node.data.kind !== 'component' || node.data.component?.mode !== 'linked') return node;
      const componentId = node.data.component.componentId;
      const latest = componentId ? byId.get(componentId) : undefined;
      if (!latest || latest.version === node.data.component.definition.version) return node;
      changed = true;
      return {
        ...node,
        data: {
          ...node.data,
          label: latest.name,
          component: {
            ...node.data.component,
            definition: latest,
          },
        },
      };
    }));
    if (changed) markChanged();
  }, [logicComponents, markChanged, setNodes]);

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
    void duration;
    setViewportState(nextViewport);
  }, []);

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
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) return;
    const absoluteNodes = nodes.map((node) => {
      const position = absoluteNodePosition(node, new Map(nodes.map((candidate) => [candidate.id, candidate])));
      return {
        left: position.x,
        top: position.y,
        right: position.x + nodeBaseWidth(node),
        bottom: position.y + nodeBaseHeight(node),
      };
    });
    const left = Math.min(...absoluteNodes.map((node) => node.left));
    const top = Math.min(...absoluteNodes.map((node) => node.top));
    const right = Math.max(...absoluteNodes.map((node) => node.right));
    const bottom = Math.max(...absoluteNodes.map((node) => node.bottom));
    const padding = 64;
    const graphWidth = Math.max(1, right - left);
    const graphHeight = Math.max(1, bottom - top);
    const zoom = Math.min(
      MAX_LOGIC_ZOOM,
      Math.max(MIN_LOGIC_ZOOM, Math.min((rect.width - padding * 2) / graphWidth, (rect.height - padding * 2) / graphHeight)),
    );
    setViewportState({
      zoom,
      x: (rect.width - graphWidth * zoom) / 2 - left * zoom,
      y: (rect.height - graphHeight * zoom) / 2 - top * zoom,
    });
  }, [nodes]);

  const resolveLogicConnection = useCallback((connection: Connection) => {
    if (!canConnectLogicNodes(connection)) return;
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const sourceHandles = getLogicOutputHandles(sourceNode.data.kind, sourceNode.data.component);
    const targetHandles = getLogicInputHandles(targetNode.data.kind, targetNode.data.component);
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

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly) return;
    const resolved = resolveLogicConnection(connection);
    if (!resolved) return;
    setEdges((current) => [
      ...current,
      {
        id: `wire-${Date.now()}-${current.length}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: resolved.sourceHandle,
        targetHandle: resolved.targetHandle,
        type: 'logicWire',
      },
    ]);
    markChanged();
  }, [markChanged, readOnly, resolveLogicConnection, setEdges]);

  const getConnectionSnap = useCallback((
    pointer: { x: number; y: number },
    sourceNodeId: string,
    sourceHandle: string,
  ) => {
    let nearest: { nodeId: string; handleId: string; point: { x: number; y: number }; distance: number } | null = null;
    for (const node of renderedNodes) {
      if (node.id === sourceNodeId) continue;
      for (const handleId of getLogicInputHandles(node.data.kind, node.data.component)) {
        const resolved = resolveLogicConnection({
          source: sourceNodeId,
          target: node.id,
          sourceHandle,
          targetHandle: handleId,
        });
        if (!resolved || resolved.targetHandle !== handleId) continue;
        const point = flowToScreen(getHandleAnchor(node, handleId, 'target', nodesById), viewport);
        const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
        if (distance <= LOGIC_CONNECTION_SNAP_RADIUS && (!nearest || distance < nearest.distance)) {
          nearest = { nodeId: node.id, handleId, point, distance };
        }
      }
    }
    return nearest
      ? { pointer: nearest.point, target: { nodeId: nearest.nodeId, handleId: nearest.handleId } }
      : { pointer, target: null };
  }, [nodesById, renderedNodes, resolveLogicConnection, viewport]);

  const selectedGroups = useMemo(
    () => nodes.filter((node) => node.selected && node.data.kind === 'group'),
    [nodes],
  );

  const openRenameNode = useCallback((nodeId: string) => {
    if (readOnly) return;
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    setRenameTarget({ kind: 'node', id: nodeId });
    setRenameValue(logicNodeLabel({ kind: target.data.kind, label: target.data.label }));
  }, [nodes, readOnly]);

  const openRenameEdge = useCallback((edgeId: string) => {
    if (readOnly) return;
    const target = edges.find((edge) => edge.id === edgeId);
    if (!target) return;
    setRenameTarget({ kind: 'edge', id: edgeId });
    setRenameValue(typeof target.label === 'string' ? target.label : '');
  }, [edges, readOnly]);

  const renameSelectedNode = useCallback(() => {
    // Prefer a single selected group, then fall back to a single selected gate.
    if (selectedGroups.length === 1) {
      openRenameNode(selectedGroups[0].id);
      return;
    }
    const selectedNonGroup = nodes.filter((n) => n.selected && n.data.kind !== 'group');
    if (selectedNonGroup.length === 1) openRenameNode(selectedNonGroup[0].id);
  }, [nodes, openRenameNode, selectedGroups]);

  const applyRename = useCallback(() => {
    if (readOnly) return;
    if (!renameTarget) return;
    if (renameTarget.kind === 'node') {
      const nextLabel = renameValue.trim();
      setNodes((current) => current.map((node) => (
        node.id === renameTarget.id
          ? { ...node, data: { ...node.data, label: nextLabel || undefined } }
          : node
      )));
    } else {
      const nextLabel = renameValue.trim();
      setEdges((current) => current.map((edge) => (
        edge.id === renameTarget.id
          ? { ...edge, label: nextLabel || undefined }
          : edge
      )));
    }
    setRenameTarget(null);
    setRenameValue('');
    markChanged();
  }, [markChanged, readOnly, renameTarget, renameValue, setEdges, setNodes]);

  const groupSelection = useCallback(() => {
    if (readOnly) return;
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
  }, [markChanged, nodes, readOnly, setNodes]);

  const ungroupSelection = useCallback(() => {
    if (readOnly) return;
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
  }, [markChanged, nodes, readOnly, setNodes]);

  const addGateAt = useCallback((kind: LogicGateKind, position: { x: number; y: number }) => {
    if (readOnly) return;
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
  }, [markChanged, readOnly, setNodes]);

  const getViewportCenterClientPoint = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  const clientPointToFlowPosition = useCallback((point: { x: number; y: number }) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const local = rect
      ? { x: point.x - rect.left, y: point.y - rect.top }
      : point;
    return screenToFlow(local, viewport);
  }, [viewport]);

  const addGate = useCallback((kind: LogicGateKind) => {
    addGateAt(kind, clientPointToFlowPosition(getViewportCenterClientPoint()));
  }, [addGateAt, clientPointToFlowPosition, getViewportCenterClientPoint]);

  const insertTemplate = useCallback((template: LogicDiagramTemplate) => {
    if (readOnly) return;
    const doc = instantiateLogicDiagramTemplate(template);
    const flowGraph = toFlowGraph(doc);
    // Offset so appended templates don't overlap existing content.
    const offset = clientPointToFlowPosition(getViewportCenterClientPoint());
    setNodes((current) => [
      ...current,
      ...flowGraph.nodes.map((node) => ({
        ...node,
        position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
        selected: false,
      })),
    ]);
    setEdges((current) => [
      ...current,
      ...flowGraph.edges.map((edge) => ({ ...edge, selected: false })),
    ]);
    markChanged();
    setTemplatePickerOpen(false);
    window.setTimeout(fitLogicView, 60);
  }, [clientPointToFlowPosition, fitLogicView, getViewportCenterClientPoint, markChanged, readOnly, setEdges, setNodes]);

  const openSaveComponentDialog = useCallback(() => {
    if (readOnly) return;
    if (!logicComponentsCapability) {
      toast.error('Logic component libraries are not available for this vault.');
      return;
    }
    const selected = nodes.filter((node) => node.selected);
    setComponentName(selected.length > 0 ? 'Selected Component' : title);
    setComponentDescription('');
    setComponentSaveOpen(true);
  }, [logicComponentsCapability, nodes, readOnly, title]);

  const saveLogicComponent = useCallback(async () => {
    if (!logicComponentsCapability) return;
    const name = componentName.trim();
    if (!name) {
      toast.error('Name the component before saving.');
      return;
    }
    try {
      const current = fromFlowGraph(diagram, nodes, edges, getViewport() as Viewport);
      const capture = captureLogicComponent(current, selectedNodeIds, name, componentDescription);
      const saved = await logicComponentsCapability.save(capture.component);
      setLogicComponents((currentComponents) => [
        ...currentComponents.filter((component) => component.id !== saved.id && component.name.toLowerCase() !== saved.name.toLowerCase()),
        saved,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setComponentSaveOpen(false);
      toast.success(`Saved component "${saved.name}".`);
    } catch (error) {
      toast.error(`Failed to save component: ${error}`);
    }
  }, [componentDescription, componentName, diagram, edges, getViewport, logicComponentsCapability, nodes, selectedNodeIds]);

  const insertLogicComponent = useCallback((component: LogicComponentDefinition) => {
    if (readOnly) return;
    const position = snapPosition(clientPointToFlowPosition(getViewportCenterClientPoint()));
    const node = instantiateLogicComponentNode(component, componentInsertMode, position);
    setNodes((current) => [...current, { ...toFlowGraph({ ...createEmptyLogicDiagram(), nodes: [node], wires: [] }).nodes[0], selected: false }]);
    markChanged();
    setComponentPickerOpen(false);
  }, [clientPointToFlowPosition, componentInsertMode, getViewportCenterClientPoint, markChanged, readOnly, setNodes]);

  const duplicateSelection = useCallback(() => {
    if (readOnly) return;
    const selectedNodes = nodes.filter((node) => node.selected && node.data.kind !== 'group' && !node.parentId);
    if (selectedNodes.length === 0) return;
    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
    const idMap = new Map<string, string>();
    selectedNodes.forEach((node) => {
      const index = idCounterRef.current++;
      idMap.set(node.id, `dup-${Date.now()}-${index}`);
    });
    const duplicatedNodes: LogicFlowNode[] = selectedNodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      position: snapPosition({ x: node.position.x + 40, y: node.position.y + 40 }),
      selected: true,
      data: { ...node.data },
    }));
    const duplicatedEdges = edges
      .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
      .map((edge) => {
        const index = idCounterRef.current++;
        return {
          ...edge,
          id: `dup-wire-${Date.now()}-${index}`,
          source: idMap.get(edge.source)!,
          target: idMap.get(edge.target)!,
          selected: true,
        };
      });
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...duplicatedNodes,
    ]);
    setEdges((current) => [
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicatedEdges,
    ]);
    markChanged();
  }, [edges, markChanged, nodes, readOnly, setEdges, setNodes]);

  const toggleInputNodes = useCallback((nodeIds: string[]) => {
    if (readOnly) return;
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
  }, [markChanged, readOnly, setNodes]);

  const handleNodeDoubleClick = useCallback((node: LogicFlowNode) => {
    if (readOnly) return;
    if (node.data.kind === 'input') {
      toggleInputNodes([node.id]);
      return;
    }
    if (node.data.kind === 'group' || node.data.kind === 'output') {
      openRenameNode(node.id);
      return;
    }
    // Logic gates (and/or/not/xor/...) — open label editor
    openRenameNode(node.id);
  }, [openRenameNode, readOnly, toggleInputNodes]);

  const deleteSelection = useCallback(() => {
    if (readOnly) return;
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
  }, [edges, markChanged, nodes, readOnly, selectedEdgeIds, selectedNodeIds, setEdges, setNodes]);

  const deleteEdge = useCallback((edgeId: string) => {
    if (readOnly) return;
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    markChanged();
  }, [markChanged, readOnly, setEdges]);

  const changeSelectedGateKind = useCallback((kind: LogicGateKind) => {
    if (readOnly) return;
    if (kind === 'group') return;
    const selectedIds = new Set(selectedNodeIds);
    if (selectedIds.size === 0) return;
    const nextKindById = new Map(
      nodes
        .filter((node) => selectedIds.has(node.id) && node.data.kind !== 'group' && node.data.kind !== 'component')
        .map((node) => [node.id, kind]),
    );
    setNodes((current) => current.map((node) => (
      selectedIds.has(node.id) && node.data.kind !== 'group' && node.data.kind !== 'component'
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

        const sourceNode = nodes.find((node) => node.id === edge.source);
        const targetNode = nodes.find((node) => node.id === edge.target);
        const sourceHandles = getLogicOutputHandles(sourceKind, sourceNode?.data.component);
        const targetHandles = getLogicInputHandles(targetKind, targetNode?.data.component);
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
  }, [markChanged, nodes, readOnly, selectedNodeIds, setEdges, setNodes]);

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    const position = getMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: 'pane',
      ...position,
      flowPosition: clientPointToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [clientPointToFlowPosition, getMenuPosition, readOnly]);

  const handleNodeContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>, node: LogicFlowNode) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
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

  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent<SVGPathElement>, edge: LogicFlowEdge) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
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

  const handlePanePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    closeContextMenu();
    const target = event.target as HTMLElement;
    if (target.closest('[data-logic-node], [data-logic-handle], [data-logic-edge]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (event.button === 1) {
      panSessionRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        viewport,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    selectionSessionRef.current = {
      pointerId: event.pointerId,
      start: pointer,
      current: pointer,
      additive,
      baseNodeIds: new Set(nodes.filter((node) => node.selected).map((node) => node.id)),
      baseEdgeIds: new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id)),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!additive) {
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    }
  }, [closeContextMenu, edges, nodes, setEdges, setNodes, viewport]);

  const handlePaneWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      setViewportState((current) => {
        const wheelDelta = Math.max(-240, Math.min(240, event.deltaY));
        const nextZoom = Math.min(
          MAX_LOGIC_ZOOM,
          Math.max(MIN_LOGIC_ZOOM, current.zoom * Math.exp(-wheelDelta * LOGIC_WHEEL_ZOOM_SENSITIVITY)),
        );
        const flowPoint = screenToFlow(pointer, current);
        return {
          x: pointer.x - flowPoint.x * nextZoom,
          y: pointer.y - flowPoint.y * nextZoom,
          zoom: nextZoom,
        };
      });
      return;
    }
    setViewportState((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  }, []);

  const handlePanePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panSessionRef.current?.pointerId === event.pointerId) {
      const session = panSessionRef.current;
      setViewportState({
        ...session.viewport,
        x: session.viewport.x + event.clientX - session.start.x,
        y: session.viewport.y + event.clientY - session.start.y,
      });
      return;
    }
    if (dragSessionRef.current?.pointerId === event.pointerId) {
      const session = dragSessionRef.current;
      const moved = Math.abs(event.clientX - session.start.x) > 2 || Math.abs(event.clientY - session.start.y) > 2;
      if (moved) {
        dragSessionRef.current = { ...session, moved: true };
      }
      const delta = {
        x: (event.clientX - session.start.x) / viewport.zoom,
        y: (event.clientY - session.start.y) / viewport.zoom,
      };
      setNodes((current) => current.map((node) => {
        const start = session.positions.get(node.id);
        return start ? { ...node, position: snapPosition({ x: start.x + delta.x, y: start.y + delta.y }) } : node;
      }));
      return;
    }
    if (selectionSessionRef.current?.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const session = selectionSessionRef.current;
      const moved = Math.abs(pointer.x - session.start.x) > 2 || Math.abs(pointer.y - session.start.y) > 2;
      const left = Math.min(session.start.x, pointer.x);
      const top = Math.min(session.start.y, pointer.y);
      const right = Math.max(session.start.x, pointer.x);
      const bottom = Math.max(session.start.y, pointer.y);
      const selectedIds = new Set<string>();
      for (const node of renderedNodes) {
        const position = flowToScreen(absoluteNodePosition(node, nodesById), viewport);
        const nodeRight = position.x + nodeBaseWidth(node) * viewport.zoom;
        const nodeBottom = position.y + nodeBaseHeight(node) * viewport.zoom;
        if (position.x <= right && nodeRight >= left && position.y <= bottom && nodeBottom >= top) {
          selectedIds.add(node.id);
        }
      }
      const nextNodeIds = new Set(session.additive ? [...session.baseNodeIds, ...selectedIds] : selectedIds);
      const nextEdgeIds = new Set(session.additive ? session.baseEdgeIds : []);
      for (const edge of renderedEdges) {
        if (nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target)) {
          nextEdgeIds.add(edge.id);
        }
      }
      selectionSessionRef.current = { ...session, current: pointer, moved };
      setSelectionBox(moved ? { left, top, width: right - left, height: bottom - top } : null);
      setNodes((current) => current.map((node) => ({ ...node, selected: nextNodeIds.has(node.id) })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: nextEdgeIds.has(edge.id) })));
      return;
    }
    if (connectionSessionRef.current) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const pointer = rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : { x: event.clientX, y: event.clientY };
      const snapped = getConnectionSnap(
        pointer,
        connectionSessionRef.current.sourceNodeId,
        connectionSessionRef.current.sourceHandle,
      );
      connectionSessionRef.current = {
        ...connectionSessionRef.current,
        pointer: snapped.pointer,
        target: snapped.target,
      };
      setConnectionPreview({ ...connectionSessionRef.current });
    }
  }, [getConnectionSnap, nodesById, renderedEdges, renderedNodes, setEdges, setNodes, viewport]);

  const finishPointerSession = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panSessionRef.current?.pointerId === event.pointerId) {
      panSessionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    if (dragSessionRef.current?.pointerId === event.pointerId) {
      const { moved } = dragSessionRef.current;
      dragSessionRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (moved) markChanged();
    }
    if (selectionSessionRef.current?.pointerId === event.pointerId) {
      selectionSessionRef.current = null;
      setSelectionBox(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    if (connectionSessionRef.current) {
      const { sourceNodeId, sourceHandle, target } = connectionSessionRef.current;
      connectionSessionRef.current = null;
      setConnectionPreview(null);
      if (target) {
        onConnect({
          source: sourceNodeId,
          target: target.nodeId,
          sourceHandle,
          targetHandle: target.handleId,
        });
      }
    }
  }, [markChanged, onConnect]);

  const handleNodePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, node: LogicFlowNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    closeContextMenu();
    const shouldMultiSelect = event.shiftKey || event.ctrlKey || event.metaKey;
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setNodes((current) => {
      const clickedNode = current.find((candidate) => candidate.id === node.id);
      const shouldKeepExistingSelection = !shouldMultiSelect && clickedNode?.selected === true;
      const next = current.map((candidate) => {
        if (candidate.id === node.id) {
          return {
            ...candidate,
            selected: shouldMultiSelect ? !candidate.selected : true,
          };
        }
        if (shouldKeepExistingSelection || shouldMultiSelect) return candidate;
        return { ...candidate, selected: false };
      });
      const dragNodeIds = new Set(
        (shouldKeepExistingSelection ? current : next)
          .filter((candidate) => candidate.selected && candidate.data.kind !== 'group')
          .map((candidate) => candidate.id),
      );
      if (node.data.kind === 'group' || dragNodeIds.size === 0) {
        dragNodeIds.add(node.id);
      }
      dragSessionRef.current = {
        pointerId: event.pointerId,
        nodeId: node.id,
        start: { x: event.clientX, y: event.clientY },
        positions: new Map(next
          .filter((candidate) => dragNodeIds.has(candidate.id))
          .map((candidate) => [candidate.id, candidate.position])),
        moved: false,
      };
      return next;
    });
    const pane = viewportRef.current?.querySelector('[data-testid="logic-sharp-flow"]');
    if (pane instanceof HTMLElement) pane.setPointerCapture(event.pointerId);
  }, [closeContextMenu, markChanged, setEdges, setNodes]);

  const handleEdgePointerDown = useCallback((event: ReactPointerEvent<SVGPathElement>, edge: LogicFlowEdge) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    closeContextMenu();
    const shouldMultiSelect = event.shiftKey || event.ctrlKey || event.metaKey;
    setNodes((current) => shouldMultiSelect ? current : current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => current.map((candidate) => {
      if (candidate.id === edge.id) return { ...candidate, selected: shouldMultiSelect ? !candidate.selected : true };
      return shouldMultiSelect ? candidate : { ...candidate, selected: false };
    }));
  }, [closeContextMenu, setEdges, setNodes]);

  const handleOutputPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, node: LogicFlowNode, handleId: string) => {
    if (readOnly || event.button !== 0) return;
    event.stopPropagation();
    const rect = viewportRef.current?.getBoundingClientRect();
    const pointer = rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: event.clientX, y: event.clientY };
    const snapped = getConnectionSnap(pointer, node.id, handleId);
    connectionSessionRef.current = {
      sourceNodeId: node.id,
      sourceHandle: handleId,
      pointer: snapped.pointer,
      target: snapped.target,
    };
    setConnectionPreview(connectionSessionRef.current);
  }, [getConnectionSnap, readOnly]);

  const handleInputPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>, node: LogicFlowNode, handleId: string) => {
    if (readOnly) return;
    event.stopPropagation();
    const session = connectionSessionRef.current;
    connectionSessionRef.current = null;
    setConnectionPreview(null);
    if (!session) return;
    onConnect({
      source: session.sourceNodeId,
      target: node.id,
      sourceHandle: session.sourceHandle,
      targetHandle: handleId,
    });
  }, [onConnect, readOnly]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.altKey) return;
      const modifier = event.ctrlKey || event.metaKey;

      if (!modifier && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fitLogicView();
        return;
      }

      if ((modifier || !event.shiftKey) && event.key === '0') {
        event.preventDefault();
        resetZoom();
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

      if (readOnly) return;

      if (modifier && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }

      if (!modifier && event.key === 'F2') {
        event.preventDefault();
        renameSelectedNode();
        return;
      }

      // Duplicate selection
      if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelection();
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
      if (!modifier && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        addGate('or');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        addGate('nand');
        return;
      }
      if (!modifier && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        addGate('nor');
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
  }, [addGate, adjustZoom, deleteSelection, duplicateSelection, fitLogicView, groupSelection, nodes, readOnly, renameSelectedNode, resetZoom, selectedEdgeIds.length, selectedNodeIds.length, setEdges, setNodes, toggleInputNodes, ungroupSelection]);

  const zoomLabel = `${Math.round(viewport.zoom * 100)}%`;
  const selectedGateNodes = nodes.filter((node) => node.selected && node.data.kind !== 'group' && node.data.kind !== 'component');
  const selectedComponentNodes = nodes.filter((node) => node.selected && node.data.kind === 'component');
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
        <DocumentTopBarButton onClick={() => addGate(selectedGate)} disabled={readOnly}>
          <Plus size={14} />
          Add
        </DocumentTopBarButton>
        <DocumentTopBarButton
          onClick={() => setTemplatePickerOpen(true)}
          disabled={readOnly}
          title="Insert a starter template (half-adder, full-adder, multiplexer, etc.)"
        >
          <Shapes size={14} />
          Templates
        </DocumentTopBarButton>
        <DocumentTopBarButton
          onClick={() => setComponentPickerOpen(true)}
          disabled={readOnly || !logicComponentsCapability}
          title="Insert a reusable logic component"
        >
          <CircuitBoard size={14} />
          Components
        </DocumentTopBarButton>
        <DocumentTopBarButton
          onClick={openSaveComponentDialog}
          disabled={readOnly || !logicComponentsCapability || nodes.length === 0}
          title="Save the selection, or the whole diagram if nothing is selected, as a component"
        >
          <Save size={14} />
          Save component
        </DocumentTopBarButton>
      </div>
      <div className={documentTopBarGroupClass}>
        <DocumentTopBarIconButton
          title="Delete selected gates or wires"
          onClick={deleteSelection}
          disabled={readOnly || (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0)}
        >
          <Trash2 size={14} />
        </DocumentTopBarIconButton>
        <DocumentTopBarButton
          onClick={groupSelection}
          disabled={readOnly || nodes.filter((node) => node.selected && node.data.kind !== 'group' && !node.parentId).length < 2}
        >
          <Group size={14} />
          Group
        </DocumentTopBarButton>
        <DocumentTopBarIconButton
          title="Ungroup selected groups"
          onClick={ungroupSelection}
          disabled={readOnly || !nodes.some((node) => node.selected && node.data.kind === 'group')}
        >
          <Ungroup size={14} />
        </DocumentTopBarIconButton>
        <DocumentTopBarIconButton
          title="Rename selected gate or group (F2)"
          onClick={renameSelectedNode}
          disabled={readOnly || (selectedGroups.length !== 1 && selectedGateNodes.length !== 1 && selectedComponentNodes.length !== 1)}
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
        <DocumentTopBarButton onClick={handleSave} disabled={saving || loading || readOnly}>
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
    const componentCount = nodes.filter((node) => node.data.kind === 'component').length;
    const gateCount = nodes.filter((node) => node.data.kind !== 'group' && node.data.kind !== 'component').length;
    const groupCount = nodes.length - gateCount - componentCount;
    return { gateCount, groupCount, componentCount };
  }, [nodes]);

  const meta = (
    <div className="flex items-center gap-2">
      <DocumentStatusPill status={snapshot.status} compact />
      <LivePeers peers={livePeers} />
      <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
        {counts.gateCount} gates · {counts.componentCount} components · {counts.groupCount} groups · {edges.length} wires
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
                  : contextTargetNode?.data.kind === 'component'
                  ? 'Component'
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
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => runContextAction(() => openRenameEdge(contextTargetEdge.id))}
                  >
                    <Pencil size={14} />
                    Label wire
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10"
                    onClick={() => runContextAction(() => deleteEdge(contextTargetEdge.id))}
                  >
                    <Trash2 size={14} />
                    Delete wire
                  </button>
                </div>
              )}

              {contextMenu.kind === 'node' && contextTargetNode?.data.kind === 'group' && (
                <div className="space-y-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                    onClick={() => runContextAction(() => openRenameNode(contextTargetNode.id))}
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

              {contextMenu.kind === 'node' && contextTargetNode && contextTargetNode.data.kind !== 'group' && contextTargetNode.data.kind !== 'input' && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                  onClick={() => runContextAction(() => openRenameNode(contextTargetNode.id))}
                >
                  <Pencil size={14} />
                  Label {contextTargetNode.data.kind === 'output' ? 'output' : contextTargetNode.data.kind === 'component' ? 'component' : 'gate'}
                </button>
              )}

              {contextMenu.kind === 'node' && contextTargetNode?.data.kind !== 'group' && contextTargetNode?.data.kind !== 'component' && selectedGateNodes.length > 0 && (
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
                      onClick={() => runContextAction(renameSelectedNode)}
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
        <div
          data-testid="logic-sharp-flow"
          className="absolute inset-0 overflow-hidden bg-background outline-none"
          onPointerDown={handlePanePointerDown}
          onPointerMove={handlePanePointerMove}
          onPointerUp={finishPointerSession}
          onPointerCancel={finishPointerSession}
          onWheel={handlePaneWheel}
          onContextMenu={handlePaneContextMenu}
          style={{
            cursor: panSessionRef.current ? 'grabbing' : selectionSessionRef.current ? 'crosshair' : 'default',
            backgroundImage: 'radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 28%, transparent) 1px, transparent 1px)',
            backgroundSize: `${LOGIC_GRID * viewport.zoom}px ${LOGIC_GRID * viewport.zoom}px`,
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          }}
        >
          {selectionBox ? (
            <div
              className="pointer-events-none absolute z-30 rounded-sm border border-primary/75 bg-primary/12"
              style={{
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
              }}
            />
          ) : null}
          <svg className="absolute inset-0 size-full overflow-visible">
            {renderedEdges.map((edge) => {
              const geometry = edgeGeometries.get(edge.id);
              if (!geometry) return null;
              return (
                <SharpLogicEdge
                  key={edge.id}
                  edge={edge}
                  geometry={geometry}
                  selected={edge.selected === true}
                  zoom={viewport.zoom}
                  onPointerDown={handleEdgePointerDown}
                  onContextMenu={handleEdgeContextMenu}
                  onDoubleClick={(target) => openRenameEdge(target.id)}
                />
              );
            })}
            {connectionPreview ? (() => {
              const sourceNode = nodesById.get(connectionPreview.sourceNodeId);
              if (!sourceNode) return null;
              const source = flowToScreen(getHandleAnchor(sourceNode, connectionPreview.sourceHandle, 'source', nodesById), viewport);
              const [path] = getSmoothStepPath({
                sourceX: source.x,
                sourceY: source.y,
                sourcePosition: 'right' as never,
                targetX: connectionPreview.pointer.x,
                targetY: connectionPreview.pointer.y,
                targetPosition: 'left' as never,
                borderRadius: 12 * viewport.zoom,
              });
              return (
                <path
                  d={path}
                  fill="none"
                  stroke={LOGIC_SIGNAL_ON}
                  strokeWidth={2 * viewport.zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={`${8 * viewport.zoom} ${8 * viewport.zoom}`}
                  opacity={0.75}
                />
              );
            })() : null}
          </svg>
          {renderedEdges.map((edge) => {
            if (!edge.label) return null;
            const geometry = edgeGeometries.get(edge.id);
            if (!geometry) return null;
            return (
              <button
                key={`${edge.id}-label`}
                type="button"
                className="absolute rounded border border-border/60 bg-background/90 font-medium text-muted-foreground shadow-sm"
                style={{
                  left: geometry.labelX,
                  top: geometry.labelY,
                  transform: 'translate(-50%, -50%)',
                  padding: `${2 * viewport.zoom}px ${6 * viewport.zoom}px`,
                  fontSize: 10 * viewport.zoom,
                  lineHeight: 1.2,
                }}
                onDoubleClick={() => openRenameEdge(edge.id)}
              >
                {edge.label}
              </button>
            );
          })}
          {renderedNodes
            .filter((node) => {
              const position = flowToScreen(absoluteNodePosition(node, nodesById), viewport);
              const width = nodeBaseWidth(node) * viewport.zoom;
              const height = nodeBaseHeight(node) * viewport.zoom;
              const rect = viewportRef.current?.getBoundingClientRect();
              if (!rect) return true;
              return position.x + width >= -200 && position.y + height >= -200 && position.x <= rect.width + 200 && position.y <= rect.height + 200;
            })
            .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
            .map((node) => (
              <div key={node.id} data-logic-node>
                <SharpLogicNode
                  node={node}
                  viewport={viewport}
                  nodesById={nodesById}
                  readOnly={readOnly}
                  onPointerDown={handleNodePointerDown}
                  onDoubleClick={handleNodeDoubleClick}
                  onContextMenu={handleNodeContextMenu}
                  onHandlePointerDown={handleOutputPointerDown}
                  onHandlePointerUp={handleInputPointerUp}
                />
              </div>
            ))}
        </div>
      </div>
      <Dialog open={renameTarget !== null} onOpenChange={(open) => {
        if (!open) {
          setRenameTarget(null);
          setRenameValue('');
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {renameTarget?.kind === 'edge'
                ? 'Label wire'
                : renameTarget && nodes.find((n) => n.id === renameTarget.id)?.data.kind === 'group'
                ? 'Rename group'
                : renameTarget && nodes.find((n) => n.id === renameTarget.id)?.data.kind === 'output'
                ? 'Label output'
                : renameTarget && nodes.find((n) => n.id === renameTarget.id)?.data.kind === 'component'
                ? 'Label component'
                : 'Label gate'}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              applyRename();
            }}
          >
            <Input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              placeholder={renameTarget?.kind === 'edge' ? 'Wire label' : 'Label (leave empty for default)'}
            />
            <DialogFooter className="border-none bg-transparent -mx-0 -mb-0 px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button type="submit">
                {renameTarget?.kind === 'edge' ? 'Set label' : 'Rename'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Insert template</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {getLogicDiagramTemplates().map((template) => (
              <button
                key={template.id}
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border/60 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                onClick={() => insertTemplate(template)}
              >
                <span className="text-sm font-medium">{template.name}</span>
                <span className="text-xs text-muted-foreground">{template.description}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Templates are appended to the current diagram at the viewport center.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={componentPickerOpen} onOpenChange={setComponentPickerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Insert component</DialogTitle>
            <DialogDescription>
              Components are placed as single reusable nodes. Snapshot is the safe default; linked follows future library updates.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border border-border/60 p-2">
            <span className="text-xs text-muted-foreground">Mode</span>
            <Select value={componentInsertMode} onValueChange={(value) => setComponentInsertMode(value as LogicComponentInstanceMode)}>
              <SelectTrigger size="sm" className="h-8 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="snapshot">Snapshot</SelectItem>
                <SelectItem value="linked">Linked</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={() => void reloadLogicComponents()} disabled={loadingComponents}>
              {loadingComponents ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Refresh
            </Button>
          </div>
          <div className="max-h-[58vh] space-y-1.5 overflow-y-auto">
            {loadingComponents ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 size={15} className="mr-2 animate-spin" />
                Loading components...
              </div>
            ) : logicComponents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-8 text-center text-sm text-muted-foreground">
                No saved logic components in this vault yet.
              </div>
            ) : logicComponents.map((component) => {
              const inputs = component.ports.filter((port) => port.direction === 'input').map((port) => port.label).join(', ');
              const outputs = component.ports.filter((port) => port.direction === 'output').map((port) => port.label).join(', ');
              return (
                <button
                  key={component.id}
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded-lg border border-border/60 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                  onClick={() => insertLogicComponent(component)}
                >
                  <span className="text-sm font-medium">{component.name}</span>
                  {component.description && <span className="text-xs text-muted-foreground">{component.description}</span>}
                  <span className="text-[11px] text-muted-foreground">
                    In: {inputs || 'none'} · Out: {outputs || 'none'} · v{component.version}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={componentSaveOpen} onOpenChange={setComponentSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save component</DialogTitle>
            <DialogDescription>
              Saves selected nodes as a component. If nothing is selected, the whole logic file is captured.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLogicComponent();
            }}
          >
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="logic-component-name">Name</label>
              <Input
                id="logic-component-name"
                autoFocus
                value={componentName}
                onChange={(event) => setComponentName(event.target.value)}
                placeholder="Half adder"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="logic-component-description">Description</label>
              <Input
                id="logic-component-description"
                value={componentDescription}
                onChange={(event) => setComponentDescription(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              Ports are derived from captured input and output nodes. Labels must be unique for each direction.
            </div>
            <DialogFooter className="border-none bg-transparent -mx-0 -mb-0 px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setComponentSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save component</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LogicDiagramView(props: Props) {
  return <LogicDiagramEditor {...props} />;
}
