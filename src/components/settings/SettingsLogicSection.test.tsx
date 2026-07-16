import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SettingsLogicSection from './SettingsLogicSection';

describe('SettingsLogicSection', () => {
  it('selects IEC/DIN notation and renders a matching preview', () => {
    const setSchematicSymbolSet = vi.fn();
    const { container } = render(
      <SettingsLogicSection
        schematicSymbolSet="ansi"
        setSchematicSymbolSet={setSchematicSymbolSet}
      />,
    );

    expect(screen.getByText('ANSI / IEEE')).toBeTruthy();
    expect(container.innerHTML).toContain('L26 20');
    fireEvent.click(screen.getByRole('button', { name: 'IEC / DIN' }));
    expect(setSchematicSymbolSet).toHaveBeenCalledWith('iec');
  });
});
