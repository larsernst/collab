export const LOGIC_DIAGRAM_EXTENSION = 'logic';
export const LOGIC_DIAGRAM_SCHEMA_VERSION = 1;

export type LogicGateKind =
  | 'input'
  | 'output'
  | 'group'
  | 'and'
  | 'or'
  | 'not'
  | 'xor'
  | 'nand'
  | 'nor'
  | 'xnor';

export interface LogicDiagramNode {
  id: string;
  kind: LogicGateKind;
  position: { x: number; y: number };
  label?: string;
  value?: boolean;
  parentId?: string;
  width?: number;
  height?: number;
}

export interface LogicDiagramWire {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface LogicDiagramDocument {
  schemaVersion: typeof LOGIC_DIAGRAM_SCHEMA_VERSION;
  kind: 'logic-diagram';
  title?: string;
  nodes: LogicDiagramNode[];
  wires: LogicDiagramWire[];
  viewport: { x: number; y: number; zoom: number };
}

const LOGIC_GATE_KINDS = new Set<LogicGateKind>([
  'input',
  'output',
  'group',
  'and',
  'or',
  'not',
  'xor',
  'nand',
  'nor',
  'xnor',
]);

export function createEmptyLogicDiagram(title?: string): LogicDiagramDocument {
  return {
    schemaVersion: LOGIC_DIAGRAM_SCHEMA_VERSION,
    kind: 'logic-diagram',
    title,
    nodes: [],
    wires: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeNode(value: unknown): LogicDiagramNode | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !LOGIC_GATE_KINDS.has(record.kind as LogicGateKind)) {
    return null;
  }
  const position = asRecord(record.position);
  return {
    id: record.id,
    kind: record.kind as LogicGateKind,
    position: {
      x: finiteNumber(position?.x, 0),
      y: finiteNumber(position?.y, 0),
    },
    label: optionalString(record.label),
    value: typeof record.value === 'boolean' ? record.value : undefined,
    parentId: optionalString(record.parentId),
    width: typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : undefined,
    height: typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : undefined,
  };
}

function normalizeWire(value: unknown): LogicDiagramWire | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || typeof record.source !== 'string' || typeof record.target !== 'string') {
    return null;
  }
  return {
    id: record.id,
    source: record.source,
    target: record.target,
    sourceHandle: optionalString(record.sourceHandle),
    targetHandle: optionalString(record.targetHandle),
    label: optionalString(record.label),
  };
}

export function normalizeLogicDiagramDocument(input: unknown): LogicDiagramDocument {
  const record = asRecord(input);
  if (!record) return createEmptyLogicDiagram();

  const viewport = asRecord(record.viewport);
  return {
    schemaVersion: LOGIC_DIAGRAM_SCHEMA_VERSION,
    kind: 'logic-diagram',
    title: optionalString(record.title),
    nodes: Array.isArray(record.nodes)
      ? record.nodes.map(normalizeNode).filter((node): node is LogicDiagramNode => Boolean(node))
      : [],
    wires: Array.isArray(record.wires)
      ? record.wires.map(normalizeWire).filter((wire): wire is LogicDiagramWire => Boolean(wire))
      : [],
    viewport: {
      x: finiteNumber(viewport?.x, 0),
      y: finiteNumber(viewport?.y, 0),
      zoom: finiteNumber(viewport?.zoom, 1),
    },
  };
}

export function parseLogicDiagramDocument(text: string): LogicDiagramDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The .logic file does not contain valid JSON.');
  }
  const record = asRecord(parsed);
  if (!record) throw new Error('The .logic file must contain a JSON object.');
  if (record.kind !== 'logic-diagram') {
    throw new Error('The .logic file must be a logic-diagram document.');
  }
  if (!Array.isArray(record.nodes) || !Array.isArray(record.wires)) {
    throw new Error('The .logic file must contain nodes and wires arrays.');
  }
  return normalizeLogicDiagramDocument(record);
}
