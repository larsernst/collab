import { useEffect } from 'react';

import {
  isEffectivelyConnected,
  SERVER_URL_KEY,
  useServerStore,
} from '../store/serverStore';
import { useSyncStore } from '../store/syncStore';

/** How often to retry a dropped/expired server session while disconnected. */
export const AUTO_RECONNECT_INTERVAL_MS = 15_000;

/** Whether we currently have a live, non-expired session to the saved server. */
function connectedToSavedServer(): boolean {
  const savedServerUrl = localStorage.getItem(SERVER_URL_KEY);
  if (!savedServerUrl) return false;
  const status = useServerStore.getState().status;
  return isEffectivelyConnected(status) && status?.serverUrl === savedServerUrl;
}

/**
 * Keeps the hosted server session alive automatically. While a saved session is
 * disconnected or its access token has expired, it retries a quiet refresh-token
 * reconnect on a fixed interval (and immediately when the OS reports the network
 * came back or the window regains focus). The moment a connection to the saved
 * server is (re)established — by this loop, a manual reconnect, or startup
 * restore — it runs an automatic sync of every local replica for that server, so
 * offline edits queued across all of that server's vaults are pushed without the
 * user having to act.
 *
 * Mounted once at the app root. All work is guarded so nothing runs when there
 * is no saved session (e.g. after an explicit logout).
 */
export function useServerAutoReconnect(): void {
  useEffect(() => {
    let cancelled = false;
    let wasConnected = connectedToSavedServer();
    let reconnecting = false;

    const evaluate = async () => {
      if (cancelled) return;
      const savedServerUrl = localStorage.getItem(SERVER_URL_KEY);
      const connected = connectedToSavedServer();

      // Rising edge: a connection to the saved server just came back (from any
      // source). Push all of that server's queued offline edits.
      if (connected && !wasConnected && savedServerUrl) {
        void useSyncStore.getState().syncAllForServer(savedServerUrl);
      }
      wasConnected = connected;

      // Attempt a quiet reconnect while we have a saved session but no live one.
      // `autoReconnect` only mutates the store on success, so a failed attempt
      // does not re-trigger this via the subscription (avoiding a tight loop);
      // the interval drives the next retry.
      if (savedServerUrl && !connected && !reconnecting) {
        reconnecting = true;
        try {
          await useServerStore.getState().autoReconnect();
        } finally {
          reconnecting = false;
        }
      }
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
