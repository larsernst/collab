import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MathPlotModal } from './MathPlotModal';
import type { MathPlot2DSpec } from './mathPlotSpec';

const spec: MathPlot2DSpec = {
  kind: '2d',
  expression: '\\sin(x)',
  x: { min: -10, max: 10 },
  samples: 200,
};

describe('MathPlotModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the plot and editable controls for a 2D spec', () => {
    render(<MathPlotModal spec={spec} onOpenChange={() => {}} />);

    expect(screen.getByText('2D plot')).toBeTruthy();
    // Expression field is prefilled from the spec.
    expect((screen.getByDisplayValue('\\sin(x)') as HTMLInputElement).value).toBe('\\sin(x)');
    // x-range inputs.
    expect(screen.getByLabelText('x range minimum')).toBeTruthy();
    expect(screen.getByLabelText('x range maximum')).toBeTruthy();
    // Sample rate label reflects the current samples.
    expect(screen.getByText('Sample rate — 200')).toBeTruthy();
  });

  it('shows manual vertical-limit inputs only when the toggle is enabled', () => {
    render(<MathPlotModal spec={spec} onOpenChange={() => {}} />);

    expect(screen.queryByLabelText('y-axis range minimum')).toBeNull();

    fireEvent.click(screen.getByLabelText('Manual y-axis limits'));

    expect(screen.getByLabelText('y-axis range minimum')).toBeTruthy();
    expect(screen.getByLabelText('y-axis range maximum')).toBeTruthy();
  });

  it('surfaces a validation message when a range is inverted', () => {
    render(<MathPlotModal spec={spec} onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText('x range minimum'), { target: { value: '20' } });

    expect(screen.getByText(/minimum must be less than its maximum/i)).toBeTruthy();
  });
});
