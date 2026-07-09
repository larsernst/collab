import { Cloud, FolderOpen, Library, Settings as SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Banner } from './components/ui';
import { applyTheme, loadPrefs, savePrefs, type ThemePrefs } from './lib/theme';
import { FilesScreen } from './screens/FilesScreen';
import { ServersScreen } from './screens/ServersScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { VaultsScreen } from './screens/VaultsScreen';
import { useMobileStore } from './state/store';

type Tab = 'servers' | 'vaults' | 'files' | 'settings';

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'servers', label: 'Servers', icon: <Cloud size={20} aria-hidden /> },
  { id: 'vaults', label: 'Vaults', icon: <Library size={20} aria-hidden /> },
  { id: 'files', label: 'Files', icon: <FolderOpen size={20} aria-hidden /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={20} aria-hidden /> },
];

export function MobileApp() {
  const [tab, setTab] = useState<Tab>('servers');
  const [prefs, setPrefs] = useState<ThemePrefs>(() => {
    const initial = loadPrefs();
    applyTheme(initial);
    return initial;
  });
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restore = useMobileStore((s) => s.restore);
  const refreshStatuses = useMobileStore((s) => s.refreshStatuses);
  const selected = useMobileStore((s) => s.selected);
  const statuses = useMobileStore((s) => s.statuses);

  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status.connected).length,
    [statuses],
  );

  useEffect(() => {
    restore().catch((reason: unknown) => {
      setRestoreError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [restore]);

  // Keep connection status fresh when the app returns to the foreground.
  useEffect(() => {
    const onFocus = () => {
      refreshStatuses().catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshStatuses]);

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
        {tab === 'vaults' ? <VaultsScreen onOpenVault={() => setTab('files')} /> : null}
        {tab === 'files' ? <FilesScreen /> : null}
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
