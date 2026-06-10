import {
  Activity,
  Boxes,
  CircleAlert,
  Database,
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
import type { AdminOverview, AuditEvent, HostedVaultSummary, Invitation, ServerUser } from './types';

type View = 'dashboard' | 'users' | 'vaults' | 'audit';

export function App() {
  const invitationToken = new URLSearchParams(window.location.search).get('invite');
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

  useEffect(() => {
    if (!invitationToken) void refreshSession();
  }, [invitationToken, refreshSession]);

  if (invitationToken) return <InvitationScreen token={invitationToken} />;
  if (error && bootRequired === null) return <CenteredMessage title={error} />;
  if (bootRequired === null) return <CenteredMessage title="Connecting to Collab server..." />;
  if (bootRequired) return <AuthScreen mode="bootstrap" onAuthenticated={(user) => { setBootRequired(false); setMe(user); }} />;
  if (!me) return <AuthScreen mode="login" onAuthenticated={setMe} />;
  if (me.role !== 'admin') return <AccessDenied onLogout={() => setMe(null)} />;
  return <AdminShell me={me} onLogout={() => setMe(null)} />;
}

function InvitationScreen({ token }: { token: string }) {
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    try {
      await serverApi.acceptInvitation(token, String(password));
      window.history.replaceState({}, '', '/admin/');
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not accept the invitation.');
    }
  }
  if (done) return <CenteredMessage title="Invitation accepted. Reload to continue." />;
  return <main className="auth-page"><section className="auth-card"><div className="logo-mark"><KeyRound size={24} /></div><h1>Accept invitation</h1><p className="subtle">Choose a password of at least 12 characters for your Collab account.</p><form onSubmit={accept}><Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required />{error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}<button className="primary-button">Create account</button></form></section></main>;
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
          <Metric icon={<ShieldCheck />} label="Server health" value={overview.health} detail={`${Math.floor(overview.uptimeSeconds / 60)} minutes uptime`} />
          <Metric icon={<Users />} label="Active users" value={overview.activeUsers} detail={`${overview.users} total`} />
          <Metric icon={<KeyRound />} label="Active sessions" value={overview.activeSessions} detail="Revocable browser sessions" />
          <Metric icon={<Boxes />} label="Hosted vaults" value={overview.hostedVaults} detail="Vault storage arrives in Phase 3" />
          <Metric icon={<Server />} label="Server version" value={`v${overview.serverVersion}`} detail={`Protocol ${overview.protocolVersion}`} />
          <Metric icon={<Database />} label="Database storage" value={formatBytes(overview.storage.databaseBytes)} detail={`${formatBytes(overview.storage.blobBytes)} blobs`} />
          <Metric icon={<KeyRound />} label="Pending invitations" value={overview.pendingInvitations} detail="One-time expiring links" />
        </div>
        {overview.operationalWarnings.length > 0 && <Panel title="Operational warnings" icon={<CircleAlert size={17} />}><div className="warning-list">{overview.operationalWarnings.map((warning) => <div className="warning-row" key={warning.code}><CircleAlert size={16} /><div><strong>{warning.code.replaceAll('_', ' ')}</strong><small>{warning.message}</small></div></div>)}</div></Panel>}
        <Panel title="Recent activity" icon={<Activity size={17} />}><AuditTable events={overview.recentAuditEvents} /></Panel>
      </>}
    </>
  );
}

function UsersPage({ currentUser }: { currentUser: ServerUser }) {
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitationLink, setInvitationLink] = useState('');
  const [activity, setActivity] = useState<{ user: ServerUser; events: AuditEvent[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [nextUsers, nextInvitations] = await Promise.all([serverApi.users(), serverApi.invitations()]);
      setUsers(nextUsers);
      setInvitations(nextInvitations);
    } catch (reason) { setError(String(reason)); }
  }, []);
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
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await serverApi.createInvitation({
        username: form.get('username'),
        displayName: form.get('displayName'),
        admin: form.get('admin') === 'on',
        expiresInHours: Number(form.get('expiresInHours')),
      });
      setInvitationLink(`${window.location.origin}/admin/?invite=${created.token}`);
      await load();
    } catch (reason) { setError(String(reason)); }
  }
  async function setDisabled(user: ServerUser, disabled: boolean) {
    try {
      await serverApi.updateUser(user.id, { disabled });
      await load();
    } catch (reason) { setError(String(reason)); }
  }
  async function deleteAccount(user: ServerUser) {
    if (!window.confirm(`Permanently delete ${user.username}? This cannot be undone.`)) return;
    try {
      await serverApi.deleteUser(user.id);
      if (activity?.user.id === user.id) setActivity(null);
      await load();
    } catch (reason) { setError(String(reason)); }
  }
  return (
    <>
      <PageHeader eyebrow="IDENTITY" title="Users" subtitle="Create accounts, issue invitations, and manage access." action={<div className="actions"><button onClick={() => setShowInvite(!showInvite)}>Invite user</button><button className="primary-button compact" onClick={() => setShowCreate(!showCreate)}><Plus size={16} />Add user</button></div>} />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {showCreate && <Panel title="Create user" icon={<Plus size={17} />}><form className="inline-form" onSubmit={create}><Field label="Display name" name="displayName" required /><Field label="Username" name="username" required /><Field label="Temporary password" name="password" type="password" required /><label className="check"><input type="checkbox" name="admin" /> Administrator</label><button className="primary-button compact">Create user</button></form></Panel>}
      {showInvite && <Panel title="Invite user" icon={<KeyRound size={17} />}><form className="inline-form" onSubmit={invite}><Field label="Display name" name="displayName" required /><Field label="Username" name="username" required /><Field label="Expires in hours" name="expiresInHours" type="number" min={1} max={720} defaultValue={72} required /><label className="check"><input type="checkbox" name="admin" /> Administrator</label><button className="primary-button compact">Create link</button></form>{invitationLink && <div className="invitation-link" role="status"><code>{invitationLink}</code><button onClick={() => navigator.clipboard?.writeText(invitationLink)}>Copy</button></div>}</Panel>}
      <Panel title={`${users.length} server users`} icon={<Users size={17} />}>
        <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div><div className="grow"><strong>{user.displayName}</strong><small>{user.username} · {user.role}{user.isPrimaryAdmin ? ' · primary administrator' : ''}</small></div><span className={`status ${user.status}`}>{user.status}</span><span className="session-count">{user.activeSessions} sessions</span><button onClick={async () => setActivity({ user, events: await serverApi.userActivity(user.id) })}>Activity</button><button onClick={async () => { const password = window.prompt(`New password for ${user.username}`); if (password) { await serverApi.resetPassword(user.id, password); await load(); } }}>Reset password</button>{user.status === 'disabled' ? <button disabled={user.isPrimaryAdmin} onClick={() => setDisabled(user, false)}>Re-enable</button> : <button disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => setDisabled(user, true)}>Disable</button>}<button onClick={async () => { await serverApi.revokeSessions(user.id); await load(); }}>Revoke sessions</button><button className="danger-button" disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => deleteAccount(user)}>Delete account</button></div>)}</div>
      </Panel>
      <Panel title={`${invitations.length} invitations`} icon={<KeyRound size={17} />}><div className="audit-list">{invitations.map((invitation) => <div className="audit-row" key={invitation.id}><div className="grow"><strong>{invitation.displayName}</strong><small>{invitation.username} · expires {new Date(invitation.expiresAt).toLocaleString()}</small></div><span className="request-chip">{invitation.acceptedAt ? 'accepted' : invitation.revokedAt ? 'revoked' : new Date(invitation.expiresAt) < new Date() ? 'expired' : 'pending'}</span></div>)}</div></Panel>
      {activity && <Panel title={`${activity.user.displayName} activity`} icon={<Activity size={17} />}><AuditTable events={activity.events} /></Panel>}
    </>
  );
}

function VaultsPage() {
  const [vaults, setVaults] = useState<HostedVaultSummary[]>([]);
  useEffect(() => void serverApi.vaults().then(setVaults), []);
  return <><PageHeader eyebrow="HOSTED CONTENT" title="Vaults" subtitle="Read-only inventory backed by canonical hosted-vault storage." />{vaults.length === 0 ? <div className="empty-state"><Boxes size={34} /><h2>No hosted vaults yet</h2><p>Hosted vaults created through the Phase 3 API will appear here.</p></div> : <Panel title={`${vaults.length} hosted vaults`} icon={<Boxes size={17} />}><div className="audit-list">{vaults.map((vault) => <div className="audit-row" key={vault.id}><div className="grow"><strong>{vault.name}</strong><small>{vault.ownerDisplayName} · {vault.members} members · {formatBytes(vault.storageBytes)}</small></div><span className={`status ${vault.status === 'active' ? 'active' : 'disabled'}`}>{vault.status.replace('_', ' ')}</span></div>)}</div></Panel>}</>;
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
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
