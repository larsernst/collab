import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogicDiagramDocument } from '../../../src/types/logicDiagram';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  circuitCancelJob,
  circuitJobStatus,
  circuitStartDc,
  circuitTakeJobResult,
} from './mobileTauri';

describe('mobile circuit commands', () => {
  beforeEach(() => invoke.mockReset());

  it('uses the shared native job commands with typed arguments', async () => {
    const document: LogicDiagramDocument = {
      schemaVersion: 6,
      kind: 'logic-diagram',
      diagramMode: 'schematic',
      nodes: [],
      wires: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    invoke
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce({ phase: 'running', stage: 'solving', elapsedMillis: 2 })
      .mockResolvedValueOnce('cancelling')
      .mockResolvedValueOnce({ state: 'cancelled' });

    await circuitStartDc(document);
    await circuitJobStatus('job-1');
    await circuitCancelJob('job-1');
    await circuitTakeJobResult('job-1');

    expect(invoke.mock.calls).toEqual([
      ['circuit_start_dc', { document }],
      ['circuit_job_status', { jobId: 'job-1' }],
      ['circuit_cancel_job', { jobId: 'job-1' }],
      ['circuit_take_job_result', { jobId: 'job-1' }],
    ]);
  });
});
