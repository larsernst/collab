import { ArrowLeft, FileWarning, ImageIcon, Minus, Plus, RotateCcw } from 'lucide-react';
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
  | { status: 'ready'; dataUrl: string; source: 'network' | 'cache' }
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selected) return;
      setLoadState({ status: 'loading' });
      setZoom(1);
      try {
        const result = await readMobileAssetDataUrl({
          serverUrl: selected.serverUrl,
          vaultId: selected.vault.id,
          file,
          connected,
        });
        if (!cancelled) setLoadState({ status: 'ready', ...result });
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
  }, [connected, file, selected]);

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
      ) : image ? (
        <ImageMobileViewer
          dataUrl={loadState.dataUrl}
          name={file.name}
          zoom={zoom}
          setZoom={setZoom}
          resetToken={resetToken}
          onWheel={handleWheel}
        />
      ) : pdf ? (
        <PdfMobileViewer file={file} dataUrl={loadState.dataUrl} zoom={zoom} setZoom={setZoom} />
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
