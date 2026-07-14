import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  CircleDot,
  Diamond,
  FileImage,
  FileText,
  FileWarning,
  Globe,
  ImageIcon,
  Info,
  Layout,
  LayoutDashboard,
  Link2,
  Milestone,
  Minus,
  PencilLine,
  Plus,
  Route,
  RotateCcw,
  SquareDashedKanban,
  Users,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type TouchEvent,
  type WheelEvent,
} from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { Banner, EmptyState, Spinner } from '../components/ui';
import { isCanvasFile, readCanvasDocument, type CanvasData, type CanvasNode } from '../lib/canvas';
import {
  isImageFile,
  isPdfFile,
  readMobileAssetDataUrl,
  uint8ArrayFromDataUrlChunked,
} from '../lib/assets';
import type { HostedFileEntry } from '../mobileTauri';
import { useMobileStore } from '../state/store';

const workerUrl = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();
GlobalWorkerOptions.workerSrc = workerUrl;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; dataUrl?: string; canvas?: CanvasData; source: 'network' | 'cache' }
  | { status: 'error'; message: string };
type PdfLayoutMode = 'single' | 'scroll';
type TouchPoint = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function statusForFile(file: HostedFileEntry, state: LoadState): string {
  if (state.status === 'ready') {
    return state.source === 'cache' ? 'Cached viewer' : 'Viewer';
  }
  if (isPdfFile(file)) return 'PDF viewer';
  if (isImageFile(file)) return 'Image viewer';
  if (isCanvasFile(file)) return 'Canvas viewer';
  return 'Viewer';
}

export function RichFileViewerScreen({ file }: { file: HostedFileEntry }) {
  const selected = useMobileStore((s) => s.selected);
  const statuses = useMobileStore((s) => s.statuses);
  const closeSheet = useMobileStore((s) => s.closeSheet);
  const connected = selected ? !!statuses[selected.serverUrl]?.connected : false;
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [zoom, setZoom] = useState(1);
  const [resetToken, setResetToken] = useState(0);
  const image = isImageFile(file);
  const pdf = isPdfFile(file);
  const canvas = isCanvasFile(file);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selected) return;
      setLoadState({ status: 'loading' });
      setZoom(1);
      try {
        if (canvas) {
          const result = await readCanvasDocument(selected.serverUrl, selected.vault.id, file, connected);
          if (!cancelled) setLoadState({ status: 'ready', canvas: result.canvas, source: result.source });
        } else {
          const result = await readMobileAssetDataUrl({
            serverUrl: selected.serverUrl,
            vaultId: selected.vault.id,
            file,
            connected,
          });
          if (!cancelled) setLoadState({ status: 'ready', ...result });
        }
      } catch (reason) {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canvas, connected, file, selected]);

  function adjustZoom(delta: number) {
    setZoom((value) => clamp(Number((value + delta).toFixed(2)), 0.35, 4));
  }

  function resetZoom() {
    setZoom(1);
    setResetToken((value) => value + 1);
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    adjustZoom(event.deltaY > 0 ? -0.12 : 0.12);
  }

  return (
    <div className="screen rich-viewer-screen">
      <header className="note-header">
        <button type="button" className="icon-button" aria-label="Back" onClick={closeSheet}>
          <ArrowLeft size={18} aria-hidden />
        </button>
        <div className="note-title">
          <h1 className="truncate">{file.name}</h1>
          <p>{statusForFile(file, loadState)}</p>
        </div>
        <div className="viewer-controls">
          <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => adjustZoom(-0.2)}>
            <Minus size={16} aria-hidden />
          </button>
          <button type="button" className="icon-button" aria-label="Reset zoom" onClick={resetZoom}>
            <RotateCcw size={16} aria-hidden />
          </button>
          <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => adjustZoom(0.2)}>
            <Plus size={16} aria-hidden />
          </button>
        </div>
      </header>

      {loadState.status === 'ready' && loadState.source === 'cache' ? (
        <Banner tone="info">Showing cached content. The server copy was not reachable.</Banner>
      ) : null}

      {loadState.status === 'loading' ? (
        <div className="loading-block">
          <Spinner size={22} />
          <span>Loading file...</span>
        </div>
      ) : loadState.status === 'error' ? (
        <EmptyState
          icon={<FileWarning size={28} aria-hidden />}
          title="Could not open file"
          message={loadState.message}
        />
      ) : image && loadState.dataUrl ? (
        <ImageMobileViewer
          dataUrl={loadState.dataUrl}
          name={file.name}
          zoom={zoom}
          setZoom={setZoom}
          resetToken={resetToken}
          onWheel={handleWheel}
        />
      ) : pdf && loadState.dataUrl ? (
        <PdfMobileViewer file={file} dataUrl={loadState.dataUrl} zoom={zoom} setZoom={setZoom} />
      ) : canvas && loadState.canvas ? (
        <CanvasMobileViewer
          canvas={loadState.canvas}
          zoom={zoom}
          setZoom={setZoom}
          resetToken={resetToken}
          onWheel={handleWheel}
        />
      ) : (
        <EmptyState
          icon={<ImageIcon size={28} aria-hidden />}
          title="Unsupported viewer"
          message="This file type does not have a mobile viewer yet."
        />
      )}
    </div>
  );
}

function touchPoint(touch: Pick<globalThis.Touch, 'clientX' | 'clientY'>): TouchPoint {
  return { x: touch.clientX, y: touch.clientY };
}

function distanceBetween(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: TouchPoint, second: TouchPoint): TouchPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function ImageMobileViewer({
  dataUrl,
  name,
  zoom,
  setZoom,
  resetToken,
  onWheel,
}: {
  dataUrl: string;
  name: string;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  resetToken: number;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
}) {
  const stageRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<TouchPoint | null>(null);
  const pinchRef = useRef<{ distance: number; center: TouchPoint } | null>(null);
  const [pan, setPan] = useState<TouchPoint>({ x: 0, y: 0 });

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [dataUrl, resetToken]);

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  function clampPan(next: TouchPoint, nextZoom = zoom): TouchPoint {
    const stage = stageRef.current;
    if (!stage || nextZoom <= 1) return { x: 0, y: 0 };
    const limitX = Math.max(0, (stage.clientWidth * (nextZoom - 1)) / 2);
    const limitY = Math.max(0, (stage.clientHeight * (nextZoom - 1)) / 2);
    return {
      x: clamp(next.x, -limitX, limitX),
      y: clamp(next.y, -limitY, limitY),
    };
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 1) {
      dragRef.current = touchPoint(event.touches[0]);
      pinchRef.current = null;
      return;
    }
    if (event.touches.length === 2) {
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      dragRef.current = null;
      pinchRef.current = { distance: distanceBetween(first, second), center: midpoint(first, second) };
    }
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      const center = midpoint(first, second);
      const currentDistance = distanceBetween(first, second);
      const previous = pinchRef.current;
      const ratio = currentDistance / Math.max(1, previous.distance);
      pinchRef.current = { distance: currentDistance, center };
      setZoom((value) => {
        const nextZoom = clamp(Number((value * ratio).toFixed(3)), 0.5, 5);
        setPan((current) =>
          clampPan(
            {
              x: current.x + center.x - previous.center.x,
              y: current.y + center.y - previous.center.y,
            },
            nextZoom,
          ),
        );
        return nextZoom;
      });
      return;
    }

    if (event.touches.length === 1 && dragRef.current && zoom > 1) {
      event.preventDefault();
      const current = touchPoint(event.touches[0]);
      const previous = dragRef.current;
      dragRef.current = current;
      setPan((value) => clampPan({ x: value.x + current.x - previous.x, y: value.y + current.y - previous.y }));
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 1) {
      dragRef.current = touchPoint(event.touches[0]);
      pinchRef.current = null;
      return;
    }
    dragRef.current = null;
    pinchRef.current = null;
  }

  const style = {
    '--viewer-zoom': zoom,
    '--viewer-pan-x': `${pan.x}px`,
    '--viewer-pan-y': `${pan.y}px`,
  } as CSSProperties;

  return (
    <section
      ref={stageRef}
      className="viewer-stage image-stage"
      style={style}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onWheel={onWheel}
    >
      <img src={dataUrl} alt={name} draggable={false} />
    </section>
  );
}

type CanvasBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
  padding: number;
};

function canvasNodeTitle(node: CanvasNode): string {
  const record = node as unknown as Record<string, unknown>;
  if (typeof record.title === 'string' && record.title.trim()) return record.title;
  if (typeof record.relativePath === 'string' && record.relativePath.trim()) return record.relativePath.split('/').pop() ?? record.relativePath;
  if (typeof record.url === 'string' && record.url.trim()) return record.url;
  if (typeof record.content === 'string' && record.content.trim()) return record.content.trim().split('\n')[0] ?? 'Text';
  if (typeof record.glyph === 'string' && record.glyph.trim()) return record.glyph;
  return `${node.type[0]?.toUpperCase() ?? 'N'}${node.type.slice(1)} node`;
}

function canvasNodeSubtitle(node: CanvasNode): string | null {
  const record = node as unknown as Record<string, unknown>;
  if (typeof record.relativePath === 'string' && record.relativePath.trim()) return record.relativePath;
  if (typeof record.linkedRelativePath === 'string' && record.linkedRelativePath.trim()) return record.linkedRelativePath;
  if (typeof record.url === 'string' && record.url.trim()) return record.url;
  if (typeof record.iconLabel === 'string' && record.iconLabel.trim()) return record.iconLabel;
  return null;
}

function canvasNodeBody(node: CanvasNode): string | null {
  const record = node as unknown as Record<string, unknown>;
  for (const key of ['description', 'body', 'content']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

const PLANNING_NODE_LABELS: Record<string, string> = {
  process: 'Process',
  decision: 'Decision',
  terminator: 'Start / End',
  document: 'Document',
  milestone: 'Milestone',
  actor: 'Actor',
  group: 'Group',
  swimlane: 'Swimlane',
  junction: 'Junction',
  crossing: 'Crossing',
};

function canvasNodeKindLabel(node: CanvasNode): string {
  if (node.type === 'note') return 'Note';
  if (node.type === 'file') return 'File';
  if (node.type === 'text') return 'Canvas note';
  if (node.type === 'web') return 'Website';
  if (node.type === 'symbol') return 'Nerd Font icon';
  return PLANNING_NODE_LABELS[node.type] ?? node.type;
}

function canvasRecord(node: CanvasNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function canvasString(node: CanvasNode, key: string): string | null {
  const value = canvasRecord(node)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function fileExtensionFromPath(path: string | null): string {
  if (!path) return 'file';
  const clean = path.split(/[?#]/)[0] ?? path;
  const dot = clean.lastIndexOf('.');
  return dot > -1 ? clean.slice(dot + 1).toLowerCase() : 'file';
}

function planningIcon(node: CanvasNode) {
  switch (node.type) {
    case 'process':
      return <Route size={14} aria-hidden />;
    case 'decision':
      return <Diamond size={14} aria-hidden />;
    case 'terminator':
      return <CheckCircle2 size={14} aria-hidden />;
    case 'document':
      return <FileText size={14} aria-hidden />;
    case 'milestone':
      return <Milestone size={14} aria-hidden />;
    case 'actor':
      return <Users size={14} aria-hidden />;
    case 'group':
      return <SquareDashedKanban size={14} aria-hidden />;
    case 'swimlane':
      return <Layout size={14} aria-hidden />;
    case 'junction':
      return <CircleDot size={12} aria-hidden />;
    case 'crossing':
      return <Route size={14} aria-hidden />;
    default:
      return <Route size={14} aria-hidden />;
  }
}

function canvasNodeIcon(node: CanvasNode) {
  if (node.type === 'note') return <FileText size={14} aria-hidden />;
  if (node.type === 'text') return <PencilLine size={14} aria-hidden />;
  if (node.type === 'web') return <Globe size={14} aria-hidden />;
  if (node.type === 'file') {
    const ext = fileExtensionFromPath(canvasString(node, 'relativePath'));
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) {
      return <FileImage size={14} aria-hidden />;
    }
    if (ext === 'canvas') return <Layout size={14} aria-hidden />;
    if (ext === 'kanban') return <LayoutDashboard size={14} aria-hidden />;
    return <FileText size={14} aria-hidden />;
  }
  return planningIcon(node);
}

function planningBadges(node: CanvasNode): Array<{ key: string; label: string; tone?: string }> {
  const planning = asCanvasRecord(canvasRecord(node).planning);
  if (!planning) return [];
  const tags = Array.isArray(planning.tags)
    ? planning.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];
  return [
    typeof planning.status === 'string' ? { key: 'status', label: planning.status.replace(/_/g, ' ') } : null,
    typeof planning.priority === 'string' ? { key: 'priority', label: planning.priority, tone: planning.priority } : null,
    typeof planning.ownerLabel === 'string' ? { key: 'owner', label: planning.ownerLabel } : null,
    typeof planning.dueDate === 'string' ? { key: 'due', label: planning.dueDate } : null,
    ...tags.slice(0, 3).map((tag) => ({ key: `tag-${tag}`, label: `#${tag}` })),
  ].filter((badge): badge is { key: string; label: string; tone?: string } => !!badge);
}

function computeCanvasBounds(nodes: CanvasNode[]): CanvasBounds {
  const padding = 120;
  if (nodes.length === 0) return { minX: 0, minY: 0, width: 640, height: 420, padding };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.width);
    maxY = Math.max(maxY, node.position.y + node.height);
  }
  return {
    minX,
    minY,
    width: Math.max(320, maxX - minX + padding * 2),
    height: Math.max(240, maxY - minY + padding * 2),
    padding,
  };
}

function mobileCanvasNodeStyle(node: CanvasNode, bounds: CanvasBounds): CSSProperties {
  return {
    left: `${node.position.x - bounds.minX + bounds.padding}px`,
    top: `${node.position.y - bounds.minY + bounds.padding}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
  };
}

function CanvasMobileViewer({
  canvas,
  zoom,
  setZoom,
  resetToken,
  onWheel,
}: {
  canvas: CanvasData;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  resetToken: number;
  onWheel: (event: WheelEvent<HTMLElement>) => void;
}) {
  const stageRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<TouchPoint | null>(null);
  const pinchRef = useRef<{ distance: number; center: TouchPoint } | null>(null);
  const [pan, setPan] = useState<TouchPoint>({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [animateEdges, setAnimateEdges] = useState(false);
  const [stageWidth, stageHeight] = useElementSize(stageRef);
  const lastFitKeyRef = useRef<string | null>(null);
  const bounds = useMemo(() => computeCanvasBounds(canvas.nodes), [canvas.nodes]);
  const nodeById = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, node])), [canvas.nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;

  function fitToStage() {
    const stage = stageRef.current;
    if (!stage) return;
    const fitKey = `${bounds.width}:${bounds.height}:${resetToken}:${stage.clientWidth}:${stage.clientHeight}`;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;
    const fitZoom = clamp(
      Math.min((stage.clientWidth - 28) / bounds.width, (stage.clientHeight - 28) / bounds.height),
      0.08,
      1.25,
    );
    setZoom(Number(fitZoom.toFixed(3)));
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    fitToStage();
    // Fit after the stage has a measured size and when explicit reset is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.height, bounds.width, resetToken, stageHeight, stageWidth]);

  function clampCanvasPan(next: TouchPoint, nextZoom = zoom): TouchPoint {
    const stage = stageRef.current;
    if (!stage) return next;
    const overflowX = Math.max(0, bounds.width * nextZoom - stage.clientWidth);
    const overflowY = Math.max(0, bounds.height * nextZoom - stage.clientHeight);
    return {
      x: clamp(next.x, -overflowX / 2 - 80, overflowX / 2 + 80),
      y: clamp(next.y, -overflowY / 2 - 80, overflowY / 2 + 80),
    };
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 2) {
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      pinchRef.current = { distance: distanceBetween(first, second), center: midpoint(first, second) };
      dragRef.current = null;
      return;
    }
    if (event.touches.length === 1) {
      dragRef.current = touchPoint(event.touches[0]);
      pinchRef.current = null;
    }
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      const center = midpoint(first, second);
      const distance = distanceBetween(first, second);
      const previous = pinchRef.current;
      const ratio = distance / Math.max(1, previous.distance);
      pinchRef.current = { distance, center };
      setZoom((value) => {
        const nextZoom = clamp(Number((value * ratio).toFixed(3)), 0.25, 3);
        setPan((current) =>
          clampCanvasPan(
            {
              x: current.x + center.x - previous.center.x,
              y: current.y + center.y - previous.center.y,
            },
            nextZoom,
          ),
        );
        return nextZoom;
      });
      return;
    }
    if (event.touches.length === 1 && dragRef.current) {
      event.preventDefault();
      const current = touchPoint(event.touches[0]);
      const previous = dragRef.current;
      dragRef.current = current;
      setPan((value) => clampCanvasPan({ x: value.x + current.x - previous.x, y: value.y + current.y - previous.y }));
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 1) {
      dragRef.current = touchPoint(event.touches[0]);
      pinchRef.current = null;
      return;
    }
    dragRef.current = null;
    pinchRef.current = null;
  }

  const worldStyle = {
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
  } as CSSProperties;

  return (
    <section
      ref={stageRef}
      className="viewer-stage canvas-stage"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onWheel={onWheel}
    >
      {canvas.nodes.length > 0 ? (
        <div className="canvas-viewer-options">
          <button
            type="button"
            className={animateEdges ? 'selected' : ''}
            onClick={() => setAnimateEdges((value) => !value)}
          >
            Animate
          </button>
        </div>
      ) : null}
      {canvas.nodes.length === 0 ? (
        <EmptyState
          icon={<Info size={28} aria-hidden />}
          title="Empty canvas"
          message="This canvas does not contain any nodes yet."
        />
      ) : (
        <div className={`mobile-canvas-world ${animateEdges ? 'animate-edges' : ''}`} style={worldStyle}>
          <svg className="mobile-canvas-edges" viewBox={`0 0 ${bounds.width} ${bounds.height}`} aria-hidden>
            {canvas.edges.map((edge) => {
              const source = nodeById.get(edge.source);
              const target = nodeById.get(edge.target);
              if (!source || !target) return null;
              const sourceX = source.position.x - bounds.minX + bounds.padding + source.width / 2;
              const sourceY = source.position.y - bounds.minY + bounds.padding + source.height / 2;
              const targetX = target.position.x - bounds.minX + bounds.padding + target.width / 2;
              const targetY = target.position.y - bounds.minY + bounds.padding + target.height / 2;
              const curve = Math.max(40, Math.abs(targetX - sourceX) * 0.45);
              return (
                <path
                  key={edge.id}
                  className={`mobile-canvas-edge ${edge.lineStyle ?? 'solid'} ${edge.animated ? 'edge-animated' : ''}`}
                  d={`M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`}
                />
              );
            })}
          </svg>
          {canvas.nodes.map((node) => (
            <MobileCanvasNodeView
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              style={mobileCanvasNodeStyle(node, bounds)}
              onSelect={() => setSelectedNodeId(node.id)}
            />
          ))}
        </div>
      )}
      {selectedNode ? (
        <CanvasNodeDetail node={selectedNode} onClose={() => setSelectedNodeId(null)} />
      ) : null}
    </section>
  );
}

function MobileCanvasNodeView({
  node,
  selected,
  style,
  onSelect,
}: {
  node: CanvasNode;
  selected: boolean;
  style: CSSProperties;
  onSelect: () => void;
}) {
  const record = canvasRecord(node);
  const title = canvasNodeTitle(node);
  const subtitle = canvasNodeSubtitle(node);
  const body = canvasNodeBody(node);
  const badges = planningBadges(node);
  const symbolGlyph = canvasString(node, 'glyph') ?? '?';
  const symbolLabel = canvasString(node, 'iconLabel') ?? canvasString(node, 'iconId') ?? 'Nerd Font icon';

  if (node.type === 'junction') {
    return (
      <button
        type="button"
        className={`mobile-canvas-node desktop-canvas-node desktop-node-junction ${selected ? 'selected' : ''}`}
        style={style}
        onClick={onSelect}
      >
        <span className="desktop-node-junction-dot">
          <CircleDot size={12} aria-hidden />
        </span>
      </button>
    );
  }

  if (node.type === 'crossing') {
    return (
      <button
        type="button"
        className={`mobile-canvas-node desktop-canvas-node desktop-node-crossing ${selected ? 'selected' : ''}`}
        style={style}
        onClick={onSelect}
      >
        <span className="desktop-node-crossing-h" />
        <span className="desktop-node-crossing-v" />
        <span className="desktop-node-crossing-label">Crossing</span>
      </button>
    );
  }

  if (node.type === 'decision') {
    return (
      <button
        type="button"
        className={`mobile-canvas-node desktop-canvas-node desktop-node-decision ${selected ? 'selected' : ''}`}
        style={style}
        onClick={onSelect}
      >
        <span className="desktop-node-icon round">{canvasNodeIcon(node)}</span>
        <strong>{title}</strong>
        {body ? <p>{body}</p> : <p>Branch condition</p>}
      </button>
    );
  }

  if (node.type === 'terminator') {
    return (
      <button
        type="button"
        className={`mobile-canvas-node desktop-canvas-node desktop-node-terminator ${selected ? 'selected' : ''}`}
        style={style}
        onClick={onSelect}
      >
        <span className="desktop-node-icon round">{canvasNodeIcon(node)}</span>
        <strong>{title}</strong>
        {body ? <p>{body}</p> : null}
      </button>
    );
  }

  if (node.type === 'symbol') {
    return (
      <button
        type="button"
        className={`mobile-canvas-node desktop-canvas-node desktop-node-symbol ${selected ? 'selected' : ''}`}
        style={style}
        onClick={onSelect}
      >
        <span className="desktop-node-symbol-glyph" aria-label={symbolLabel}>
          {symbolGlyph}
        </span>
        <strong>{title}</strong>
        <small>{symbolLabel}</small>
      </button>
    );
  }

  const isPlanning = node.type !== 'note' && node.type !== 'file' && node.type !== 'text' && node.type !== 'web';
  const isImageFile = node.type === 'file' && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(fileExtensionFromPath(canvasString(node, 'relativePath')));
  const imageSrc = typeof record.imageSrc === 'string' ? record.imageSrc : null;

  return (
    <button
      type="button"
      className={[
        'mobile-canvas-node desktop-canvas-node desktop-node-card',
        `desktop-node-${node.type}`,
        selected ? 'selected' : '',
      ].join(' ')}
      style={style}
      onClick={onSelect}
    >
      <span className="desktop-node-header">
        <span className="desktop-node-icon">{canvasNodeIcon(node)}</span>
        <span className="desktop-node-title-stack">
          <strong>{title}</strong>
          <small>{subtitle ?? canvasNodeKindLabel(node)}</small>
        </span>
        {node.type === 'milestone' && asCanvasRecord(record.planning)?.milestoneLabel ? (
          <span className="desktop-node-badge">{String(asCanvasRecord(record.planning)?.milestoneLabel)}</span>
        ) : null}
      </span>
      <span className="desktop-node-body">
        {isImageFile && imageSrc ? (
          <span className="desktop-node-image-wrap">
            <img src={imageSrc} alt={title} draggable={false} />
          </span>
        ) : node.type === 'web' ? (
          <>
            <span className="desktop-node-web-preview">
              <Globe size={22} aria-hidden />
            </span>
            <span className="desktop-node-text">{body ?? canvasString(node, 'url') ?? 'Preview details will appear here when available.'}</span>
          </>
        ) : (
          <span className="desktop-node-text">
            {body ??
              (node.type === 'note'
                ? 'Double-click to open the note.'
                : node.type === 'file'
                  ? 'Double-click to open this file.'
                  : isPlanning
                    ? 'Add context from the node inspector.'
                    : 'Write directly on the canvas...')}
          </span>
        )}
        {badges.length > 0 ? (
          <span className="desktop-node-badges">
            {badges.map((badge) => (
              <span key={badge.key} className={badge.tone ? `tone-${badge.tone}` : ''}>
                {badge.key === 'due' ? <Calendar size={10} aria-hidden /> : null}
                {badge.label}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function CanvasNodeDetail({ node, onClose }: { node: CanvasNode; onClose: () => void }) {
  const record = node as unknown as Record<string, unknown>;
  const planning = asCanvasRecord(record.planning);
  const tags = Array.isArray(planning?.tags) ? planning.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const details = [
    ['Type', node.type],
    ['Path', typeof record.relativePath === 'string' ? record.relativePath : null],
    ['Linked', typeof record.linkedRelativePath === 'string' ? record.linkedRelativePath : null],
    ['URL', typeof record.url === 'string' ? record.url : null],
    ['Owner', typeof planning?.ownerLabel === 'string' ? planning.ownerLabel : null],
    ['Status', typeof planning?.status === 'string' ? planning.status.replace(/_/g, ' ') : null],
    ['Priority', typeof planning?.priority === 'string' ? planning.priority : null],
    ['Due', typeof planning?.dueDate === 'string' ? planning.dueDate : null],
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0);

  return (
    <aside className="canvas-node-detail" aria-label="Canvas node details">
      <div className="canvas-node-detail-head">
        <div>
          <span>{node.type}</span>
          <strong>{canvasNodeTitle(node)}</strong>
        </div>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          <ArrowLeft size={16} aria-hidden />
        </button>
      </div>
      {canvasNodeBody(node) ? <p>{canvasNodeBody(node)}</p> : null}
      {details.length > 0 ? (
        <dl>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {tags.length > 0 ? (
        <div className="canvas-node-tags">
          {tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      ) : null}
      {'url' in record && typeof record.url === 'string' ? (
        <div className="canvas-node-detail-link">
          <Globe size={14} aria-hidden />
          <span>{record.url}</span>
        </div>
      ) : null}
      {'linkedRelativePath' in record && typeof record.linkedRelativePath === 'string' ? (
        <div className="canvas-node-detail-link">
          <Link2 size={14} aria-hidden />
          <span>{record.linkedRelativePath}</span>
        </div>
      ) : null}
    </aside>
  );
}

function asCanvasRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function PdfMobileViewer({
  file,
  dataUrl,
  zoom,
  setZoom,
}: {
  file: HostedFileEntry;
  dataUrl: string;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<TouchPoint | null>(null);
  const pinchRef = useRef<{ distance: number; center: TouchPoint } | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageDirection, setPageDirection] = useState<0 | -1 | 1>(0);
  const [pan, setPan] = useState<TouchPoint>({ x: 0, y: 0 });
  const [pageCount, setPageCount] = useState(0);
  const [layoutMode, setLayoutMode] = useState<PdfLayoutMode>('single');
  const [stageWidth] = useElementSize(stageRef);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scale = useMemo(() => clamp(zoom, 0.45, 3.5), [zoom]);
  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setDocument(null);
    setPageNumber(1);
    setPageCount(0);
    let task: ReturnType<typeof getDocument> | null = null;
    uint8ArrayFromDataUrlChunked(dataUrl)
      .then((data) => {
        if (cancelled) return null;
        task = getDocument({ data });
        return task.promise;
      })
      .then((pdf) => {
        if (!pdf) return;
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        setDocument(pdf);
        setPageCount(pdf.numPages);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [dataUrl]);

  useEffect(() => () => void document?.destroy(), [document]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [dataUrl, layoutMode, pageNumber]);

  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  function clampPdfPan(next: TouchPoint, nextZoom = zoom): TouchPoint {
    const stage = stageRef.current;
    if (!stage || layoutMode !== 'single' || nextZoom <= 1) return { x: 0, y: 0 };
    const limitX = Math.max(0, (stage.clientWidth * (nextZoom - 1)) / 2);
    const limitY = Math.max(0, (stage.clientHeight * (nextZoom - 1)) / 2);
    return {
      x: clamp(next.x, -limitX, limitX),
      y: clamp(next.y, -limitY, limitY),
    };
  }

  function changePage(delta: -1 | 1) {
    setPageNumber((page) => {
      const nextPage = clamp(page + delta, 1, Math.max(1, pageCount));
      if (nextPage !== page) setPageDirection(delta);
      return nextPage;
    });
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 2) {
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      pinchRef.current = { distance: distanceBetween(first, second), center: midpoint(first, second) };
      swipeStartRef.current = null;
      dragRef.current = null;
      return;
    }
    pinchRef.current = null;
    if (layoutMode !== 'single' || event.touches.length !== 1) return;
    const point = touchPoint(event.touches[0]);
    if (zoom > 1) {
      dragRef.current = point;
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = point;
  }

  function handleTouchMove(event: TouchEvent<HTMLElement>) {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault();
      const first = touchPoint(event.touches[0]);
      const second = touchPoint(event.touches[1]);
      const center = midpoint(first, second);
      const distance = distanceBetween(first, second);
      const previous = pinchRef.current;
      const ratio = distance / Math.max(1, previous.distance);
      pinchRef.current = { distance, center };
      setZoom((value) => {
        const nextZoom = clamp(Number((value * ratio).toFixed(3)), 0.5, 4);
        setPan((current) =>
          clampPdfPan(
            {
              x: current.x + center.x - previous.center.x,
              y: current.y + center.y - previous.center.y,
            },
            nextZoom,
          ),
        );
        return nextZoom;
      });
      return;
    }

    if (layoutMode === 'single' && event.touches.length === 1 && dragRef.current && zoom > 1) {
      event.preventDefault();
      const current = touchPoint(event.touches[0]);
      const previous = dragRef.current;
      dragRef.current = current;
      setPan((value) => clampPdfPan({ x: value.x + current.x - previous.x, y: value.y + current.y - previous.y }));
    }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    pinchRef.current = null;
    if (event.touches.length === 1 && zoom > 1) {
      dragRef.current = touchPoint(event.touches[0]);
      swipeStartRef.current = null;
      return;
    }
    dragRef.current = null;
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (layoutMode !== 'single' || !start || event.changedTouches.length === 0) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    event.preventDefault();
    changePage(dx < 0 ? 1 : -1);
  }

  const singlePageStyle = {
    '--viewer-pan-x': `${pan.x}px`,
    '--viewer-pan-y': `${pan.y}px`,
  } as CSSProperties;

  function handleStageScroll() {
    if (layoutMode !== 'scroll') return;
    const stage = stageRef.current;
    if (!stage) return;
    const pages = Array.from(stage.querySelectorAll<HTMLElement>('[data-pdf-page]'));
    if (pages.length === 0) return;
    const stageTop = stage.getBoundingClientRect().top;
    let nearestPage = pageNumber;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const page of pages) {
      const pageTop = page.getBoundingClientRect().top;
      const distance = Math.abs(pageTop - stageTop - 12);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = Number(page.dataset.pdfPage ?? nearestPage);
      }
    }
    if (nearestPage !== pageNumber) setPageNumber(nearestPage);
  }

  return (
    <section className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="segmented-control compact pdf-mode-control" aria-label="PDF layout">
          <button
            type="button"
            className={layoutMode === 'single' ? 'selected' : ''}
            onClick={() => setLayoutMode('single')}
          >
            Single
          </button>
          <button
            type="button"
            className={layoutMode === 'scroll' ? 'selected' : ''}
            onClick={() => setLayoutMode('scroll')}
          >
            Scroll
          </button>
        </div>
        <span>{pageCount > 0 ? `${pageNumber} / ${pageCount}` : file.name}</span>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {busy ? (
        <div className="loading-block compact-loading">
          <Spinner size={18} />
          <span>Rendering page...</span>
        </div>
      ) : null}
      <div
        ref={stageRef}
        className={`viewer-stage pdf-stage pdf-stage-${layoutMode}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onScroll={handleStageScroll}
      >
        {document && stageWidth > 0 && layoutMode === 'single' ? (
          <div
            key={pageNumber}
            className={`pdf-single-page ${pageDirection === 1 ? 'from-right' : pageDirection === -1 ? 'from-left' : ''}`}
            style={singlePageStyle}
            onAnimationEnd={() => setPageDirection(0)}
          >
            <PdfPageCanvas
              document={document}
              pageNumber={pageNumber}
              stageWidth={stageWidth}
              zoom={scale}
              eager
              onError={setError}
            />
          </div>
        ) : null}
        {document && stageWidth > 0 && layoutMode === 'scroll' ? (
          <div className="pdf-scroll-stack">
            {pages.map((page) => (
              <PdfPageCanvas
                key={page}
                document={document}
                pageNumber={page}
                stageWidth={stageWidth}
                zoom={scale}
                eager={page <= 2}
                onError={setError}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PdfPageCanvas({
  document,
  pageNumber,
  stageWidth,
  zoom,
  eager,
  onError,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  stageWidth: number;
  zoom: number;
  eager: boolean;
  onError: (message: string | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [visible, setVisible] = useState(eager);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    if (eager) {
      setVisible(true);
      return;
    }
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '700px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    let cancelled = false;
    setRendering(true);
    onError(null);
    renderTaskRef.current?.cancel();
    document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const naturalViewport = page.getViewport({ scale: 1 });
        const horizontalPadding = 28;
        const fitWidth = Math.max(1, stageWidth - horizontalPadding);
        const fitScale = fitWidth / naturalViewport.width;
        const displayScale = clamp(fitScale * zoom, 0.1, 6);
        const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
        const renderViewport = page.getViewport({ scale: displayScale * pixelRatio });
        const cssViewport = page.getViewport({ scale: displayScale });
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Could not create the PDF canvas context.');
        canvas.width = Math.max(1, Math.ceil(renderViewport.width));
        canvas.height = Math.max(1, Math.ceil(renderViewport.height));
        canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
        canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
        const task = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        renderTaskRef.current = task;
        return task.promise;
      })
      .catch((reason: unknown) => {
        if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
          onError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [document, onError, pageNumber, stageWidth, visible, zoom]);

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-wrap"
      data-pdf-page={pageNumber}
      aria-label={`PDF page ${pageNumber}`}
    >
      {rendering ? (
        <div className="pdf-page-loading">
          <Spinner size={16} />
        </div>
      ) : null}
      <canvas ref={canvasRef} />
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setSize([node.clientWidth, node.clientHeight]);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
