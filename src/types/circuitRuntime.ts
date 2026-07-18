export interface CircuitTerminalNet {
  terminal: { nodeId: string; handleId: string };
  electricalNode: string;
}

export interface CircuitWireNet {
  wireId: string;
  electricalNode: string;
}

export type CircuitDcDiagnostic = {
  code: 'npnOutsideForwardActive';
  context: {
    component: string;
    baseEmitterVoltage: number;
    collectorEmitterVoltage: number;
  };
};

export type CircuitProbeValue =
  | { kind: 'node-voltage'; probeId: string; label: string | null; valueVolts: number }
  | { kind: 'branch-current'; probeId: string; label: string | null; valueAmps: number };

export interface CircuitDcResult {
  operatingPoint: {
    nodeVoltages: Record<string, number>;
    componentCurrents: Record<string, number>;
    componentPowers: Record<string, number>;
    diagnostics: CircuitDcDiagnostic[];
    iterations: number;
  };
  sourceMap: {
    terminals: CircuitTerminalNet[];
    wires: CircuitWireNet[];
    probes: Array<{
      probeId: string;
      label: string | null;
      kind: 'node-voltage' | 'branch-current';
      electricalNode?: string;
      component?: string;
    }>;
  };
  probeValues: CircuitProbeValue[];
}

export type CircuitJobPhase = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type CircuitJobStage = 'queued' | 'compiling' | 'solving' | 'finalizing';

export interface CircuitJobStatus {
  phase: CircuitJobPhase;
  stage: CircuitJobStage | null;
  elapsedMillis: number;
}

export type CircuitJobOutcome =
  | { state: 'completed'; result: CircuitDcResult }
  | { state: 'failed'; error: unknown }
  | { state: 'cancelled' };
