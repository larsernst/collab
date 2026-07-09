import { CheckCircle2, Cloud, Database, FileText, KanbanSquare, Loader2, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import {
  checkServerHealth,
  loadConnectionStatuses,
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
  const [appDataPath, setAppDataPath] = useState<string | null>(null);
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
      .then((probe) => setAppDataPath(probe.filePath))
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
          <strong>{appDataPath ? 'Writable' : 'Pending'}</strong>
          <span>Persisted probe</span>
          <strong>{appDataPath ? appDataPath.split('/').pop() : 'Not written yet'}</strong>
        </div>
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
