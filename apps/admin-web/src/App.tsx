import {
  Activity,
  Boxes,
  CircleAlert,
  Gauge,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { serverApi } from './api';
import type { AdminOverview, AuditEvent, ServerUser } from './types';

type View = 'dashboard' | 'users' | 'vaults' | 'audit';

export function App() {
  const [bootRequired, setBootRequired] = useState<boolean | null>(null);
  const [me, setMe] = useState<ServerUser | null>(null);
  const [error, setError] = useState('');

  const refreshSession = useCallback(async () => {
    setError('');
    try {
      const status = await serverApi.bootstrapStatus();
      setBootRequired(status.required);
      if (!status.required) setMe(await serverApi.me().catch(() => null));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reach the server.');
    }
  }, []);

  useEffect(() => void refreshSession(), [refreshSession]);

  if (error && bootRequired === null) return <CenteredMessage title={error} />;
  if (bootRequired === null) return <CenteredMessage title="Connecting to Collab server..." />;
  if (bootRequired) return <AuthScreen mode="bootstrap" onAuthenticated={(user) => { setBootRequired(false); setMe(user); }} />;
  if (!me) return <AuthScreen mode="login" onAuthenticated={setMe} />;
  if (me.role !== 'admin') return <AccessDenied onLogout={() => setMe(null)} />;
  return <AdminShell me={me} onLogout={() => setMe(null)} />;
}

function AccessDenied({ onLogout }: { onLogout: () => void }) {
  async function logout() {
    await serverApi.logout().catch(() => undefined);
    onLogout();
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="logo-mark"><ShieldCheck size={24} /></div>
        <h1>Administrator access required</h1>
        <p className="subtle">This account can use Collab, but it cannot manage the server.</p>
        <button className="primary-button" onClick={logout}>Sign out</button>
      </section>
    </main>
  );
}

function AuthScreen({
  mode,
  onAuthenticated,
}: {
  mode: 'bootstrap' | 'login';
  onAuthenticated: (user: ServerUser) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const action = mode === 'bootstrap' ? serverApi.bootstrap : serverApi.login;
      const session = await action({
        username: form.get('username'),
        displayName: form.get('displayName') || form.get('username'),
        password: form.get('password'),
        admin: true,
      });
      onAuthenticated(session.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="logo-mark"><Boxes size={24} /></div>
        <p className="eyebrow">COLLAB SERVER</p>
        <h1>{mode === 'bootstrap' ? 'Create the first administrator' : 'Welcome back'}</h1>
        <p className="subtle">
          {mode === 'bootstrap'
            ? 'This one-time account controls server users and future hosted vaults.'
            : 'Sign in to manage this Collab server.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'bootstrap' && <Field label="Display name" name="displayName" autoComplete="name" />}
          <Field label="Username" name="username" autoComplete="username" required />
          <Field label="Password" name="password" type="password" autoComplete={mode === 'bootstrap' ? 'new-password' : 'current-password'} required />
          {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
          <button className="primary-button" disabled={busy}>{busy ? 'Working...' : mode === 'bootstrap' ? 'Create administrator' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}

function AdminShell({ me, onLogout }: { me: ServerUser; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  async function logout() {
    await serverApi.logout().catch(() => undefined);
    onLogout();
  }
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand"><span className="logo-mark small"><Boxes size={18} /></span><div><strong>Collab</strong><small>Server admin</small></div></div>
        <nav aria-label="Administration">
          <NavButton active={view === 'dashboard'} icon={<Gauge />} label="Dashboard" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'users'} icon={<Users />} label="Users" onClick={() => setView('users')} />
          <NavButton active={view === 'vaults'} icon={<Boxes />} label="Vaults" onClick={() => setView('vaults')} />
          <NavButton active={view === 'audit'} icon={<Activity />} label="Audit log" onClick={() => setView('audit')} />
        </nav>
        <div className="profile"><div><strong>{me.displayName}</strong><small>{me.username}</small></div><button title="Sign out" onClick={logout}><LogOut size={17} /></button></div>
      </aside>
      <main className="content">
        {view === 'dashboard' && <Dashboard />}
        {view === 'users' && <UsersPage currentUser={me} />}
        {view === 'vaults' && <VaultsPage />}
        {view === 'audit' && <AuditPage />}
      </main>
    </div>
  );
}

function Dashboard() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => serverApi.overview().then(setOverview).catch((reason) => setError(String(reason))), []);
  useEffect(() => void load(), [load]);
  return (
    <>
      <PageHeader eyebrow="OPERATIONS" title="Server dashboard" subtitle="A quiet overview of identities, sessions, and server activity." action={<IconButton label="Refresh dashboard" onClick={load}><RefreshCw size={16} /></IconButton>} />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {!overview ? <Loading /> : <>
        <div className="metric-grid">
          <Metric icon={<Users />} label="Active users" value={overview.activeUsers} detail={`${overview.users} total`} />
          <Metric icon={<KeyRound />} label="Active sessions" value={overview.activeSessions} detail="Revocable browser sessions" />
          <Metric icon={<Boxes />} label="Hosted vaults" value={overview.hostedVaults} detail="Vault storage arrives in Phase 3" />
          <Metric icon={<Server />} label="Server version" value={`v${overview.serverVersion}`} detail={`Protocol ${overview.protocolVersion}`} />
        </div>
        <Panel title="Recent activity" icon={<Activity size={17} />}><AuditTable events={overview.recentAuditEvents} /></Panel>
      </>}
    </>
  );
}

function UsersPage({ currentUser }: { currentUser: ServerUser }) {
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => serverApi.users().then(setUsers).catch((reason) => setError(String(reason))), []);
  useEffect(() => void load(), [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await serverApi.createUser({
        username: form.get('username'),
        displayName: form.get('displayName'),
        password: form.get('password'),
        admin: form.get('admin') === 'on',
      });
      setShowCreate(false);
      await load();
    } catch (reason) {
      setError(String(reason));
    }
  }
  return (
    <>
      <PageHeader eyebrow="IDENTITY" title="Users" subtitle="Create accounts, disable access, and revoke active sessions." action={<button className="primary-button compact" onClick={() => setShowCreate(!showCreate)}><Plus size={16} />Add user</button>} />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {showCreate && <Panel title="Create user" icon={<Plus size={17} />}><form className="inline-form" onSubmit={create}><Field label="Display name" name="displayName" required /><Field label="Username" name="username" required /><Field label="Temporary password" name="password" type="password" required /><label className="check"><input type="checkbox" name="admin" /> Administrator</label><button className="primary-button compact">Create user</button></form></Panel>}
      <Panel title={`${users.length} server users`} icon={<Users size={17} />}>
        <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div><div className="grow"><strong>{user.displayName}</strong><small>{user.username} · {user.role}</small></div><span className={`status ${user.status}`}>{user.status}</span><span className="session-count">{user.activeSessions} sessions</span><button disabled={user.id === currentUser.id || user.status === 'disabled'} onClick={async () => { await serverApi.updateUser(user.id, { disabled: true }); await load(); }}>Disable</button><button onClick={async () => { await serverApi.revokeSessions(user.id); await load(); }}>Revoke sessions</button></div>)}</div>
      </Panel>
    </>
  );
}

function VaultsPage() {
  return <><PageHeader eyebrow="HOSTED CONTENT" title="Vaults" subtitle="The inventory is ready for the hosted-vault APIs arriving in Phase 3." /><div className="empty-state"><Boxes size={34} /><h2>No hosted vaults yet</h2><p>Once Phase 3 lands, this view will manage owners, members, storage, activity, archive, and export controls.</p></div></>;
}

function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => void serverApi.auditEvents().then(setEvents), []);
  return <><PageHeader eyebrow="SECURITY" title="Audit log" subtitle="Redacted authentication and administration events." /><Panel title="Recent events" icon={<ShieldCheck size={17} />}><AuditTable events={events} /></Panel></>;
}

function AuditTable({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="subtle">No audit events yet.</p>;
  return <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.id}><span className={`event-dot ${event.result}`} /><div className="grow"><strong>{event.action.replaceAll('.', ' ')}</strong><small>{event.actorDisplayName ?? 'System'} · {new Date(event.createdAt).toLocaleString()}</small></div><span className="request-chip">{event.result}</span></div>)}</div>;
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtle">{subtitle}</p></div>{action}</header>;
}
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="panel"><div className="panel-title">{icon}<h2>{title}</h2></div>{children}</section>; }
function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail: string }) { return <article className="metric"><div className="metric-icon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="field"><span>{props.label}</span><input {...props} /></label>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>; }
function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) { return <button className="icon-button" title={label} aria-label={label} onClick={onClick}>{children}</button>; }
function Loading() { return <div className="empty-state"><RefreshCw className="spin" /><p>Loading server data...</p></div>; }
function CenteredMessage({ title }: { title: string }) { return <main className="auth-page"><div className="auth-card"><Server size={28} /><h1>{title}</h1></div></main>; }
