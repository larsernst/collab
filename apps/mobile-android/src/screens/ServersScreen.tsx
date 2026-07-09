import { ChevronRight, Cloud, LogOut, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';

import { Banner, EmptyState, Spinner, StatusDot } from '../components/ui';
import { normalizeServerUrl } from '../lib/servers';
import { useMobileStore } from '../state/store';

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function ServersScreen({ onOpenServer }: { onOpenServer: (serverUrl: string) => void }) {
  const servers = useMobileStore((s) => s.servers);
  const statuses = useMobileStore((s) => s.statuses);
  const connect = useMobileStore((s) => s.connect);
  const reconnect = useMobileStore((s) => s.reconnect);
  const disconnect = useMobileStore((s) => s.disconnect);

  const [showForm, setShowForm] = useState(servers.length === 0);
  const [serverUrl, setServerUrl] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [allowInvalid, setAllowInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status.connected).length,
    [statuses],
  );

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect(serverUrl, username.trim(), password, {
        allowInvalidCertificates: allowInvalid,
        persistAcrossReboots: true,
      });
      setPassword('');
      setShowForm(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function withPending(serverUrl: string, action: () => Promise<void>) {
    setPending(serverUrl);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>Servers</h1>
          <p>{connectedCount > 0 ? `${connectedCount} connected` : 'Not connected'}</p>
        </div>
        {!showForm ? (
          <button className="header-action" type="button" onClick={() => setShowForm(true)}>
            <Plus size={18} aria-hidden />
            Add
          </button>
        ) : null}
      </header>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {showForm ? (
        <form className="card form-card" onSubmit={handleConnect}>
          <div className="card-title">
            <Cloud size={18} aria-hidden />
            <span>Connect to a hosted server</span>
          </div>
          <label className="field">
            <span>Server URL</span>
            <input
              value={serverUrl}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://collab.example.com"
              onChange={(event) => setServerUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Username</span>
            <input
              value={username}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              value={password}
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={allowInvalid}
              onChange={(event) => setAllowInvalid(event.target.checked)}
            />
            <span>
              <strong>Allow untrusted certificate</strong>
              <em>Only for private servers with a self-signed certificate.</em>
            </span>
          </label>
          <div className="form-actions">
            {servers.length > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowForm(false)}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !serverUrl.trim() || !username.trim() || !password}
            >
              {busy ? <Spinner /> : <Cloud size={18} aria-hidden />}
              Sign in
            </button>
          </div>
        </form>
      ) : null}

      {servers.length === 0 && !showForm ? (
        <EmptyState
          icon={<Cloud size={28} aria-hidden />}
          title="No servers yet"
          message="Add a hosted Collab server to browse its vaults on this device."
        />
      ) : null}

      <ul className="list">
        {servers.map((server) => {
          const key = normalizeServerUrl(server.serverUrl);
          const status = statuses[key];
          const online = !!status?.connected;
          const isPending = pending === key;
          return (
            <li className="list-row server-row" key={key}>
              <button
                type="button"
                className="row-main"
                disabled={!online}
                onClick={() => onOpenServer(key)}
              >
                <StatusDot online={online} />
                <div className="row-text">
                  <strong>{key.replace(/^https?:\/\//, '')}</strong>
                  <span>
                    {online
                      ? status?.user?.displayName || status?.user?.username || server.username
                      : 'Disconnected'}
                    {server.allowInvalidCertificates ? ' · untrusted TLS' : ''}
                  </span>
                </div>
                {online ? <ChevronRight size={18} aria-hidden className="row-chevron" /> : null}
              </button>
              <div className="row-actions">
                {online ? (
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label="Disconnect"
                    disabled={isPending}
                    onClick={() => withPending(key, () => disconnect(key))}
                  >
                    {isPending ? <Spinner size={16} /> : <LogOut size={16} aria-hidden />}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Reconnect"
                    disabled={isPending}
                    onClick={() => withPending(key, () => reconnect(key))}
                  >
                    {isPending ? <Spinner size={16} /> : <RefreshCw size={16} aria-hidden />}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {servers.some((server) => server.allowInvalidCertificates) ? (
        <p className="footnote">
          <ShieldAlert size={14} aria-hidden /> Untrusted-certificate servers verify TLS loosely.
          Use only for private deployments you trust.
        </p>
      ) : null}
    </div>
  );
}
