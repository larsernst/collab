import { describe, expect, it } from 'vitest';

import { circuitErrorText } from './circuitErrorText';

describe('circuit error text', () => {
  it('formats shared compiler and execution-limit diagnostics', () => {
    expect(circuitErrorText({
      stage: 'compilation',
      detail: { code: 'disconnectedTerminal', context: { nodeId: 'r1', handleId: 'terminal-b' } },
    })).toBe("Connect r1's terminal-b before running DC.");
    expect(circuitErrorText({
      stage: 'simulation',
      detail: { code: 'timeLimitExceeded', context: { limitMillis: 10_000 } },
    })).toBe('The DC simulation exceeded its 10000 ms execution limit.');
  });
});
