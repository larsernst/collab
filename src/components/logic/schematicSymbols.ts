import type { ElectronicComponentKind } from '../../types/logicDiagram';

export interface SchematicSymbolDefinition {
  kind: ElectronicComponentKind;
  label: string;
  inputHandles: string[];
  outputHandles: string[];
  width: number;
  height: number;
}

const SYMBOLS: Record<ElectronicComponentKind, SchematicSymbolDefinition> = {
  resistor: { kind: 'resistor', label: 'Resistor', inputHandles: ['terminal-a'], outputHandles: ['terminal-b'], width: 120, height: 72 },
  capacitor: { kind: 'capacitor', label: 'Capacitor', inputHandles: ['terminal-a'], outputHandles: ['terminal-b'], width: 120, height: 72 },
  inductor: { kind: 'inductor', label: 'Inductor', inputHandles: ['terminal-a'], outputHandles: ['terminal-b'], width: 120, height: 72 },
  diode: { kind: 'diode', label: 'Diode', inputHandles: ['anode'], outputHandles: ['cathode'], width: 120, height: 72 },
  led: { kind: 'led', label: 'LED', inputHandles: ['anode'], outputHandles: ['cathode'], width: 120, height: 72 },
  transistor: { kind: 'transistor', label: 'NPN transistor', inputHandles: ['base'], outputHandles: ['collector', 'emitter'], width: 120, height: 88 },
  switch: { kind: 'switch', label: 'Switch', inputHandles: ['terminal-a'], outputHandles: ['terminal-b'], width: 120, height: 72 },
  ground: { kind: 'ground', label: 'Ground', inputHandles: ['terminal'], outputHandles: [], width: 96, height: 72 },
  'voltage-source': { kind: 'voltage-source', label: 'Voltage source', inputHandles: ['negative'], outputHandles: ['positive'], width: 120, height: 80 },
};

export const SCHEMATIC_SYMBOL_CHOICES = Object.values(SYMBOLS);

export function getSchematicSymbol(kind: ElectronicComponentKind) {
  return SYMBOLS[kind];
}

export function schematicSymbolMarkup(kind: ElectronicComponentKind, stroke = 'currentColor') {
  const common = `fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'resistor':
      return `<path d="M0 32H20L26 20L38 44L50 20L62 44L74 20L80 32H100" ${common}/>`;
    case 'capacitor':
      return `<path d="M0 32H42M42 16V48M58 16V48M58 32H100" ${common}/>`;
    case 'inductor':
      return `<path d="M0 32H18C18 18 34 18 34 32C34 18 50 18 50 32C50 18 66 18 66 32C66 18 82 18 82 32H100" ${common}/>`;
    case 'diode':
      return `<path d="M0 32H32M68 32H100M32 14L68 32L32 50Z M68 14V50" ${common}/>`;
    case 'led':
      return `<path d="M0 32H32M68 32H100M32 14L68 32L32 50Z M68 14V50M70 14L82 2M78 20L90 8" ${common}/><path d="M79 2L82 2L82 5M87 8L90 8L90 11" ${common}/>`;
    case 'transistor':
      return `<path d="M0 36H38M38 14V58M38 24L78 24H100M38 48L78 48H100M72 40L78 48L68 50" ${common}/>`;
    case 'switch':
      return `<path d="M0 32H30M70 32H100M30 32L68 12" ${common}/><circle cx="30" cy="32" r="3" fill="${stroke}"/><circle cx="70" cy="32" r="3" fill="${stroke}"/>`;
    case 'ground':
      return `<path d="M0 32H50V40M24 40H76M32 50H68M40 60H60" ${common}/>`;
    case 'voltage-source':
      return `<path d="M0 36H22M78 36H100" ${common}/><circle cx="50" cy="36" r="28" ${common}/><path d="M40 24H52M46 18V30M40 48H52" ${common}/>`;
  }
}
