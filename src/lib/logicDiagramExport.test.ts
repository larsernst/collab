import { describe, expect, it } from 'vitest';

import {
  buildLogicDiagramSvg,
  buildLogicDiagramSvgDataUrl,
  extractLogicDiagramExportSource,
} from './logicDiagramExport';
import type { LogicDiagramDocument } from '../types/logicDiagram';

const diagram: LogicDiagramDocument = {
  schemaVersion: 1,
  kind: 'logic-diagram',
  diagramMode: 'logic',
  title: 'Half adder',
  nodes: [
    { id: 'a', kind: 'input', position: { x: 0, y: 0 }, value: true },
    { id: 'xor', kind: 'xor', position: { x: 180, y: 0 } },
  ],
  wires: [{ id: 'w1', source: 'a', target: 'xor' }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe('logicDiagramExport', () => {
  it('builds an SVG with source metadata and visible logic elements', () => {
    const svg = buildLogicDiagramSvg(diagram, 'Diagrams/half-adder.logic');

    expect(svg).toContain('<svg');
    expect(svg).toContain('collab-logic-diagram-export');
    expect(svg).toContain('Diagrams/half-adder.logic');
    expect(svg).toContain('XOR');
    expect(svg).toContain('<path');
    expect(svg).toContain('stroke="#2563eb"');
  });

  it('exports static schematic symbols without logic signal arrows', () => {
    const schematic: LogicDiagramDocument = {
      ...diagram,
      diagramMode: 'schematic',
      nodes: [
        { id: 'source', kind: 'voltage-source', position: { x: 0, y: 0 } },
        { id: 'r1', kind: 'resistor', label: 'R1 1k', position: { x: 180, y: 0 } },
      ],
      wires: [{ id: 'wire', source: 'source', target: 'r1', sourceHandle: 'positive', targetHandle: 'terminal-a' }],
    };

    const svg = buildLogicDiagramSvg(schematic, 'Diagrams/amplifier.logic');
    expect(svg).toContain('R1 1k');
    expect(svg).toContain('M0 32H20L26 20');
    expect(svg).not.toContain('marker-end="url(#logic-arrow)"');
  });

  it('extracts source metadata from exported SVG data URLs', () => {
    const dataUrl = buildLogicDiagramSvgDataUrl(diagram, 'Diagrams/half-adder.logic');

    expect(extractLogicDiagramExportSource(dataUrl)).toBe('Diagrams/half-adder.logic');
    expect(extractLogicDiagramExportSource('data:image/png;base64,abc')).toBeNull();
  });
});
