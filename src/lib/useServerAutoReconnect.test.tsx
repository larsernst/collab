import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAVED_KEY = 'collab-hosted-server-url';
const mocks = vi.hoisted(() => ({
  serverState: { status: null as unknown },
  subscribers: new Set<() => void>(),
  autoReconnect: vi.fn().mockResolvedValue('failed'),
  syncAllForServer: vi.fn(),
}));
const { serverState, subscribers, autoReconnect, syncAllForServer } = mocks;

vi.mock('../store/serverStore', () => ({
  SERVER_URL_KEY: 'collab-hosted-server-url',
  isEffectivelyConnected: (status: { connected?: boolean; serverUrl?: string } | null) =>
    !!status?.connected && !!status?.serverUrl,
  useServerStore: {
    getState: () => ({ status: mocks.serverState.status, autoReconnect: mocks.autoReconnect }),
    subscribe: (listener: () => void) => {
      mocks.subscribers.add(listener);
      return () => mocks.subscribers.delete(listener);
    },
  },
}));

vi.mock('../store/syncStore', () => ({
  useSyncStore: { getState: () => ({ syncAllForServer: mocks.syncAllForServer }) },
}));

import { AUTO_RECONNECT_INTERVAL_MS, useServerAutoReconnect } from './useServerAutoReconnect';

const CONNECTED = { connected: true, serverUrl: 'https://collab.example.test' };

function emitStoreChange() {
  for (const listener of [...subscribers]) listener();
}

function Harness() {
  useServerAutoReconnect();
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useServerAutoReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autoReconnect.mockResolvedValue('failed');
    subscribers.clear();
    serverState.status = null;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does nothing when there is no saved session', async () => {
    render(<Harness />);
    await flush();
    expect(autoReconnect).not.toHaveBeenCalled();
    expect(syncAllForServer).not.toHaveBeenCalled();
  });

  it('attempts a reconnect on mount while a saved session is disconnected', async () => {
    localStorage.setItem(SAVED_KEY, CONNECTED.serverUrl);
    render(<Harness />);
    await flush();
    expect(autoReconnect).toHaveBeenCalledTimes(1);
    expect(syncAllForServer).not.toHaveBeenCalled();
  });

  it('does not attempt a reconnect when already effectively connected', async () => {
    localStorage.setItem(SAVED_KEY, CONNECTED.serverUrl);
    serverState.status = CONNECTED;
    render(<Harness />);
    await flush();
    expect(autoReconnect).not.toHaveBeenCalled();
  });

  it('syncs all of the server\'s replicas when the connection is (re)established', async () => {
    localStorage.setItem(SAVED_KEY, CONNECTED.serverUrl);
    render(<Harness />);
    await flush();
    expect(syncAllForServer).not.toHaveBeenCalled();

    // The session comes back (by this loop or a manual reconnect): a store change
    // fires, and the rising edge triggers the automatic sync exactly once.
    serverState.status = CONNECTED;
    await act(async () => {
      emitStoreChange();
      await Promise.resolve();
    });
    expect(syncAllForServer).toHaveBeenCalledWith(CONNECTED.serverUrl);

    // A subsequent unrelated store change does not re-sync (no new rising edge).
    await act(async () => {
      emitStoreChange();
      await Promise.resolve();
    });
    expect(syncAllForServer).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying on the interval while disconnected', async () => {
    vi.useFakeTimers();
    localStorage.setItem(SAVED_KEY, CONNECTED.serverUrl);
    render(<Harness />);
    await act(async () => { await Promise.resolve(); });
    expect(autoReconnect).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(AUTO_RECONNECT_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(autoReconnect).toHaveBeenCalledTimes(2);
  });
});
