import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';

import { fromFlowEdge, getAnchoredEdgeGeometry, getCanvasEdgeData, toFlowEdge } from './CanvasEdgeTypes';

describe('CanvasEdgeTypes', () => {
  it('fills edge defaults for a new connection', () => {
    expect(getCanvasEdgeData()).toEqual({
      label: '',
      lineStyle: 'solid',
      routingStyle: 'curved',
      animated: false,
      animationReverse: false,
      markerStart: false,
      markerEnd: false,
    });
  });

  it('round-trips persisted edge data through flow edges', () => {
    const flowEdge = toFlowEdge({
      id: 'edge-1',
      source: 'node-a',
      target: 'node-b',
      sourceHandle: 'top-in',
      targetHandle: 'bottom-out',
      label: 'depends on',
      lineStyle: 'dashed',
      routingStyle: 'orthogonal',
      animated: true,
      animationReverse: true,
      markerStart: true,
      markerEnd: false,
    });

    expect(fromFlowEdge(flowEdge)).toEqual({
      id: 'edge-1',
      source: 'node-a',
      target: 'node-b',
      sourceHandle: 'top-in',
      targetHandle: 'bottom-out',
      label: 'depends on',
      lineStyle: 'dashed',
      routingStyle: 'orthogonal',
      animated: true,
      animationReverse: true,
      markerStart: true,
      markerEnd: false,
    });
  });

  it('clamps orthogonal lead-out lanes before close facing handles can cross', () => {
    const geometry = getAnchoredEdgeGeometry({
      edge: {
        id: 'edge-close',
        source: 'node-a',
        target: 'node-b',
      },
      edges: [],
      nodeGeometry: new Map(),
      sourceX: 100,
      sourceY: 120,
      targetX: 140,
      targetY: 120,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    expect(geometry.controlSourceX).toBeLessThanOrEqual(geometry.controlTargetX);
    expect(geometry.controlSourceX).toBe(120);
    expect(geometry.controlTargetX).toBe(120);
  });

  it('stacks only against siblings on the same handle', () => {
    const edges = [
      toFlowEdge({
        id: 'edge-top',
        source: 'node-a',
        sourceHandle: 'bottom-out',
        target: 'node-target',
        targetHandle: 'top-in',
      }),
      toFlowEdge({
        id: 'edge-left',
        source: 'node-b',
        sourceHandle: 'right-out',
        target: 'node-target',
        targetHandle: 'left-in',
      }),
    ];

    const nodeGeometry = new Map([
      ['node-a', { centerX: 120, centerY: 60, width: 240, height: 120 }],
      ['node-b', { centerX: 20, centerY: 150, width: 240, height: 120 }],
      ['node-target', { centerX: 200, centerY: 150, width: 300, height: 180 }],
    ]);

    const topGeometry = getAnchoredEdgeGeometry({
      edge: edges[0],
      edges,
      nodeGeometry,
      sourceX: 120,
      sourceY: 120,
      targetX: 200,
      targetY: 60,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });

    const leftGeometry = getAnchoredEdgeGeometry({
      edge: edges[1],
      edges,
      nodeGeometry,
      sourceX: 80,
      sourceY: 150,
      targetX: 50,
      targetY: 150,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    expect(topGeometry.targetX).toBe(200);
    expect(leftGeometry.targetY).toBe(150);
  });
});
