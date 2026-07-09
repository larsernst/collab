import { ChevronRight, Cloud, Library, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';

import { Banner, EmptyState, ReadOnlyBadge, RoleBadge, Spinner } from '../components/ui';
import { formatBytes, formatRelativeTime, isReadOnlyRole } from '../lib/format';
import type { HostedVault } from '../mobileTauri';
import { useMobileStore } from '../state/store';

export function VaultsScreen({ onOpenVault }: { onOpenVault: () => void }) {
  const statuses = useMobileStore((s) => s.statuses);
  const vaults = useMobileStore((s) => s.vaults);
  const vaultsBusy = useMobileStore((s) => s.vaultsBusy);
  const selected = useMobileStore((s) => s.selected);
  const loadVaults = useMobileStore((s) => s.loadVaults);
  const selectVault = useMobileStore((s) => s.selectVault);

  const connectedServers = useMemo(
    () => Object.values(statuses).filter((status) => status.connected && status.serverUrl),
    [statuses],
  );

  async function handleSelect(serverUrl: string, vault: HostedVault) {
    await selectVault(serverUrl, vault);
    onOpenVault();
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>Vaults</h1>
          <p>{connectedServers.length > 0 ? 'Choose a vault to browse' : 'No connected servers'}</p>
        </div>
      </header>

      {connectedServers.length === 0 ? (
        <EmptyState
          icon={<Cloud size={28} aria-hidden />}
          title="Nothing to show"
          message="Connect to a hosted server on the Servers tab to see its vaults here."
        />
      ) : null}

      {connectedServers.map((status) => {
        const serverUrl = status.serverUrl as string;
        const list = vaults[serverUrl] ?? [];
        const busy = vaultsBusy[serverUrl];
        return (
          <section className="server-group" key={serverUrl}>
            <div className="server-group-header">
              <span className="server-group-name">{serverUrl.replace(/^https?:\/\//, '')}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => loadVaults(serverUrl)}
                disabled={busy}
              >
                {busy ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden />}
                Refresh
              </button>
            </div>

            {list.length === 0 && !busy ? (
              <Banner tone="info">No vaults are available to you on this server.</Banner>
            ) : null}

            <ul className="list">
              {list.map((vault) => {
                const isActive =
                  selected?.vault.id === vault.id && selected?.serverUrl === serverUrl;
                return (
                  <li className="list-row" key={vault.id}>
                    <button
                      type="button"
                      className={`row-main vault-row ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelect(serverUrl, vault)}
                    >
                      <div className="vault-icon">
                        <Library size={20} aria-hidden />
                      </div>
                      <div className="row-text">
                        <strong>{vault.name}</strong>
                        <span>
                          {formatBytes(vault.storageBytes)} · {vault.members} member
                          {vault.members === 1 ? '' : 's'}
                          {vault.updatedAt ? ` · ${formatRelativeTime(vault.updatedAt)}` : ''}
                        </span>
                      </div>
                      <div className="vault-badges">
                        {isReadOnlyRole(vault.role) ? <ReadOnlyBadge /> : null}
                        <RoleBadge role={vault.role} />
                        <ChevronRight size={18} aria-hidden className="row-chevron" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
