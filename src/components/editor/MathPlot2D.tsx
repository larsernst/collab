import * as d3 from 'd3';

import type { MathPlot2DSpec } from './mathPlotSpec';
import { samplePlot2D } from './mathPlotSpec';

interface MathPlot2DProps {
  spec: MathPlot2DSpec;
}

export function MathPlot2D({ spec }: MathPlot2DProps) {
  const width = 560;
  const height = 260;
  const margin = { top: 16, right: 24, bottom: 34, left: 44 };
  let sampled;

  try {
    sampled = samplePlot2D(spec);
  } catch (err) {
    return (
      <div className="rounded-md border border-destructive/35 bg-destructive/8 px-3 py-2 text-xs text-destructive">
        Could not render 2D plot: {String(err instanceof Error ? err.message : err)}
      </div>
    );
  }

  const xScale = d3.scaleLinear()
    .domain([spec.x.min, spec.x.max])
    .range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear()
    .domain([sampled.yDomain.min, sampled.yDomain.max])
    .range([height - margin.bottom, margin.top]);
  const line = d3.line<{ x: number; y: number }>()
    .x((point) => xScale(point.x))
    .y((point) => yScale(point.y));
  const xTicks = xScale.ticks(7);
  const yTicks = yScale.ticks(5);
  const zeroX = spec.x.min <= 0 && spec.x.max >= 0 ? xScale(0) : null;
  const zeroY = sampled.yDomain.min <= 0 && sampled.yDomain.max >= 0 ? yScale(0) : null;

  return (
    <div className="rounded-lg border border-border/45 bg-background/45 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/85">2D plot</span>
        <span className="truncate font-mono">y = {spec.expression}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full overflow-visible">
        <rect x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} rx={6} className="fill-muted/15" />
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line x1={xScale(tick)} x2={xScale(tick)} y1={margin.top} y2={height - margin.bottom} className="stroke-border/40" />
            <text x={xScale(tick)} y={height - 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">{tick}</text>
          </g>
        ))}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={margin.left} x2={width - margin.right} y1={yScale(tick)} y2={yScale(tick)} className="stroke-border/40" />
            <text x={margin.left - 8} y={yScale(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{Number.parseFloat(tick.toPrecision(3))}</text>
          </g>
        ))}
        {zeroX !== null && <line x1={zeroX} x2={zeroX} y1={margin.top} y2={height - margin.bottom} className="stroke-foreground/35" />}
        {zeroY !== null && <line x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} className="stroke-foreground/35" />}
        {sampled.segments.map((segment, index) => (
          <path key={index} d={line(segment) ?? undefined} className="fill-none stroke-primary" strokeWidth={2.4} strokeLinecap="round" />
        ))}
      </svg>
    </div>
  );
}
