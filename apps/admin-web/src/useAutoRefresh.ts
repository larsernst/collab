import { useEffect, useRef } from 'react';

/**
 * Background auto-refresh for admin pages.
 *
 * The admin API has no server change-feed, so each page keeps its own data
 * fresh by polling. This hook layers polling on top of a page's existing
 * `load` callback without changing its initial-load semantics (the page keeps
 * its own mount effect): it re-runs `load` on an interval, immediately when the
 * window regains focus, and when a hidden tab becomes visible again. Polling is
 * skipped while the tab is hidden so background tabs do not hammer the server.
 *
 * `load` is read through a ref, so the interval is not torn down and recreated
 * when the callback identity changes between renders.
 */
export const DEFAULT_AUTO_REFRESH_MS = 5_000;

export function useAutoRefresh(
  load: () => void | Promise<void>,
  options?: { intervalMs?: number; enabled?: boolean },
) {
  const intervalMs = options?.intervalMs ?? DEFAULT_AUTO_REFRESH_MS;
  const enabled = options?.enabled ?? true;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => {
      void loadRef.current();
    };

    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') run();
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onFocus = () => run();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, intervalMs]);
}
