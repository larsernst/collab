import { useEffect } from 'react';

import { isEffectivelyConnected, shouldRefreshServerSession, useServerStore } from '../store/serverStore';
import { listKnownServers } from '../lib/hostedServers';
import { useSyncStore } from '../store/syncStore';

/** How often to retry a dropped/expired server session while disconnected. */
export const AUTO_RECONNECT_INTERVAL_MS = 15_000;

/** Whether we currently have a live, non-expired session to `serverUrl`. */
function connectedTo(serverUrl: string): boolean {
  return isEffectivelyConnected(useServerStore.getState().statusFor(serverUrl));
}

function needsRefresh(serverUrl: string): boolean {
  return shouldRefreshServerSession(useServerStore.getState().statusFor(serverUrl));
}

/**
 * Keeps every saved hosted server session alive automatically. For each known
 * server that is disconnected or whose access token has expired, it retries a
 * quiet refresh-token reconnect on a fixed interval (and immediately on the
 * network `online` / window `focus` events). The moment a connection to a server
 * is (re)established — by this loop, a manual reconnect, or startup restore — it
 * runs an automatic sync of every local replica for that server, so offline edits
 * queued across all of that server's vaults are pushed without the user acting.
 *
 * Mounted once at the app root. All work is guarded so nothing runs for servers
 * that have been forgotten (e.g. after an explicit logout).
 */
export function useServerAutoReconnect(): void {
  useEffect(() => {
    let cancelled = false;
    const wasConnected = new Map<string, boolean>();
    const reconnecting = new Set<string>();

    const evaluate = async () => {
      if (cancelled) return;
      await Promise.all(
        listKnownServers().map(async ({ serverUrl }) => {
          const connected = connectedTo(serverUrl);

          // Rising edge: a connection to this server just came back (from any
          // source). Push all of that server's queued offline edits.
          if (connected && !wasConnected.get(serverUrl)) {
            void useSyncStore.getState().syncAllForServer(serverUrl);
          }
          wasConnected.set(serverUrl, connected);

          // Quiet reconnect while saved but not live. `autoReconnect` only mutates
          // the store on success, so a failed attempt does not re-trigger this via
          // the subscription; the interval drives the next retry.
          if ((!connected || needsRefresh(serverUrl)) && !reconnecting.has(serverUrl)) {
            reconnecting.add(serverUrl);
            try {
              await useServerStore.getState().autoReconnect(serverUrl);
            } finally {
              reconnecting.delete(serverUrl);
            }
          }
        }),
      );
    };

    // React to store changes (reconnect success, manual reconnect, disconnect).
    const unsubscribe = useServerStore.subscribe(() => {
      void evaluate();
    });
    // Fixed-interval retry, also catching time-based token expiry (which emits no
    // store event) by re-evaluating the effective-connection state.
    const interval = window.setInterval(() => void evaluate(), AUTO_RECONNECT_INTERVAL_MS);
    const kick = () => void evaluate();
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);

    void evaluate();

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
    };
  }, []);
}
