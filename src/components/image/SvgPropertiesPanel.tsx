import { ArrowDown, ArrowUp, Trash2, X } from 'lucide-react';
import type { SvgNode } from '../../types/svg';
import { setNodeFontSize, setNodeStyle, setNodeText } from '../../lib/svgDocument';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface Props {
  node: SvgNode;
  onChange: (updater: (node: SvgNode) => SvgNode) => void;
  onReorder: (direction: 'forward' | 'backward') => void;
  onDelete: () => void;
  onClose: () => void;
}

const NORMALIZE_COLOR = (value: string | null, fallback: string) => {
  if (!value || value === 'none') return fallback;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function SvgPropertiesPanel({ node, onChange, onReorder, onDelete, onClose }: Props) {
  const supportsFill = node.type !== 'line';
  const fillOn = node.style.fill != null && node.style.fill !== 'none';
  const strokeOn = node.style.stroke != null && node.style.stroke !== 'none';

  return (
    <div className="absolute right-4 top-4 z-30 w-[min(260px,calc(100%-2rem))] rounded-xl border border-border/60 bg-popover/95 p-3 shadow-2xl shadow-black/25 backdrop-blur-sm-webkit app-panel-enter">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium capitalize">{node.type}</div>
        <Button size="icon" variant="ghost" className="size-7" onClick={onClose} title="Deselect">
          <X size={14} />
        </Button>
      </div>

      <div className="flex flex-col gap-2.5">
        {supportsFill && (
          <Row label="Fill">
            <input
              type="checkbox"
              checked={fillOn}
              onChange={(e) =>
                onChange((n) => setNodeStyle(n, { fill: e.target.checked ? NORMALIZE_COLOR(n.style.fill, '#38bdf8') : 'none' }))
              }
              title="Toggle fill"
            />
            <input
              type="color"
              value={NORMALIZE_COLOR(node.style.fill, '#38bdf8')}
              disabled={!fillOn}
              onChange={(e) => onChange((n) => setNodeStyle(n, { fill: e.target.value }))}
              className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent disabled:opacity-40"
            />
          </Row>
        )}

        <Row label="Stroke">
          <input
            type="checkbox"
            checked={strokeOn}
            onChange={(e) =>
              onChange((n) =>
                setNodeStyle(n, {
                  stroke: e.target.checked ? NORMALIZE_COLOR(n.style.stroke, '#0f172a') : 'none',
                  strokeWidth: e.target.checked && n.style.strokeWidth == null ? 2 : n.style.strokeWidth,
                }),
              )
            }
            title="Toggle stroke"
          />
          <input
            type="color"
            value={NORMALIZE_COLOR(node.style.stroke, '#0f172a')}
            disabled={!strokeOn}
            onChange={(e) => onChange((n) => setNodeStyle(n, { stroke: e.target.value }))}
            className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent disabled:opacity-40"
          />
        </Row>

        {strokeOn && (
          <Row label="Stroke width">
            <Input
              type="number"
              min={0}
              step={0.5}
              value={node.style.strokeWidth ?? 1}
              onChange={(e) => onChange((n) => setNodeStyle(n, { strokeWidth: Math.max(0, Number.parseFloat(e.target.value) || 0) }))}
              className="h-7 w-20 text-xs"
            />
          </Row>
        )}

        <Row label="Opacity">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={node.style.opacity ?? 1}
            onChange={(e) => onChange((n) => setNodeStyle(n, { opacity: Number.parseFloat(e.target.value) }))}
            className="w-28 accent-primary"
          />
        </Row>

        {node.type === 'text' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Text</span>
              <textarea
                value={node.text ?? ''}
                onChange={(e) => onChange((n) => setNodeText(n, e.target.value))}
                className="min-h-16 w-full rounded-lg border border-input bg-background/55 px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                placeholder="Text"
              />
            </div>
            <Row label="Font size">
              <Input
                type="number"
                min={1}
                value={node.fontSize ?? 16}
                onChange={(e) => onChange((n) => setNodeFontSize(n, Number.parseFloat(e.target.value) || 1))}
                className="h-7 w-20 text-xs"
              />
            </Row>
          </>
        )}

        <div className="mt-1 flex items-center gap-1.5 border-t border-border/40 pt-2.5">
          <Button size="icon" variant="ghost" className={cn('size-8')} title="Bring forward" onClick={() => onReorder('forward')}>
            <ArrowUp size={14} />
          </Button>
          <Button size="icon" variant="ghost" className="size-8" title="Send backward" onClick={() => onReorder('backward')}>
            <ArrowDown size={14} />
          </Button>
          <div className="flex-1" />
          <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" title="Delete element" onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
