export const LOGIC_DIAGRAM_EXTENSION = 'logic';
export const LOGIC_DIAGRAM_SCHEMA_VERSION = 5;

export type LogicDiagramMode = 'logic' | 'schematic';
export type SchematicRotation = 0 | 90 | 180 | 270;

export type LogicGateKind =
  | 'input'
  | 'clock'
  | 'output'
  | 'group'
  | 'and'
  | 'or'
  | 'not'
  | 'xor'
  | 'nand'
  | 'nor'
  | 'xnor';

export type ElectronicComponentKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'led'
  | 'transistor'
  | 'switch'
  | 'ground'
  | 'voltage-source';

export type LogicNodeKind = LogicGateKind | 'component' | ElectronicComponentKind;
export type LogicComponentInstanceMode = 'snapshot' | 'linked';
export type LogicComponentPortDirection = 'input' | 'output';

export interface LogicClockConfig {
  periodMs: number;
  dutyCycle: number;
  phaseMs: number;
}

export interface LogicComponentPort {
  id: string;
  label: string;
  direction: LogicComponentPortDirection;
  sourceNodeId: string;
}

export interface LogicComponentDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  ports: LogicComponentPort[];
  nodes: LogicDiagramNode[];
  wires: LogicDiagramWire[];
}

export interface LogicComponentInstance {
  mode: LogicComponentInstanceMode;
  componentId?: string;
  definition: LogicComponentDefinition;
}

export interface LogicDiagramNode {
  id: string;
  kind: LogicNodeKind;
  position: { x: number; y: number };
  label?: string;
  value?: boolean;
  clock?: LogicClockConfig;
  rotation?: SchematicRotation;
  parentId?: string;
  width?: number;
  height?: number;
  component?: LogicComponentInstance;
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
  schemaVersion: number;
  kind: 'logic-diagram';
  diagramMode: LogicDiagramMode;
  title?: string;
  nodes: LogicDiagramNode[];
  wires: LogicDiagramWire[];
  components?: LogicComponentDefinition[];
  viewport: { x: number; y: number; zoom: number };
}

const LOGIC_GATE_KINDS = new Set<LogicGateKind>([
  'input',
  'clock',
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

const ELECTRONIC_COMPONENT_KINDS = new Set<ElectronicComponentKind>([
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'led',
  'transistor',
  'switch',
  'ground',
  'voltage-source',
]);

export function isLogicGateKind(kind: unknown): kind is LogicGateKind {
  return LOGIC_GATE_KINDS.has(kind as LogicGateKind);
}

export function isElectronicComponentKind(kind: unknown): kind is ElectronicComponentKind {
  return ELECTRONIC_COMPONENT_KINDS.has(kind as ElectronicComponentKind);
}

export function createEmptyLogicDiagram(title?: string, diagramMode: LogicDiagramMode = 'logic'): LogicDiagramDocument {
  return {
    schemaVersion: LOGIC_DIAGRAM_SCHEMA_VERSION,
    kind: 'logic-diagram',
    diagramMode,
    title,
    nodes: [],
    wires: [],
    components: [],
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

function timestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizeComponentPort(value: unknown): LogicComponentPort | null {
  const record = asRecord(value);
  if (
    !record
    || typeof record.id !== 'string'
    || typeof record.label !== 'string'
    || typeof record.sourceNodeId !== 'string'
    || (record.direction !== 'input' && record.direction !== 'output')
  ) {
    return null;
  }
  const label = record.label.trim();
  if (!label) return null;
  return {
    id: record.id,
    label,
    direction: record.direction,
    sourceNodeId: record.sourceNodeId,
  };
}

function normalizeComponentDefinition(value: unknown): LogicComponentDefinition | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') return null;
  const name = record.name.trim();
  if (!name) return null;
  const nodes = Array.isArray(record.nodes)
    ? record.nodes.map(normalizeNode).filter((node): node is LogicDiagramNode => Boolean(node))
    : [];
  const wires = Array.isArray(record.wires)
    ? record.wires.map(normalizeWire).filter((wire): wire is LogicDiagramWire => Boolean(wire))
    : [];
  const ports = Array.isArray(record.ports)
    ? record.ports.map(normalizeComponentPort).filter((port): port is LogicComponentPort => Boolean(port))
    : [];
  return {
    id: record.id,
    name,
    description: optionalString(record.description),
    version: Math.max(1, Math.floor(finiteNumber(record.version, 1))),
    createdAt: timestamp(record.createdAt),
    updatedAt: timestamp(record.updatedAt),
    ports,
    nodes,
    wires,
  };
}

function normalizeComponentInstance(value: unknown): LogicComponentInstance | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const definition = normalizeComponentDefinition(record.definition);
  if (!definition) return undefined;
  return {
    mode: record.mode === 'linked' ? 'linked' : 'snapshot',
    componentId: optionalString(record.componentId) ?? definition.id,
    definition,
  };
}

function normalizeNode(value: unknown): LogicDiagramNode | null {
  const record = asRecord(value);
  if (
    !record
    || typeof record.id !== 'string'
    || !(isLogicGateKind(record.kind) || isElectronicComponentKind(record.kind) || record.kind === 'component')
  ) {
    return null;
  }
  const position = asRecord(record.position);
  const clock = asRecord(record.clock);
  const rotation = record.rotation === 90 || record.rotation === 180 || record.rotation === 270
    ? record.rotation
    : 0;
  return {
    id: record.id,
    kind: record.kind as LogicNodeKind,
    position: {
      x: finiteNumber(position?.x, 0),
      y: finiteNumber(position?.y, 0),
    },
    label: optionalString(record.label),
    value: typeof record.value === 'boolean' ? record.value : undefined,
    clock: record.kind === 'clock'
      ? {
          periodMs: Math.max(100, finiteNumber(clock?.periodMs, 1000)),
          dutyCycle: Math.min(0.95, Math.max(0.05, finiteNumber(clock?.dutyCycle, 0.5))),
          phaseMs: Math.max(0, finiteNumber(clock?.phaseMs, 0)),
        }
      : undefined,
    rotation: isElectronicComponentKind(record.kind) ? rotation : undefined,
    parentId: optionalString(record.parentId),
    width: typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : undefined,
    height: typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : undefined,
    component: record.kind === 'component' ? normalizeComponentInstance(record.component) : undefined,
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
  const nodes = Array.isArray(record.nodes)
    ? record.nodes.map(normalizeNode).filter((node): node is LogicDiagramNode => Boolean(node))
    : [];
  const inferredMode = nodes.some((node) => isElectronicComponentKind(node.kind)) ? 'schematic' : 'logic';
  return {
    schemaVersion: LOGIC_DIAGRAM_SCHEMA_VERSION,
    kind: 'logic-diagram',
    diagramMode: record.diagramMode === 'schematic' || record.diagramMode === 'logic'
      ? record.diagramMode
      : inferredMode,
    title: optionalString(record.title),
    nodes,
    wires: Array.isArray(record.wires)
      ? record.wires.map(normalizeWire).filter((wire): wire is LogicDiagramWire => Boolean(wire))
      : [],
    components: Array.isArray(record.components)
      ? record.components.map(normalizeComponentDefinition).filter((component): component is LogicComponentDefinition => Boolean(component))
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
