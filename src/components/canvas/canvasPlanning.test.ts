import { describe, expect, it, vi } from 'vitest';

import { buildPlanningPreset, getPlanningNodeDefaults } from './canvasPlanning';

describe('canvasPlanning', () => {
  it('returns sensible defaults for a swimlane node', () => {
    expect(getPlanningNodeDefaults('swimlane')).toEqual(
      expect.objectContaining({
        title: 'Swimlane',
        orientation: 'horizontal',
        width: 520,
        height: 260,
      }),
    );
  });

  it('builds an orthogonal decision-tree preset', () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-1111-1111-111111111111')
      .mockReturnValueOnce('22222222-2222-2222-2222-222222222222')
      .mockReturnValueOnce('33333333-3333-3333-3333-333333333333')
      .mockReturnValueOnce('44444444-4444-4444-4444-444444444444')
      .mockReturnValueOnce('55555555-5555-5555-5555-555555555555');

    const preset = buildPlanningPreset('decision_tree', { x: 100, y: 200 });

    expect(preset.nodes).toHaveLength(3);
    expect(preset.edges).toEqual([
      expect.objectContaining({
        source: '11111111-1111-1111-1111-111111111111',
        target: '22222222-2222-2222-2222-222222222222',
        routingStyle: 'orthogonal',
        label: 'Yes',
      }),
      expect.objectContaining({
        source: '11111111-1111-1111-1111-111111111111',
        target: '33333333-3333-3333-3333-333333333333',
        routingStyle: 'orthogonal',
        label: 'No',
      }),
    ]);
  });
});
