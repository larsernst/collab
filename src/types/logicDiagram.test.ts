import { describe, expect, it } from 'vitest';

import {
  createEmptyLogicDiagram,
  normalizeLogicDiagramDocument,
  parseLogicDiagramDocument,
} from './logicDiagram';

describe('logic diagram document helpers', () => {
  it('creates an empty v1 logic diagram document', () => {
    expect(createEmptyLogicDiagram('Adder')).toEqual({
      schemaVersion: 1,
      kind: 'logic-diagram',
      title: 'Adder',
      nodes: [],
      wires: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
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
      schemaVersion: 1,
      kind: 'logic-diagram',
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
