import { describe, expect, it } from 'vitest';

import {
  createEmptyLogicDiagram,
  normalizeLogicDiagramDocument,
  parseLogicDiagramDocument,
} from './logicDiagram';

describe('logic diagram document helpers', () => {
  it('creates an empty v5 logic diagram document', () => {
    expect(createEmptyLogicDiagram('Adder')).toEqual({
      schemaVersion: 5,
      kind: 'logic-diagram',
      diagramMode: 'logic',
      title: 'Adder',
      nodes: [],
      wires: [],
      components: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });

  it('normalizes clock timing and clamps unsafe values', () => {
    const document = normalizeLogicDiagramDocument({
      kind: 'logic-diagram',
      nodes: [{
        id: 'clock',
        kind: 'clock',
        position: { x: 1, y: 2 },
        clock: { periodMs: 20, dutyCycle: 2, phaseMs: -10 },
      }],
      wires: [],
    });

    expect(document.nodes[0].clock).toEqual({ periodMs: 100, dutyCycle: 0.95, phaseMs: 0 });
  });

  it('normalizes unknown input into a safe diagram shape', () => {
    const normalized = normalizeLogicDiagramDocument({
      schemaVersion: 99,
      kind: 'legacy',
      nodes: [
        { id: 'a', kind: 'input', position: { x: 10, y: 20 }, value: true },
        { id: 'cluster', kind: 'group', position: { x: 0, y: 0 }, width: 240, height: 160 },
        { id: 'inside', kind: 'and', position: { x: 48, y: 48 }, parentId: 'cluster' },
        { id: 'bad', kind: 'timer', position: { x: 0, y: 0 } },
      ],
      wires: [
        { id: 'w1', source: 'a', target: 'out', label: 'sum' },
        { id: 'bad-wire', source: 'a' },
      ],
      viewport: { x: 5, y: Number.NaN, zoom: 1.25 },
    });

    expect(normalized).toMatchObject({
      schemaVersion: 5,
      kind: 'logic-diagram',
      diagramMode: 'logic',
      components: [],
      nodes: [
        { id: 'a', kind: 'input', position: { x: 10, y: 20 }, value: true },
        { id: 'cluster', kind: 'group', position: { x: 0, y: 0 }, width: 240, height: 160 },
        { id: 'inside', kind: 'and', position: { x: 48, y: 48 }, parentId: 'cluster' },
      ],
      wires: [
        { id: 'w1', source: 'a', target: 'out', label: 'sum' },
      ],
      viewport: { x: 5, y: 0, zoom: 1.25 },
    });
  });

  it('preserves schematic mode and infers it for early electronic documents', () => {
    expect(normalizeLogicDiagramDocument({
      kind: 'logic-diagram',
      diagramMode: 'schematic',
      nodes: [{ id: 'r1', kind: 'resistor', position: { x: 0, y: 0 } }],
      wires: [],
    })).toMatchObject({ diagramMode: 'schematic', nodes: [{ kind: 'resistor' }] });

    expect(normalizeLogicDiagramDocument({
      kind: 'logic-diagram',
      nodes: [{ id: 'c1', kind: 'capacitor', position: { x: 0, y: 0 } }],
      wires: [],
    }).diagramMode).toBe('schematic');
  });

  it('normalizes persisted schematic rotation and defaults older symbols to zero', () => {
    expect(normalizeLogicDiagramDocument({
      kind: 'logic-diagram',
      diagramMode: 'schematic',
      nodes: [
        { id: 'r1', kind: 'resistor', position: { x: 0, y: 0 }, rotation: 90 },
        { id: 'c1', kind: 'capacitor', position: { x: 0, y: 0 }, rotation: 45 },
      ],
      wires: [],
    }).nodes).toMatchObject([
      { id: 'r1', rotation: 90 },
      { id: 'c1', rotation: 0 },
    ]);
  });

  it('parses valid .logic JSON and rejects unsupported shapes', () => {
    expect(parseLogicDiagramDocument('{"kind":"logic-diagram","nodes":[],"wires":[]}')).toMatchObject({
      kind: 'logic-diagram',
      nodes: [],
      wires: [],
    });

    expect(() => parseLogicDiagramDocument('{')).toThrow(/valid JSON/);
    expect(() => parseLogicDiagramDocument('[]')).toThrow(/JSON object/);
    expect(() => parseLogicDiagramDocument('{"kind":"canvas","nodes":[],"wires":[]}')).toThrow(/logic-diagram/);
    expect(() => parseLogicDiagramDocument('{"kind":"logic-diagram","nodes":[]}')).toThrow(/nodes and wires/);
  });
});
