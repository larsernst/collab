import type { LogicDiagramNode, LogicDiagramWire, LogicGateKind } from '../../types/logicDiagram';

export type LogicSignal = boolean | undefined;

export interface LogicEvaluationWarning {
  code: 'missing-input' | 'cycle' | 'duplicate-input';
  nodeId: string;
  message: string;
}

export interface LogicEvaluationResult {
  nodeValues: Record<string, LogicSignal>;
  wireValues: Record<string, LogicSignal>;
  warnings: LogicEvaluationWarning[];
}

export function getLogicInputHandles(kind: LogicGateKind) {
  if (kind === 'input' || kind === 'group') return [];
  if (kind === 'not' || kind === 'output') return ['in'];
  return ['in-a', 'in-b'];
}

export function getLogicOutputHandles(kind: LogicGateKind) {
  if (kind === 'output' || kind === 'group') return [];
  return ['out'];
}

function fallbackInputHandle(kind: LogicGateKind) {
  return getLogicInputHandles(kind)[0];
}

function normalizeTargetHandle(wire: LogicDiagramWire, targetKind: LogicGateKind) {
  const handles = getLogicInputHandles(targetKind);
  return wire.targetHandle && handles.includes(wire.targetHandle)
    ? wire.targetHandle
    : fallbackInputHandle(targetKind);
}

function evaluateGate(kind: LogicGateKind, inputs: LogicSignal[]) {
  if (inputs.some((input) => typeof input !== 'boolean')) return undefined;
  switch (kind) {
    case 'output':
      return inputs[0];
    case 'not':
      return !inputs[0];
    case 'and':
      return inputs[0] && inputs[1];
    case 'or':
      return inputs[0] || inputs[1];
    case 'xor':
      return inputs[0] !== inputs[1];
    case 'nand':
      return !(inputs[0] && inputs[1]);
    case 'nor':
      return !(inputs[0] || inputs[1]);
    case 'xnor':
      return inputs[0] === inputs[1];
    case 'input':
    case 'group':
      return undefined;
  }
}

export function evaluateLogicDiagram(
  nodes: LogicDiagramNode[],
  wires: LogicDiagramWire[],
): LogicEvaluationResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByNode = new Map<string, LogicDiagramWire[]>();
  for (const wire of wires) {
    const incoming = incomingByNode.get(wire.target) ?? [];
    incoming.push(wire);
    incomingByNode.set(wire.target, incoming);
  }

  const nodeValues: Record<string, LogicSignal> = {};
  const wireValues: Record<string, LogicSignal> = {};
  const warnings: LogicEvaluationWarning[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleNodes = new Set<string>();
  const warned = new Set<string>();

  const warnOnce = (warning: LogicEvaluationWarning) => {
    const key = `${warning.code}:${warning.nodeId}:${warning.message}`;
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(warning);
  };

  const evaluateNode = (nodeId: string): LogicSignal => {
    if (visited.has(nodeId)) return nodeValues[nodeId];
    const node = nodeById.get(nodeId);
    if (!node || node.kind === 'group') return undefined;

    if (visiting.has(nodeId)) {
      cycleNodes.add(nodeId);
      warnOnce({
        code: 'cycle',
        nodeId,
        message: `Cycle detected at ${node.label ?? node.id}.`,
      });
      nodeValues[nodeId] = undefined;
      return undefined;
    }

    visiting.add(nodeId);

    if (node.kind === 'input') {
      nodeValues[node.id] = typeof node.value === 'boolean' ? node.value : undefined;
    } else {
      const handles = getLogicInputHandles(node.kind);
      const incoming = incomingByNode.get(node.id) ?? [];
      const inputValues = handles.map((handleId) => {
        const matching = incoming.filter((wire) => normalizeTargetHandle(wire, node.kind) === handleId);
        if (matching.length === 0) {
          warnOnce({
            code: 'missing-input',
            nodeId: node.id,
            message: `${node.label ?? node.id} is missing ${handleId}.`,
          });
          return undefined;
        }
        if (matching.length > 1) {
          warnOnce({
            code: 'duplicate-input',
            nodeId: node.id,
            message: `${node.label ?? node.id} has multiple wires on ${handleId}.`,
          });
        }

        const wire = matching[0];
        const value = evaluateNode(wire.source);
        wireValues[wire.id] = value;
        return value;
      });
      nodeValues[node.id] = evaluateGate(node.kind, inputValues);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    return nodeValues[nodeId];
  };

  for (const node of nodes) evaluateNode(node.id);

  for (const wire of wires) {
    if (!(wire.id in wireValues)) {
      wireValues[wire.id] = cycleNodes.has(wire.source) ? undefined : evaluateNode(wire.source);
    }
  }

  return { nodeValues, wireValues, warnings };
}
