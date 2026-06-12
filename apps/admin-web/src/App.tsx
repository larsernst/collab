import {
  Activity,
  Boxes,
  CircleAlert,
  ChevronRight,
  Database,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  Gauge,
  KeyRound,
  LogOut,
  Move as MoveIcon,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SunMoon,
  Upload,
  Users,
} from 'lucide-react';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { serverApi } from './api';
import { useAdminAppearance, type AdminAccent, type AdminTheme } from './theme';
import type {
  AdminOverview,
  AuditEvent,
  HostedVaultActivityEvent,
  HostedVaultAdminDetail,
  HostedFileEntry,
  HostedFileRevision,
  HostedVaultMember,
  HostedVaultStorage,
  HostedVaultSummary,
  Invitation,
  ServerUser,
} from './types';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Input, PromptDialog, SelectMenu, Separator, Switch } from './ui';

type View = 'dashboard' | 'users' | 'vaults' | 'audit' | 'settings';

export function isSelectedFile(value: FormDataEntryValue | null): value is File {
  return value instanceof globalThis.File && value.size > 0;
}

export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

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
  return <main className="auth-page"><Card className="auth-card"><div className="logo-mark"><KeyRound size={24} /></div><h1>Accept invitation</h1><p className="subtle">Choose a password of at least 12 characters for your Collab account.</p><form onSubmit={accept}><Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required />{error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}<Button>Create account</Button></form></Card></main>;
}

function AccessDenied({ onLogout }: { onLogout: () => void }) {
  async function logout() {
    await serverApi.logout().catch(() => undefined);
    onLogout();
  }
  return (
    <main className="auth-page">
      <Card className="auth-card">
        <div className="logo-mark"><ShieldCheck size={24} /></div>
        <h1>Administrator access required</h1>
        <p className="subtle">This account can use Collab, but it cannot manage the server.</p>
        <Button onClick={logout}>Sign out</Button>
      </Card>
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
      <Card className="auth-card">
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
          <Button disabled={busy}>{busy ? 'Working...' : mode === 'bootstrap' ? 'Create administrator' : 'Sign in'}</Button>
        </form>
      </Card>
    </main>
  );
}

function AdminShell({ me, onLogout }: { me: ServerUser; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const { appearance, setAppearance } = useAdminAppearance();
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
          <NavButton active={view === 'settings'} icon={<Settings />} label="Settings" onClick={() => setView('settings')} />
        </nav>
        <div className="profile"><div><strong>{me.displayName}</strong><small>{me.username}</small></div><Button variant="ghost" size="icon" title="Sign out" onClick={logout}><LogOut size={17} /></Button></div>
      </aside>
      <main className="content">
        {view === 'dashboard' && <Dashboard />}
        {view === 'users' && <UsersPage currentUser={me} />}
        {view === 'vaults' && <VaultsPage />}
        {view === 'audit' && <AuditPage />}
        {view === 'settings' && <SettingsPage appearance={appearance} onChange={setAppearance} />}
      </main>
    </div>
  );
}

function SettingsPage({
  appearance,
  onChange,
}: {
  appearance: ReturnType<typeof useAdminAppearance>['appearance'];
  onChange: ReturnType<typeof useAdminAppearance>['setAppearance'];
}) {
  const themes: Array<{ value: AdminTheme; label: string; detail: string }> = [
    { value: 'dark', label: 'Dark', detail: 'Balanced dark workspace' },
    { value: 'midnight', label: 'Midnight', detail: 'Deep, low-contrast surfaces' },
    { value: 'warm', label: 'Warm', detail: 'Soft charcoal and amber tones' },
    { value: 'light', label: 'Light', detail: 'Bright neutral workspace' },
  ];
  const accents: AdminAccent[] = ['violet', 'blue', 'emerald', 'rose', 'orange', 'cyan'];
  return (
    <>
      <PageHeader eyebrow="PREFERENCES" title="Settings" subtitle="Tune the administration interface to match your Collab workspace." />
      <Panel title="Appearance" icon={<SunMoon size={17} />}>
        <div className="settings-stack">
          <div className="settings-row">
            <div><strong>Theme</strong><small>Choose the base surface palette.</small></div>
            <SelectMenu
              label="Theme"
              value={appearance.theme}
              options={themes.map((theme) => ({ value: theme.value, label: theme.label }))}
              onChange={(value) => onChange((current) => ({ ...current, theme: value as AdminTheme }))}
            />
          </div>
          <Separator />
          <div className="settings-row settings-row-top">
            <div><strong>Accent color</strong><small>Used for focus, selection, and primary actions.</small></div>
            <div className="accent-picker" role="group" aria-label="Accent color">
              {accents.map((accent) => <Button key={accent} variant={appearance.accent === accent ? 'default' : 'outline'} size="icon" className={`accent-swatch accent-${accent}`} aria-label={accent} title={accent} onClick={() => onChange((current) => ({ ...current, accent }))}><span /></Button>)}
            </div>
          </div>
          <Separator />
          <div className="settings-row">
            <div><strong>Compact density</strong><small>Reduce spacing in data-heavy server views.</small></div>
            <Switch label="Compact density" checked={appearance.compact} onCheckedChange={(compact) => onChange((current) => ({ ...current, compact }))} />
          </div>
        </div>
      </Panel>
      <Panel title="Preview" icon={<Gauge size={17} />}>
        <div className="appearance-preview">
          <div><Badge variant="success">Server healthy</Badge><h2>{themes.find((theme) => theme.value === appearance.theme)?.label} administration</h2><p className="subtle">The interface updates immediately and persists in this browser.</p></div>
          <Button>Primary action</Button>
        </div>
      </Panel>
    </>
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
  const [confirmDelete, setConfirmDelete] = useState<ServerUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ServerUser | null>(null);
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
    try {
      await serverApi.deleteUser(user.id);
      if (activity?.user.id === user.id) setActivity(null);
      await load();
    } catch (reason) { setError(String(reason)); }
  }
  return (
    <>
      <PageHeader eyebrow="IDENTITY" title="Users" subtitle="Create accounts, issue invitations, and manage access." action={<div className="actions"><Button variant="outline" size="sm" onClick={() => setShowInvite(!showInvite)}>Invite user</Button><Button size="sm" onClick={() => setShowCreate(!showCreate)}><Plus size={16} />Add user</Button></div>} />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {showCreate && <Panel title="Create user" icon={<Plus size={17} />}><form className="inline-form" onSubmit={create}><Field label="Display name" name="displayName" required /><Field label="Username" name="username" required /><Field label="Temporary password" name="password" type="password" required /><label className="check"><Checkbox name="admin" /> Administrator</label><Button size="sm">Create user</Button></form></Panel>}
      {showInvite && <Panel title="Invite user" icon={<KeyRound size={17} />}><form className="inline-form" onSubmit={invite}><Field label="Display name" name="displayName" required /><Field label="Username" name="username" required /><Field label="Expires in hours" name="expiresInHours" type="number" min={1} max={720} defaultValue={72} required /><label className="check"><Checkbox name="admin" /> Administrator</label><Button size="sm">Create link</Button></form>{invitationLink && <div className="invitation-link" role="status"><code>{invitationLink}</code><Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(invitationLink)}>Copy</Button></div>}</Panel>}
      <Panel title={`${users.length} server users`} icon={<Users size={17} />}>
        <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div><div className="grow"><strong>{user.displayName}</strong><small>{user.username} · {user.role}{user.isPrimaryAdmin ? ' · primary administrator' : ''}</small></div><Badge variant={user.status === 'active' ? 'success' : 'destructive'}>{user.status}</Badge><span className="session-count">{user.activeSessions} sessions</span><Button variant="outline" size="sm" onClick={async () => setActivity({ user, events: await serverApi.userActivity(user.id) })}>Activity</Button><Button variant="outline" size="sm" onClick={() => setResetTarget(user)}>Reset password</Button>{user.status === 'disabled' ? <Button variant="outline" size="sm" disabled={user.isPrimaryAdmin} onClick={() => setDisabled(user, false)}>Re-enable</Button> : <Button variant="outline" size="sm" disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => setDisabled(user, true)}>Disable</Button>}<Button variant="outline" size="sm" onClick={async () => { await serverApi.revokeSessions(user.id); await load(); }}>Revoke sessions</Button><Button variant="destructive" size="sm" disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => setConfirmDelete(user)}>Delete account</Button></div>)}</div>
      </Panel>
      <Panel title={`${invitations.length} invitations`} icon={<KeyRound size={17} />}><div className="audit-list">{invitations.map((invitation) => <div className="audit-row" key={invitation.id}><div className="grow"><strong>{invitation.displayName}</strong><small>{invitation.username} · expires {new Date(invitation.expiresAt).toLocaleString()}</small></div><span className="request-chip">{invitation.acceptedAt ? 'accepted' : invitation.revokedAt ? 'revoked' : new Date(invitation.expiresAt) < new Date() ? 'expired' : 'pending'}</span></div>)}</div></Panel>
      {activity && <Panel title={`${activity.user.displayName} activity`} icon={<Activity size={17} />}><AuditTable events={activity.events} /></Panel>}
      {confirmDelete && (
        <ConfirmDialog
          destructive
          title={`Delete ${confirmDelete.username}?`}
          description="The account is permanently deleted. This cannot be undone."
          confirmLabel="Delete account"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const user = confirmDelete;
            setConfirmDelete(null);
            void deleteAccount(user);
          }}
        />
      )}
      {resetTarget && (
        <PromptDialog
          title={`Reset password for ${resetTarget.username}`}
          description="Every session of this user is revoked and the new password takes effect immediately."
          label="New password"
          type="password"
          minLength={12}
          submitLabel="Reset password"
          onCancel={() => setResetTarget(null)}
          onSubmit={async (password) => {
            const user = resetTarget;
            setResetTarget(null);
            try {
              await serverApi.resetPassword(user.id, password);
              await load();
            } catch (reason) {
              setError(String(reason));
            }
          }}
        />
      )}
    </>
  );
}

function VaultsPage() {
  const [vaults, setVaults] = useState<HostedVaultSummary[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => serverApi.vaults().then(setVaults).catch((reason) => setError(String(reason))), []);
  useEffect(() => void load(), [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await serverApi.createVault({ name: form.get('name') });
      setShowCreate(false);
      await load();
    } catch (reason) {
      setError(String(reason));
    }
  }
  if (selectedVaultId) {
    return <VaultDetailPage vaultId={selectedVaultId} onBack={() => { setSelectedVaultId(null); void load(); }} />;
  }
  return (
    <>
      <PageHeader
        eyebrow="HOSTED CONTENT"
        title="Vaults"
        subtitle="Canonical hosted vaults with storage, membership, and lifecycle controls."
        action={<Button size="sm" onClick={() => setShowCreate(!showCreate)}><Plus size={16} />New vault</Button>}
      />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {showCreate && (
        <Panel title="Create vault" icon={<Plus size={17} />}>
          <form className="inline-form" onSubmit={create}>
            <Field label="Vault name" name="name" maxLength={128} required />
            <Button size="sm">Create vault</Button>
          </form>
          <p className="subtle">You become the vault owner and can add members from the vault detail view.</p>
        </Panel>
      )}
      {vaults.length === 0 ? (
        <div className="empty-state"><Boxes size={34} /><h2>No hosted vaults yet</h2><p>Create a vault here or through the Phase 3 API and it will appear in this inventory.</p></div>
      ) : (
        <Panel title={`${vaults.length} hosted vaults`} icon={<Boxes size={17} />}>
          <div className="audit-list">
            {vaults.map((vault) => (
              <div className="audit-row" key={vault.id}>
                <div className="grow"><strong>{vault.name}</strong><small>{vault.ownerDisplayName} · {vault.members} members · {formatBytes(vault.storageBytes)}</small></div>
                <span className={`status ${vault.status === 'active' ? 'active' : 'disabled'}`}>{vault.status.replace('_', ' ')}</span>
                <Button variant="outline" size="sm" aria-label={`Manage ${vault.name}`} onClick={() => setSelectedVaultId(vault.id)}>Manage</Button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'viewer' },
  { value: 'editor', label: 'editor' },
  { value: 'admin', label: 'admin' },
];

function VaultDetailPage({ vaultId, onBack }: { vaultId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<HostedVaultAdminDetail | null>(null);
  const [members, setMembers] = useState<HostedVaultMember[]>([]);
  const [activity, setActivity] = useState<HostedVaultActivityEvent[]>([]);
  const [storage, setStorage] = useState<HostedVaultStorage | null>(null);
  const [files, setFiles] = useState<HostedFileEntry[]>([]);
  const [manifestSequence, setManifestSequence] = useState(0);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [historyFile, setHistoryFile] = useState<HostedFileEntry | null>(null);
  const [revisions, setRevisions] = useState<HostedFileRevision[]>([]);
  const [moveFile, setMoveFile] = useState<HostedFileEntry | null>(null);
  const [moveParentId, setMoveParentId] = useState('');
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    label: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [nextDetail, nextMembers, nextActivity, nextUsers, nextStorage, nextManifest] = await Promise.all([
        serverApi.vaultDetail(vaultId),
        serverApi.vaultMembers(vaultId),
        serverApi.vaultActivity(vaultId),
        serverApi.users(),
        serverApi.vaultStorage(vaultId).catch(() => null),
        serverApi.vaultFiles(vaultId),
      ]);
      setDetail(nextDetail);
      setMembers(nextMembers);
      setActivity(nextActivity);
      setUsers(nextUsers);
      setStorage(nextStorage);
      setFiles(nextManifest.files);
      setManifestSequence(nextManifest.sequence);
    } catch (reason) {
      setError(String(reason));
    }
  }, [vaultId]);
  useEffect(() => void load(), [load]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
    } catch (reason) {
      setError(String(reason));
    }
  }
  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = users.filter((user) => user.status === 'active' && !memberIds.has(user.id));
  const memberChoice = candidates.some((user) => user.id === newMemberId)
    ? newMemberId
    : candidates[0]?.id ?? '';
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberChoice) return;
    await run(() => serverApi.addVaultMember(vaultId, { userId: memberChoice, role: newMemberRole }));
    setNewMemberId('');
    setNewMemberRole('viewer');
  }

  async function importVault(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      await serverApi.importVault(vaultId, await fileToBase64(file));
      await load();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function exportVault() {
    setError('');
    try {
      const blob = await serverApi.exportVault(vaultId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detail?.name ?? 'collab-vault'}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function downloadFile(file: HostedFileEntry) {
    setError('');
    try {
      const blob = await serverApi.downloadFile(vaultId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function showHistory(file: HostedFileEntry) {
    setError('');
    try {
      setHistoryFile(file);
      setRevisions(await serverApi.fileRevisions(vaultId, file.id));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function moveSelectedFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!moveFile) return;
    await run(() => serverApi.moveFile(vaultId, {
      clientOperationId: crypto.randomUUID(),
      baseManifestSequence: manifestSequence,
      operationType: 'move',
      targetFileId: moveFile.id,
      parentId: moveParentId || null,
    }));
    setMoveFile(null);
    setMoveParentId('');
  }

  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const currentFolder = currentFolderId ? filesById.get(currentFolderId) : null;
  const breadcrumbs = useMemo(() => {
    const folders: HostedFileEntry[] = [];
    let folder = currentFolder;
    while (folder) {
      folders.unshift(folder);
      folder = folder.parentId ? filesById.get(folder.parentId) : undefined;
    }
    return folders;
  }, [currentFolder, filesById]);
  const normalizedSearch = fileSearch.trim().toLocaleLowerCase();
  const visibleFiles = useMemo(() => {
    const matching = normalizedSearch
      ? files.filter((file) => file.relativePath.toLocaleLowerCase().includes(normalizedSearch))
      : files.filter((file) => file.parentId === currentFolderId);
    return [...matching].sort((left, right) => {
      if (left.kind === 'folder' && right.kind !== 'folder') return -1;
      if (left.kind !== 'folder' && right.kind === 'folder') return 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
  }, [currentFolderId, files, normalizedSearch]);

  function openFolder(folderId: string | null) {
    setCurrentFolderId(folderId);
    setFileSearch('');
    setHistoryFile(null);
  }

  const pendingDelete = detail?.status === 'pending_delete';
  const lifecycleActions = detail && (
    <div className="actions">
      <Button variant="outline" size="sm" onClick={onBack}>Back to vaults</Button>
      <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>Rename</Button>
      {detail.status === 'active' && <Button variant="outline" size="sm" onClick={() => run(() => serverApi.updateVault(vaultId, { status: 'archived' }))}>Archive vault</Button>}
      {detail.status === 'archived' && <Button variant="outline" size="sm" onClick={() => run(() => serverApi.updateVault(vaultId, { status: 'active' }))}>Reactivate vault</Button>}
      {pendingDelete ? (
        <Button variant="outline" size="sm" onClick={() => run(() => serverApi.updateVault(vaultId, { status: 'active' }))}>Restore vault</Button>
      ) : (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirm({
            title: `Delete ${detail.name}?`,
            description: 'The vault is marked for deletion and stops accepting changes.',
            label: 'Delete vault',
            action: () => serverApi.deleteVault(vaultId),
          })}
        >
          Delete vault
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="HOSTED CONTENT"
        title={detail?.name ?? 'Vault'}
        subtitle={detail ? `Owned by ${detail.ownerDisplayName} (${detail.ownerUsername}) · ${detail.status.replace('_', ' ')}` : 'Loading vault details...'}
        action={lifecycleActions ?? <Button variant="outline" size="sm" onClick={onBack}>Back to vaults</Button>}
      />
      {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}
      {!detail ? <Loading /> : <>
        <div className="metric-grid">
          <Metric icon={<Database />} label="Vault storage" value={formatBytes(detail.storageBytes)} detail="Sum of all stored revisions" />
          <Metric icon={<Boxes />} label="Active files" value={detail.activeFiles} detail={`${detail.trashedFiles} in trash`} />
          <Metric icon={<Users />} label="Members" value={detail.members} detail="Persisted vault memberships" />
          <Metric icon={<Activity />} label="Manifest sequence" value={detail.manifestSequence} detail={`Updated ${new Date(detail.updatedAt).toLocaleString()}`} />
        </div>
        <Panel title="Storage and transfer" icon={<Database size={17} />}>
          {storage ? (
            <div className="storage-grid">
              <Metric icon={<Database />} label="Active content" value={formatBytes(storage.activeBytes)} detail={`${storage.activeFiles} active entries`} />
              <Metric icon={<Database />} label="Trash content" value={formatBytes(storage.trashBytes)} detail={`${storage.trashedFiles} trashed entries`} />
              <Metric icon={<Database />} label="Retained history" value={formatBytes(storage.retainedRevisionBytes)} detail={`${storage.revisionCount} revisions · ${storage.snapshotCount} snapshots`} />
              <Metric icon={<Database />} label="Unique blobs" value={formatBytes(storage.uniqueBlobBytes)} detail="Deduplicated within this vault" />
            </div>
          ) : (
            <p className="subtle">Detailed storage accounting requires this administrator to be a vault member.</p>
          )}
          <div className="transfer-actions">
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={(event) => void importVault(event)}
            />
            <Button
              size="sm"
              onClick={() => importInputRef.current?.click()}
              disabled={detail.status !== 'active' || detail.activeFiles > 0 || importing}
            >
              <Upload size={16} />{importing ? 'Importing...' : 'Import ZIP into empty vault'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportVault()} disabled={detail.status === 'pending_delete'}><Download size={16} />Export ZIP</Button>
          </div>
          <p className="subtle">Import requires an empty active vault. Server administrators can transfer content across every hosted vault.</p>
        </Panel>
        <Panel title="Vault files" icon={<Folder size={17} />}>
          <div className="file-browser-toolbar">
            <nav className="file-breadcrumbs" aria-label="Vault file path">
              <Button variant="ghost" size="sm" onClick={() => openFolder(null)} aria-current={currentFolderId === null ? 'page' : undefined}>
                <FolderOpen size={15} />Vault root
              </Button>
              {breadcrumbs.map((folder) => (
                <span key={folder.id}>
                  <ChevronRight size={14} />
                  <Button variant="ghost" size="sm" onClick={() => openFolder(folder.id)} aria-current={currentFolderId === folder.id ? 'page' : undefined}>{folder.name}</Button>
                </span>
              ))}
            </nav>
            <label className="file-search">
              <Search size={15} />
              <Input
                type="search"
                value={fileSearch}
                placeholder="Search all vault files"
                aria-label="Search vault files"
                onChange={(event) => setFileSearch(event.target.value)}
              />
            </label>
          </div>
          <p className="subtle file-browser-summary">
            {normalizedSearch
              ? `${visibleFiles.length} matches across the vault`
              : `${visibleFiles.length} entries in ${currentFolder?.relativePath ?? 'Vault root'}`}
          </p>
          <div className="file-browser">
            <div className="file-row file-header">
              <span>{normalizedSearch ? 'Path' : 'Name'}</span><span>Size</span><span>Modified</span><span>State</span><span>Actions</span>
            </div>
            {visibleFiles.map((file) => (
              <div className="file-row" key={file.id}>
                <div className="file-name">
                  {file.kind === 'folder' ? <Folder size={16} /> : <FileIcon size={16} />}
                  <span>
                    {file.kind === 'folder'
                      ? <button type="button" className="file-open-button" onClick={() => openFolder(file.id)}>{normalizedSearch ? file.relativePath : file.name}</button>
                      : <strong>{normalizedSearch ? file.relativePath : file.name}</strong>}
                    <small>{file.kind}{file.documentType ? ` · ${file.documentType}` : ''}</small>
                  </span>
                </div>
                <span>{file.currentRevision ? formatBytes(file.currentRevision.sizeBytes) : '—'}</span>
                <span>{new Date(file.updatedAt).toLocaleString()}</span>
                <Badge variant={file.state === 'active' ? 'success' : 'destructive'}>{file.state}</Badge>
                <div className="actions">
                  <Button aria-label={`Download ${file.relativePath}`} variant="outline" size="sm" disabled={file.kind === 'folder' || file.state !== 'active'} onClick={() => void downloadFile(file)}><Download size={15} />Download</Button>
                  <Button aria-label={`Move ${file.relativePath}`} variant="outline" size="sm" disabled={file.state !== 'active'} onClick={() => { setMoveFile(file); setMoveParentId(file.parentId ?? ''); }}><MoveIcon size={15} />Move</Button>
                  <Button aria-label={`History ${file.relativePath}`} variant="outline" size="sm" disabled={file.kind !== 'document' || file.state !== 'active'} onClick={() => void showHistory(file)}>History</Button>
                </div>
              </div>
            ))}
            {visibleFiles.length === 0 && <div className="file-browser-empty">{normalizedSearch ? 'No files match this search.' : 'This folder is empty.'}</div>}
          </div>
        </Panel>
        {historyFile && (
          <Panel title={`Revision history · ${historyFile.relativePath}`} icon={<Activity size={17} />}>
            <div className="audit-list">
              {revisions.map((revision) => (
                <div className="audit-row" key={revision.id}>
                  <div className="grow"><strong>Revision {revision.sequence}</strong><small>{formatBytes(revision.sizeBytes)} · {revision.createdByDisplayName ?? 'System'} · {new Date(revision.createdAt).toLocaleString()}</small></div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revision.id === historyFile.currentRevision?.id || detail.status !== 'active' || historyFile.state !== 'active'}
                    onClick={() => void run(async () => {
                      await serverApi.restoreFileRevision(vaultId, historyFile.id, revision.id, historyFile.currentRevision?.sequence ?? 0);
                      setHistoryFile(null);
                    })}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <Panel title={`${members.length} members`} icon={<Users size={17} />}>
          <div className="user-list">
            {members.map((member) => (
              <div className="user-row" key={member.userId}>
                <div className="avatar">{member.displayName.slice(0, 2).toUpperCase()}</div>
                <div className="grow"><strong>{member.displayName}</strong><small>{member.username}{member.owner ? ' · owner' : ''}</small></div>
                {member.owner ? <Badge variant="success">admin</Badge> : (
                  <SelectMenu
                    size="sm"
                    label={`Role for ${member.username}`}
                    value={member.role}
                    options={ROLE_OPTIONS}
                    disabled={pendingDelete}
                    onChange={(role) => void run(() => serverApi.updateVaultMember(vaultId, member.userId, { role }))}
                  />
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={member.owner || pendingDelete}
                  onClick={() => setConfirm({
                    title: `Remove ${member.username}?`,
                    description: `They immediately lose access to ${detail.name}.`,
                    label: 'Remove member',
                    action: () => serverApi.removeVaultMember(vaultId, member.userId),
                  })}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {!pendingDelete && candidates.length > 0 && (
            <form className="inline-form" onSubmit={addMember}>
              <label className="field"><span>User</span>
                <SelectMenu
                  label="Add member user"
                  value={memberChoice}
                  options={candidates.map((user) => ({ value: user.id, label: `${user.displayName} (${user.username})` }))}
                  onChange={setNewMemberId}
                />
              </label>
              <label className="field"><span>Role</span>
                <SelectMenu
                  label="New member role"
                  value={newMemberRole}
                  options={ROLE_OPTIONS}
                  onChange={setNewMemberRole}
                />
              </label>
              <Button size="sm">Add member</Button>
            </form>
          )}
        </Panel>
        <Panel title="Vault activity" icon={<Activity size={17} />}>
          {activity.length === 0 ? <p className="subtle">No recorded activity yet.</p> : (
            <div className="audit-list">
              {activity.map((event) => (
                <div className="audit-row" key={event.id}>
                  <span className="event-dot success" />
                  <div className="grow"><strong>{event.eventType.replaceAll('.', ' ').replaceAll('_', ' ')}</strong><small>{event.actorDisplayName ?? 'System'} · {new Date(event.createdAt).toLocaleString()}</small></div>
                  {event.targetType && <span className="request-chip">{event.targetType}</span>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </>}
      {confirm && (
        <ConfirmDialog
          destructive
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const pending = confirm;
            setConfirm(null);
            void run(pending.action);
          }}
        />
      )}
      {renaming && detail && (
        <PromptDialog
          title="Rename vault"
          description="The new name is visible to every vault member."
          label="Vault name"
          defaultValue={detail.name}
          submitLabel="Rename"
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            setRenaming(false);
            void run(() => serverApi.updateVault(vaultId, { name }));
          }}
        />
      )}
      {moveFile && (
        <div className="dialog-backdrop" role="presentation">
          <Card className="dialog" role="dialog" aria-modal="true" aria-label={`Move ${moveFile.name}`}>
            <h2>Move {moveFile.name}</h2>
            <p className="subtle">Choose a destination folder. References are rewritten by the hosted-vault operation.</p>
            <form onSubmit={moveSelectedFile}>
              <label className="field"><span>Destination</span>
                <SelectMenu
                  label="Destination folder"
                  value={moveParentId}
                  options={[
                    { value: '', label: 'Vault root' },
                    ...files
                      .filter((file) => file.kind === 'folder' && file.state === 'active' && file.id !== moveFile.id && !file.relativePath.startsWith(`${moveFile.relativePath}/`))
                      .map((file) => ({ value: file.id, label: file.relativePath })),
                  ]}
                  onChange={setMoveParentId}
                />
              </label>
              <div className="dialog-actions"><Button type="button" variant="outline" onClick={() => setMoveFile(null)}>Cancel</Button><Button>Move</Button></div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
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
function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) { return <Card className="panel"><div className="panel-title">{icon}<h2>{title}</h2></div>{children}</Card>; }
function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail: string }) { return <Card className="metric"><div className="metric-icon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{detail}</small></Card>; }
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { const { label, ...inputProps } = props; return <label className="field"><span>{label}</span><Input {...inputProps} /></label>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <Button variant="ghost" className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></Button>; }
function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) { return <Button variant="outline" size="icon" title={label} aria-label={label} onClick={onClick}>{children}</Button>; }
function Loading() { return <div className="empty-state"><RefreshCw className="spin" /><p>Loading server data...</p></div>; }
function CenteredMessage({ title }: { title: string }) { return <main className="auth-page"><Card className="auth-card"><Server size={28} /><h1>{title}</h1></Card></main>; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
