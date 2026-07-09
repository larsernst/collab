import { CheckCircle2, Cloud, Database, FileText, KanbanSquare, Loader2, Server, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  checkServerHealth,
  connectServer,
  HostedVaultProbe,
  loadConnectionStatuses,
  listHostedVaults,
  listReplicas,
  MobileAppDataProbe,
  reconnectServer,
  ReplicaSummaryProbe,
  ServerConnectionStatus,
  ServerHealthStatus,
  writeAppDataProbe,
} from './mobileTauri';

const LAST_SERVER_KEY = 'collab-mobile-last-server';

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function MobileApp() {
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem(LAST_SERVER_KEY) ?? 'https://collab.ernst.casa';
  });
  const [health, setHealth] = useState<ServerHealthStatus | null>(null);
  const [connections, setConnections] = useState<ServerConnectionStatus[]>([]);
  const [appDataProbe, setAppDataProbe] = useState<MobileAppDataProbe | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [replicaBusy, setReplicaBusy] = useState(false);
  const [hostedVaults, setHostedVaults] = useState<HostedVaultProbe[]>([]);
  const [replicas, setReplicas] = useState<ReplicaSummaryProbe[]>([]);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const [replicaMessage, setReplicaMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connectedLabel = useMemo(() => {
    if (connections.length === 0) return 'No active native sessions';
    return `${connections.length} native session${connections.length === 1 ? '' : 's'}`;
  }, [connections.length]);

  useEffect(() => {
    loadConnectionStatuses()
      .then(setConnections)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    writeAppDataProbe(`phase-0:${new Date().toISOString()}`)
      .then(setAppDataProbe)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  async function handleCheckServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeServerUrl(serverUrl);
    setServerUrl(normalized);
    localStorage.setItem(LAST_SERVER_KEY, normalized);
    setBusy(true);
    setError(null);
    try {
      setHealth(await checkServerHealth(normalized));
    } catch (reason) {
      setHealth(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeServerUrl(serverUrl);
    setServerUrl(normalized);
    localStorage.setItem(LAST_SERVER_KEY, normalized);
    setLoginBusy(true);
    setLoginMessage(null);
    setError(null);
    try {
      const status = await connectServer(normalized, username.trim(), password);
      const nextConnections = await loadConnectionStatuses();
      setConnections(nextConnections);
      setLoginMessage(`Signed in as ${status.user?.displayName || status.user?.username || username.trim()}.`);
      setVaultMessage(null);
      setPassword('');
    } catch (reason) {
      setLoginMessage(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleRestoreSession() {
    const normalized = normalizeServerUrl(serverUrl);
    setServerUrl(normalized);
    localStorage.setItem(LAST_SERVER_KEY, normalized);
    setRestoreBusy(true);
    setLoginMessage(null);
    setError(null);
    try {
      const status = await reconnectServer(normalized);
      const nextConnections = await loadConnectionStatuses();
      setConnections(nextConnections);
      setLoginMessage(`Restored session for ${status.user?.displayName || status.user?.username || normalized}.`);
      setVaultMessage(null);
    } catch (reason) {
      setLoginMessage(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestoreBusy(false);
    }
  }

  async function handleListVaults() {
    const normalized = normalizeServerUrl(serverUrl);
    setServerUrl(normalized);
    localStorage.setItem(LAST_SERVER_KEY, normalized);
    setVaultBusy(true);
    setVaultMessage(null);
    setError(null);
    try {
      const vaults = await listHostedVaults(normalized);
      setHostedVaults(vaults);
      setVaultMessage(`${vaults.length} hosted vault${vaults.length === 1 ? '' : 's'} available.`);
    } catch (reason) {
      setHostedVaults([]);
      setVaultMessage(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleListReplicas() {
    setReplicaBusy(true);
    setReplicaMessage(null);
    setError(null);
    try {
      const summaries = await listReplicas();
      setReplicas(summaries);
      setReplicaMessage(`${summaries.length} local replica${summaries.length === 1 ? '' : 's'} found.`);
    } catch (reason) {
      setReplicas([]);
      setReplicaMessage(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReplicaBusy(false);
    }
  }

  return (
    <main className="mobile-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Android companion</span>
          <h1>Collab</h1>
          <p>Server access, offline groundwork, notes, Kanban, and lightweight file viewing for hosted vaults.</p>
        </div>
        <div className="status-pill">
          <Wifi size={16} aria-hidden />
          Phase 0
        </div>
      </section>

      <form className="panel server-panel" onSubmit={handleCheckServer}>
        <div className="panel-heading">
          <Cloud size={18} aria-hidden />
          <div>
            <h2>Server access</h2>
            <p>Native HTTPS probe through Rust</p>
          </div>
        </div>
        <label className="field">
          <span>Server URL</span>
          <input
            value={serverUrl}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => setServerUrl(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          Check server
        </button>
        {health ? (
          <div className={health.ok ? 'result ok' : 'result warning'}>
            <strong>{health.ok ? 'Reachable' : 'Not reachable'}</strong>
            <span>{health.message}</span>
          </div>
        ) : null}
        {error ? (
          <div className="result error">
            <strong>Native command error</strong>
            <span>{error}</span>
          </div>
        ) : null}
      </form>

      <form className="panel" onSubmit={handleLogin}>
        <div className="panel-heading">
          <CheckCircle2 size={18} aria-hidden />
          <div>
            <h2>Auth probe</h2>
            <p>Native login without exposing tokens to the WebView</p>
          </div>
        </div>
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
        <button className="primary-button secondary-button" type="submit" disabled={loginBusy || !username || !password}>
          {loginBusy ? <Loader2 className="spin" size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          Test login
        </button>
        <button className="primary-button ghost-button" type="button" disabled={restoreBusy} onClick={handleRestoreSession}>
          {restoreBusy ? <Loader2 className="spin" size={18} aria-hidden /> : <Database size={18} aria-hidden />}
          Restore session
        </button>
        {loginMessage ? (
          <div className="result ok">
            <strong>Authenticated</strong>
            <span>{loginMessage}</span>
          </div>
        ) : null}
      </form>

      <section className="panel">
        <div className="panel-heading">
          <Database size={18} aria-hidden />
          <div>
            <h2>Native bridge</h2>
            <p>{connectedLabel}</p>
          </div>
        </div>
        <div className="info-grid">
          <span>App data</span>
          <strong>{appDataProbe ? 'Writable' : 'Pending'}</strong>
          <span>Persisted probe</span>
          <strong>{appDataProbe ? appDataProbe.filePath.split('/').pop() : 'Not written yet'}</strong>
          <span>Restored value</span>
          <strong>{appDataProbe?.previousValue ? 'Found from last launch' : 'No previous launch yet'}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <Database size={18} aria-hidden />
          <div>
            <h2>Replica store</h2>
            <p>Android app-private offline storage probe</p>
          </div>
        </div>
        <button className="primary-button ghost-button" type="button" disabled={replicaBusy} onClick={handleListReplicas}>
          {replicaBusy ? <Loader2 className="spin" size={18} aria-hidden /> : <Database size={18} aria-hidden />}
          Check replicas
        </button>
        {replicaMessage ? (
          <div className="result ok">
            <strong>Replica store opened</strong>
            <span>{replicaMessage}</span>
          </div>
        ) : null}
        {replicas.length > 0 ? (
          <div className="vault-list">
            {replicas.slice(0, 6).map((replica) => (
              <div className="vault-row" key={`${replica.serverUrl}:${replica.vaultId}`}>
                <strong>{replica.vaultName}</strong>
                <span>
                  {[replica.status, `${replica.pendingCount} pending`, `seq ${replica.manifestSequence}`].join(' · ')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <Server size={18} aria-hidden />
          <div>
            <h2>Hosted API</h2>
            <p>Authenticated vault list through native Rust</p>
          </div>
        </div>
        <button className="primary-button ghost-button" type="button" disabled={vaultBusy} onClick={handleListVaults}>
          {vaultBusy ? <Loader2 className="spin" size={18} aria-hidden /> : <Server size={18} aria-hidden />}
          List vaults
        </button>
        {vaultMessage ? (
          <div className="result ok">
            <strong>Hosted request worked</strong>
            <span>{vaultMessage}</span>
          </div>
        ) : null}
        {hostedVaults.length > 0 ? (
          <div className="vault-list">
            {hostedVaults.slice(0, 6).map((vault) => (
              <div className="vault-row" key={vault.id}>
                <strong>{vault.name}</strong>
                <span>{[vault.role, vault.status].filter(Boolean).join(' · ') || 'available'}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="feature-list">
        <Feature icon={<FileText size={18} aria-hidden />} title="Notes" status="Phase 4" />
        <Feature icon={<KanbanSquare size={18} aria-hidden />} title="Kanban" status="Phase 5" />
        <Feature icon={<Cloud size={18} aria-hidden />} title="Offline replicas" status="Phase 3" />
      </section>
    </main>
  );
}

function Feature(props: { icon: ReactNode; title: string; status: string }) {
  return (
    <div className="feature-card">
      <span className="feature-icon">{props.icon}</span>
      <strong>{props.title}</strong>
      <span>{props.status}</span>
    </div>
  );
}
