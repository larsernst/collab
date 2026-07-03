import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MathPlot2D } from './MathPlot2D';
import type { MathPlot2DSpec } from './mathPlotSpec';

const spec: MathPlot2DSpec = {
  kind: '2d',
  expression: '\\sin(x)',
  x: { min: -10, max: 10 },
  samples: 100,
};

describe('MathPlot2D', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps the inline plot in a vertically resizable container', () => {
    const { container } = render(<MathPlot2D spec={spec} />);
    expect(container.querySelector('.resize-y')).toBeTruthy();
    // The curve is clipped to the plot area so a tight manual range cannot spill.
    expect(container.querySelector('clipPath')).toBeTruthy();
  });

  it('does not add a resize handle in modal variant', () => {
    const { container } = render(<MathPlot2D spec={spec} variant="modal" />);
    expect(container.querySelector('.resize-y')).toBeNull();
  });
});
