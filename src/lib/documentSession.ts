import { useCallback, useRef } from 'react';

export const DOCUMENT_SNAPSHOT_INTERVAL_MS = 60_000;

export function useDocumentSessionState() {
  const hashRef = useRef<string | undefined>(undefined);
  const lastWriteRef = useRef(0);
  const skipNextAutosaveRef = useRef(true);
  const lastSnapshotHashRef = useRef<string | null>(null);
  const lastSnapshotTimeRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<null | (() => Promise<void>)>(null);

  const markLoaded = useCallback((hash?: string | null) => {
    hashRef.current = hash ?? undefined;
    skipNextAutosaveRef.current = true;
  }, []);

  const shouldSkipAutosave = useCallback(() => {
    if (!skipNextAutosaveRef.current) return false;
    skipNextAutosaveRef.current = false;
    return true;
  }, []);

  const markWriteStarted = useCallback(() => {
    lastWriteRef.current = Date.now();
  }, []);

  const shouldCreateSnapshot = useCallback((hash: string, now = Date.now(), intervalMs = DOCUMENT_SNAPSHOT_INTERVAL_MS) => {
    if (hash === lastSnapshotHashRef.current) return false;
    if (now - lastSnapshotTimeRef.current < intervalMs) return false;
    lastSnapshotHashRef.current = hash;
    lastSnapshotTimeRef.current = now;
    return true;
  }, []);

  /**
   * Runs document saves one at a time. If a save is requested while another is in
   * flight, the request is coalesced: only the most recent `save` thunk runs once
   * the current one finishes. This prevents overlapping writes from racing on slow
   * connections, where a second autosave would otherwise be sent with an already
   * stale optimistic version and rejected by the server ("file revision changed").
   * The latest thunk always reads the freshest content and version, so the trailing
   * save reflects the newest edits with the version returned by the prior write.
   */
  const runExclusiveSave = useCallback(async (save: () => Promise<void>) => {
    if (savingRef.current) {
      pendingSaveRef.current = save;
      return;
    }
    savingRef.current = true;
    try {
      let current: (() => Promise<void>) | null = save;
      while (current) {
        pendingSaveRef.current = null;
        await current();
        current = pendingSaveRef.current;
      }
    } finally {
      savingRef.current = false;
      pendingSaveRef.current = null;
    }
  }, []);

  return {
    hashRef,
    lastWriteRef,
    markLoaded,
    shouldSkipAutosave,
    markWriteStarted,
    shouldCreateSnapshot,
    runExclusiveSave,
  };
}
