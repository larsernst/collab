import { describe, expect, it } from 'vitest';

import { getSchematicSymbol, SCHEMATIC_SYMBOL_CHOICES, schematicSymbolMarkup } from './schematicSymbols';

describe('schematic symbols', () => {
  it('provides the Phase 5 static component library', () => {
    expect(SCHEMATIC_SYMBOL_CHOICES.map((symbol) => symbol.kind)).toEqual([
      'resistor', 'capacitor', 'inductor', 'diode', 'led', 'transistor', 'switch', 'ground', 'voltage-source',
    ]);
  });

  it('defines connectable terminals and SVG geometry', () => {
    expect(getSchematicSymbol('transistor')).toMatchObject({
      inputHandles: ['base'],
      outputHandles: ['collector', 'emitter'],
    });
    expect(getSchematicSymbol('ground')).toMatchObject({ inputHandles: ['terminal'], outputHandles: [] });
    expect(schematicSymbolMarkup('resistor', '#fff')).toContain('stroke="#fff"');
  });
});
