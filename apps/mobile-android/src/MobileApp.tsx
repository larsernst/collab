import { Cloud, FolderOpen, Library, Settings as SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Banner } from './components/ui';
import { applyTheme, loadPrefs, savePrefs, type ThemePrefs } from './lib/theme';
import { FilesScreen } from './screens/FilesScreen';
import { ServersScreen } from './screens/ServersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VaultsScreen } from './screens/VaultsScreen';
import { type Tab, useMobileStore } from './state/store';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'servers', label: 'Servers', icon: <Cloud size={20} aria-hidden /> },
  { id: 'vaults', label: 'Vaults', icon: <Library size={20} aria-hidden /> },
  { id: 'files', label: 'Files', icon: <FolderOpen size={20} aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} aria-hidden /> },
];

const BACK_SENTINEL = { collabBack: true };

export function MobileApp() {
  const [prefs, setPrefs] = useState<ThemePrefs>(() => {
    const initial = loadPrefs();
    applyTheme(initial);
    return initial;
  });
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restore = useMobileStore((s) => s.restore);
  const refreshStatuses = useMobileStore((s) => s.refreshStatuses);
  const syncServer = useMobileStore((s) => s.syncServer);
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);
  const selected = useMobileStore((s) => s.selected);
  const statuses = useMobileStore((s) => s.statuses);

  // Whether the Android back button has somewhere to go inside the app.
  const canGoBack = useMobileStore(
    (s) => !!s.activeSheet || (s.tab === 'files' && s.folderTrail.length > 1) || s.tab !== 'servers',
  );

  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status.connected).length,
    [statuses],
  );

  useEffect(() => {
    restore().catch((reason: unknown) => {
      setRestoreError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [restore]);

  // Keep connection status fresh when the app returns to the foreground, and
  // replay any offline-queued writes for still-connected servers (foreground
  // sync — Android may suspend background work, so this is the primary trigger).
  useEffect(() => {
    const onFocus = () => {
      void (async () => {
        await refreshStatuses().catch(() => {});
        const { statuses: current, syncServer: sync } = useMobileStore.getState();
        await Promise.all(
          Object.values(current)
            .filter((status) => status.connected && status.serverUrl)
            .map((status) => sync(status.serverUrl as string).catch(() => {})),
        );
      })();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshStatuses, syncServer]);

  // Android hardware back / back-gesture handling.
  //
  // The webview absorbs the system back through a history entry: we keep exactly
  // one "sentinel" entry armed whenever there is somewhere to go back to inside
  // the app (an open sheet, a subfolder, or a non-home tab). A back press pops the
  // sentinel (`popstate`), we navigate one level in-app, and re-arm if more remains.
  // When nothing remains we leave no sentinel, so the next back exits the app.
  const armedRef = useRef(false);
  const programmaticRef = useRef(false);

  useEffect(() => {
    const onPop = () => {
      // Ignore the popstate caused by our own sentinel removal below.
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      armedRef.current = false;
      useMobileStore.getState().goBack();
      // Re-arm if the new location still has an in-app back target.
      const state = useMobileStore.getState();
      const stillBack =
        !!state.activeSheet ||
        (state.tab === 'files' && state.folderTrail.length > 1) ||
        state.tab !== 'servers';
      if (stillBack) {
        window.history.pushState(BACK_SENTINEL, '');
        armedRef.current = true;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Arm the sentinel when back becomes available; remove it (without navigating)
  // when in-app navigation clears the last back target through the UI.
  useEffect(() => {
    if (canGoBack && !armedRef.current) {
      window.history.pushState(BACK_SENTINEL, '');
      armedRef.current = true;
    } else if (!canGoBack && armedRef.current) {
      armedRef.current = false;
      programmaticRef.current = true;
      window.history.back();
    }
  }, [canGoBack]);

  const updatePrefs = useCallback((next: ThemePrefs) => {
    setPrefs(next);
    applyTheme(next);
    savePrefs(next);
  }, []);

  return (
    <div className="app-root">
      <main className="app-main">
        {restoreError ? (
          <div className="screen-top-banner">
            <Banner tone="error">{restoreError}</Banner>
          </div>
        ) : null}

        {tab === 'servers' ? <ServersScreen onOpenServer={() => setTab('vaults')} /> : null}
        {tab === 'vaults' ? <VaultsScreen /> : null}
        {tab === 'files' ? <FilesScreen prefs={prefs} /> : null}
        {tab === 'settings' ? <SettingsScreen prefs={prefs} onChange={updatePrefs} /> : null}
      </main>

      <nav className="tab-bar" aria-label="Primary">
        {TABS.map((item) => {
          const badge =
            item.id === 'servers' && connectedCount > 0
              ? connectedCount
              : item.id === 'files' && selected
                ? '•'
                : null;
          return (
            <button
              key={item.id}
              type="button"
              className={`tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <span className="tab-icon">
                {item.icon}
                {badge != null ? <span className="tab-badge">{badge}</span> : null}
              </span>
              <span className="tab-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
