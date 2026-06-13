import {
  Activity,
  Boxes,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  Gauge,
  History,
  KeyRound,
  LogOut,
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
  GrantSubjectType,
  HostedVaultActivityEvent,
  HostedVaultAdminDetail,
  HostedFileEntry,
  HostedFileRevision,
  HostedVaultMember,
  HostedVaultStorage,
  HostedVaultSummary,
  Invitation,
  PermissionTemplate,
  ServerUser,
  UserGroup,
  UserGroupMember,
  VaultGrant,
} from './types';
import { ALL_CAPABILITIES, CAPABILITY_GROUPS, capabilityLabel } from './types';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DialogShell, Input, PromptDialog, SelectMenu, Separator, Switch } from './ui';

type View = 'dashboard' | 'users' | 'vaults' | 'permissions' | 'audit' | 'settings';

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
  return <AdminShell me={me} onMeChange={setMe} onLogout={() => setMe(null)} />;
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

function AdminShell({ me, onMeChange, onLogout }: { me: ServerUser; onMeChange: (user: ServerUser) => void; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const { appearance, setAppearance } = useAdminAppearance();
  const [accountOpen, setAccountOpen] = useState(false);
  // Seed appearance from the account's saved preferences once on mount, so a
  // user's chosen theme follows their account across browsers.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const saved = (me.preferences as { appearance?: Partial<typeof appearance> } | null | undefined)?.appearance;
    if (saved) setAppearance((current) => ({ ...current, ...saved }));
  }, [me, setAppearance, appearance]);

  // Appearance changes apply immediately (localStorage) and persist to the
  // account's server-side preferences.
  const persistAppearance: typeof setAppearance = useCallback((updater) => {
    setAppearance((current) => {
      const next = typeof updater === 'function' ? (updater as (value: typeof current) => typeof current)(current) : updater;
      void serverApi.updateSelf({ preferences: { ...(me.preferences ?? {}), appearance: next } }).catch(() => undefined);
      return next;
    });
  }, [me, setAppearance]);

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
          <NavButton active={view === 'permissions'} icon={<ShieldCheck />} label="Permissions" onClick={() => setView('permissions')} />
          <NavButton active={view === 'audit'} icon={<Activity />} label="Audit log" onClick={() => setView('audit')} />
          <NavButton active={view === 'settings'} icon={<Settings />} label="Settings" onClick={() => setView('settings')} />
        </nav>
        <div className="profile">
          <button type="button" className="profile-button" aria-label="Account settings" onClick={() => setAccountOpen(true)}>
            <Avatar user={me} size={32} />
            <div><strong>{me.displayName}</strong><small>{me.username}</small></div>
          </button>
          <Button variant="ghost" size="icon" title="Sign out" onClick={logout}><LogOut size={17} /></Button>
        </div>
      </aside>
      <main className="content">
        {view === 'dashboard' && <Dashboard />}
        {view === 'users' && <UsersPage currentUser={me} />}
        {view === 'vaults' && <VaultsPage />}
        {view === 'permissions' && <PermissionsPage />}
        {view === 'audit' && <AuditPage />}
        {view === 'settings' && <SettingsPage appearance={appearance} onChange={persistAppearance} />}
      </main>
      {accountOpen && (
        <AccountDialog
          me={me}
          appearance={appearance}
          onAppearanceChange={persistAppearance}
          onClose={() => setAccountOpen(false)}
          onUpdated={onMeChange}
        />
      )}
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
  const [editTarget, setEditTarget] = useState<ServerUser | null>(null);
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
        <div className="user-list">{users.map((user) => <div className="user-row" key={user.id}><Avatar user={user} /><div className="grow"><strong>{user.displayName}</strong><small>{user.username} · {user.role}{user.isPrimaryAdmin ? ' · primary administrator' : ''}</small></div><Badge variant={user.status === 'active' ? 'success' : 'destructive'}>{user.status}</Badge><span className="session-count">{user.activeSessions} sessions</span><Button variant="outline" size="sm" onClick={() => setEditTarget(user)}>Edit</Button><Button variant="outline" size="sm" onClick={async () => setActivity({ user, events: await serverApi.userActivity(user.id) })}>Activity</Button><Button variant="outline" size="sm" onClick={() => setResetTarget(user)}>Reset password</Button>{user.status === 'disabled' ? <Button variant="outline" size="sm" disabled={user.isPrimaryAdmin} onClick={() => setDisabled(user, false)}>Re-enable</Button> : <Button variant="outline" size="sm" disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => setDisabled(user, true)}>Disable</Button>}<Button variant="outline" size="sm" onClick={async () => { await serverApi.revokeSessions(user.id); await load(); }}>Revoke sessions</Button><Button variant="destructive" size="sm" disabled={user.id === currentUser.id || user.isPrimaryAdmin} onClick={() => setConfirmDelete(user)}>Delete account</Button></div>)}</div>
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
      {editTarget && (
        <EditUserDialog
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void load(); }}
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
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null | '__root__'>(null);
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [grants, setGrants] = useState<VaultGrant[]>([]);
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [grantSubjectType, setGrantSubjectType] = useState<GrantSubjectType>('group');
  const [grantSubjectId, setGrantSubjectId] = useState('');
  const [grantTemplateId, setGrantTemplateId] = useState('');
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
      const [nextDetail, nextMembers, nextActivity, nextUsers, nextStorage, nextManifest, nextGrants, nextTemplates, nextGroups] = await Promise.all([
        serverApi.vaultDetail(vaultId),
        serverApi.vaultMembers(vaultId),
        serverApi.vaultActivity(vaultId),
        serverApi.users(),
        serverApi.vaultStorage(vaultId).catch(() => null),
        serverApi.vaultFiles(vaultId),
        serverApi.vaultGrants(vaultId).catch(() => []),
        serverApi.templates().catch(() => []),
        serverApi.groups().catch(() => []),
      ]);
      setDetail(nextDetail);
      setMembers(nextMembers);
      setActivity(nextActivity);
      setUsers(nextUsers);
      setStorage(nextStorage);
      setFiles(nextManifest.files);
      setManifestSequence(nextManifest.sequence);
      setGrants(nextGrants);
      setTemplates(nextTemplates);
      setGroups(nextGroups);
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

  async function downloadEntry(file: HostedFileEntry) {
    setError('');
    try {
      const blob = file.kind === 'folder'
        ? await serverApi.downloadFolder(vaultId, file.id)
        : await serverApi.downloadFile(vaultId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.kind === 'folder' ? `${file.name}.zip` : file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(String(reason));
    }
  }

  // Move a file/folder under a new parent via drag-and-drop. Guards against
  // no-op moves and dropping a folder into itself or one of its descendants.
  async function performMove(fileId: string, targetParentId: string | null) {
    const file = filesById.get(fileId);
    if (!file || file.state !== 'active') return;
    if ((file.parentId ?? null) === targetParentId) return;
    if (file.kind === 'folder' && targetParentId) {
      const target = filesById.get(targetParentId);
      if (target && (target.id === file.id || target.relativePath === file.relativePath || target.relativePath.startsWith(`${file.relativePath}/`))) {
        return;
      }
    }
    await run(() => serverApi.moveFile(vaultId, {
      clientOperationId: crypto.randomUUID(),
      baseManifestSequence: manifestSequence,
      operationType: 'move',
      targetFileId: fileId,
      parentId: targetParentId,
    }));
  }

  function handleDropOnTarget(targetParentId: string | null) {
    const fileId = draggingFileId;
    setDraggingFileId(null);
    setDropTargetId(null);
    if (fileId) void performMove(fileId, targetParentId);
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
              <Button
                variant="ghost"
                size="sm"
                className={dropTargetId === '__root__' ? 'drop-target' : ''}
                onClick={() => openFolder(null)}
                aria-current={currentFolderId === null ? 'page' : undefined}
                onDragOver={(event) => { if (draggingFileId) { event.preventDefault(); setDropTargetId('__root__'); } }}
                onDragLeave={() => setDropTargetId((current) => (current === '__root__' ? null : current))}
                onDrop={(event) => { event.preventDefault(); handleDropOnTarget(null); }}
              >
                <FolderOpen size={15} />Vault root
              </Button>
              {breadcrumbs.map((folder) => (
                <span key={folder.id}>
                  <ChevronRight size={14} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className={dropTargetId === folder.id ? 'drop-target' : ''}
                    onClick={() => openFolder(folder.id)}
                    aria-current={currentFolderId === folder.id ? 'page' : undefined}
                    onDragOver={(event) => { if (draggingFileId && draggingFileId !== folder.id) { event.preventDefault(); setDropTargetId(folder.id); } }}
                    onDragLeave={() => setDropTargetId((current) => (current === folder.id ? null : current))}
                    onDrop={(event) => { event.preventDefault(); handleDropOnTarget(folder.id); }}
                  >{folder.name}</Button>
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
              : `${visibleFiles.length} entries in ${currentFolder?.relativePath ?? 'Vault root'} · drag a row onto a folder to move it`}
          </p>
          <div className="file-browser">
            <div className="file-row file-header">
              <span>{normalizedSearch ? 'Path' : 'Name'}</span><span>Size</span><span>Modified</span><span>State</span><span>Actions</span>
            </div>
            {visibleFiles.map((file) => {
              const draggable = file.state === 'active' && !normalizedSearch;
              const isFolderDropTarget = file.kind === 'folder' && dropTargetId === file.id && draggingFileId !== null && draggingFileId !== file.id;
              return (
                <div
                  className={['file-row', draggingFileId === file.id ? 'dragging' : '', isFolderDropTarget ? 'drop-target' : ''].filter(Boolean).join(' ')}
                  key={file.id}
                  draggable={draggable}
                  onDragStart={draggable ? (event) => { setDraggingFileId(file.id); event.dataTransfer.effectAllowed = 'move'; } : undefined}
                  onDragEnd={() => { setDraggingFileId(null); setDropTargetId(null); }}
                  onDragOver={file.kind === 'folder' ? (event) => {
                    if (draggingFileId && draggingFileId !== file.id) { event.preventDefault(); setDropTargetId(file.id); }
                  } : undefined}
                  onDragLeave={file.kind === 'folder' ? () => setDropTargetId((current) => (current === file.id ? null : current)) : undefined}
                  onDrop={file.kind === 'folder' ? (event) => { event.preventDefault(); handleDropOnTarget(file.id); } : undefined}
                >
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
                    <Button aria-label={`Download ${file.relativePath}`} variant="outline" size="sm" disabled={file.state !== 'active'} onClick={() => void downloadEntry(file)}><Download size={15} />{file.kind === 'folder' ? 'Download ZIP' : 'Download'}</Button>
                    {file.kind === 'document' && (
                      <FileHistoryMenu
                        vaultId={vaultId}
                        file={file}
                        canRestore={detail.status === 'active' && file.state === 'active'}
                        onError={setError}
                        onRestored={() => void load()}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {visibleFiles.length === 0 && <div className="file-browser-empty">{normalizedSearch ? 'No files match this search.' : 'This folder is empty.'}</div>}
          </div>
        </Panel>
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
        <Panel title="Access grants" icon={<ShieldCheck size={17} />}>
          <p className="subtle">Grant a user or group access through a permission template. User grants override an existing member's capabilities; removing reverts to the role default.</p>
          <div className="user-list">
            {grants.length === 0 && <p className="subtle">No grants resolved for this vault.</p>}
            {grants.map((grant) => (
              <div className="user-row" key={`${grant.subjectType}:${grant.subjectId}`}>
                <Badge variant="outline">{grant.subjectType}</Badge>
                <div className="grow">
                  <strong>{grant.subjectName}</strong>
                  <small>{grant.templateName ? `Template: ${grant.templateName}` : 'Custom / role default'}</small>
                  <div className="capability-summary-row"><CapabilitySummary capabilities={grant.capabilities} /></div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pendingDelete}
                  onClick={() => setConfirm({
                    title: `Remove grant for ${grant.subjectName}?`,
                    description: grant.subjectType === 'group'
                      ? 'The group loses its grant on this vault.'
                      : 'The member reverts to their role default capabilities.',
                    label: 'Remove grant',
                    action: () => serverApi.deleteVaultGrant(vaultId, grant.subjectType, grant.subjectId),
                  })}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          {!pendingDelete && (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const subjectCandidates = grantSubjectType === 'group'
                  ? groups.map((group) => group.id)
                  : members.filter((member) => !member.owner).map((member) => member.userId);
                const subjectId = subjectCandidates.includes(grantSubjectId) ? grantSubjectId : subjectCandidates[0];
                if (!subjectId) return;
                void run(() => serverApi.putVaultGrant(vaultId, grantSubjectType, subjectId, grantTemplateId ? { templateId: grantTemplateId } : {}));
              }}
            >
              <label className="field"><span>Subject</span>
                <SelectMenu
                  label="Grant subject type"
                  value={grantSubjectType}
                  options={[{ value: 'group', label: 'Group' }, { value: 'user', label: 'User (member)' }]}
                  onChange={(value) => { setGrantSubjectType(value as GrantSubjectType); setGrantSubjectId(''); }}
                />
              </label>
              <label className="field"><span>{grantSubjectType === 'group' ? 'Group' : 'Member'}</span>
                <SelectMenu
                  label="Grant subject"
                  value={grantSubjectId || (grantSubjectType === 'group' ? groups[0]?.id ?? '' : members.find((member) => !member.owner)?.userId ?? '')}
                  options={grantSubjectType === 'group'
                    ? groups.map((group) => ({ value: group.id, label: group.name }))
                    : members.filter((member) => !member.owner).map((member) => ({ value: member.userId, label: member.displayName }))}
                  onChange={setGrantSubjectId}
                />
              </label>
              <label className="field"><span>Template</span>
                <SelectMenu
                  label="Grant template"
                  value={grantTemplateId}
                  options={[{ value: '', label: grantSubjectType === 'user' ? 'Role default' : 'No capabilities' }, ...templates.map((template) => ({ value: template.id, label: template.name }))]}
                  onChange={setGrantTemplateId}
                />
              </label>
              <Button size="sm">Apply grant</Button>
            </form>
          )}
        </Panel>
        <VaultActivityPanel activity={activity} />
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
    </>
  );
}

// Per-file revision history shown as a dropdown menu instead of a full panel.
function FileHistoryMenu({
  vaultId,
  file,
  canRestore,
  onRestored,
  onError,
}: {
  vaultId: string;
  file: HostedFileEntry;
  canRestore: boolean;
  onRestored: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<HostedFileRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      setRevisions(await serverApi.fileRevisions(vaultId, file.id));
    } catch (reason) {
      onError(String(reason));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function restore(revision: HostedFileRevision) {
    try {
      await serverApi.restoreFileRevision(vaultId, file.id, revision.id, file.currentRevision?.sequence ?? 0);
      setOpen(false);
      onRestored();
    } catch (reason) {
      onError(String(reason));
    }
  }

  return (
    <div ref={containerRef} className="history-menu">
      <Button
        aria-label={`History ${file.relativePath}`}
        aria-haspopup="menu"
        aria-expanded={open}
        variant="outline"
        size="sm"
        disabled={file.state !== 'active'}
        onClick={() => void toggle()}
      >
        <History size={15} />History<ChevronDown size={13} />
      </Button>
      {open && (
        <div className="history-menu-list" role="menu" aria-label={`Revision history for ${file.name}`}>
          {loading && <p className="subtle history-menu-empty">Loading revisions...</p>}
          {!loading && revisions.length === 0 && <p className="subtle history-menu-empty">No revisions recorded.</p>}
          {!loading && revisions.map((revision) => (
            <div className="history-menu-row" key={revision.id}>
              <div className="grow">
                <strong>Revision {revision.sequence}</strong>
                <small>{formatBytes(revision.sizeBytes)} · {revision.createdByDisplayName ?? 'System'} · {new Date(revision.createdAt).toLocaleString()}</small>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={revision.id === file.currentRevision?.id || !canRestore}
                onClick={() => void restore(revision)}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Vault activity condensed into a card with the three most recent events plus a
// collapsible submenu for the full log.
function VaultActivityPanel({ activity }: { activity: HostedVaultActivityEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const recent = activity.slice(0, 3);
  const rest = activity.slice(3);
  const renderRow = (event: HostedVaultActivityEvent) => (
    <div className="audit-row" key={event.id}>
      <span className="event-dot success" />
      <div className="grow">
        <strong>{event.eventType.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
        <small>{event.actorDisplayName ?? 'System'} · {new Date(event.createdAt).toLocaleString()}</small>
      </div>
      {event.targetType && <span className="request-chip">{event.targetType}</span>}
    </div>
  );
  return (
    <Panel title="Vault activity" icon={<Activity size={17} />}>
      {activity.length === 0 ? <p className="subtle">No recorded activity yet.</p> : (
        <>
          <Card className="activity-recent">
            <div className="activity-recent-head">
              <small>Most recent activity</small>
            </div>
            <div className="audit-list">{recent.map(renderRow)}</div>
          </Card>
          {rest.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="activity-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                <ChevronRight size={14} className={expanded ? 'rotate' : ''} />
                {expanded ? 'Hide earlier activity' : `Show ${rest.length} earlier event${rest.length === 1 ? '' : 's'}`}
              </Button>
              {expanded && <div className="audit-list activity-rest">{rest.map(renderRow)}</div>}
            </>
          )}
        </>
      )}
    </Panel>
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

// --- Permissions ---

type PermissionsTab = 'overview' | 'users' | 'groups' | 'templates';

function CapabilitySummary({ capabilities }: { capabilities: string[] }) {
  if (capabilities.length === 0) return <span className="subtle">No capabilities</span>;
  if (capabilities.length === ALL_CAPABILITIES.length) return <Badge variant="success">Full access</Badge>;
  return (
    <span className="capability-chips">
      {capabilities.map((token) => (
        <span className="request-chip" key={token} title={capabilityLabel(token)}>{token}</span>
      ))}
    </span>
  );
}

function TemplateEditorDialog({
  template,
  mode,
  onClose,
  onSaved,
}: {
  template: PermissionTemplate | null;
  mode: 'create' | 'edit' | 'clone';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(mode === 'clone' ? `${template?.name ?? ''} copy` : template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(template?.capabilities ?? []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(token: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      setError('A template name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const capabilities = ALL_CAPABILITIES.filter((token) => selected.has(token));
      const payload = { name: name.trim(), description: description.trim() || null, capabilities };
      if (mode === 'edit' && template) await serverApi.updateTemplate(template.id, payload);
      else await serverApi.createTemplate(payload);
      onSaved();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  const title = mode === 'edit' ? 'Edit template' : mode === 'clone' ? 'Clone template' : 'New template';
  return (
    <DialogShell title={title} description="Choose the capabilities this template grants." onClose={onClose}>
      <label className="field"><span>Name</span><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
      <label className="field"><span>Description</span><Input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="capability-editor">
        {CAPABILITY_GROUPS.map((group) => (
          <div className="capability-group" key={group.domain}>
            <strong>{group.domain}</strong>
            {group.capabilities.map((capability) => (
              <label className="check" key={capability.token}>
                <Checkbox checked={selected.has(capability.token)} onChange={() => toggle(capability.token)} aria-label={capability.token} />
                {capability.label}
              </label>
            ))}
          </div>
        ))}
      </div>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="ui-dialog-actions">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void save()}>{mode === 'edit' ? 'Save template' : 'Create template'}</Button>
      </div>
    </DialogShell>
  );
}

function PermissionsPage() {
  const [tab, setTab] = useState<PermissionsTab>('overview');
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [templates, setTemplates] = useState<PermissionTemplate[]>([]);
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [vaults, setVaults] = useState<HostedVaultSummary[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, UserGroupMember[]>>({});
  const [grantsByVault, setGrantsByVault] = useState<Record<string, VaultGrant[]>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ template: PermissionTemplate | null; mode: 'create' | 'edit' | 'clone' } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; label: string; action: () => Promise<unknown> } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextGroups, nextTemplates, nextUsers, nextVaults] = await Promise.all([
        serverApi.groups(),
        serverApi.templates(),
        serverApi.users(),
        serverApi.vaults(),
      ]);
      setGroups(nextGroups);
      setTemplates(nextTemplates);
      setUsers(nextUsers);
      setVaults(nextVaults);
      const memberEntries = await Promise.all(
        nextGroups.map(async (group) => [group.id, await serverApi.groupMembers(group.id).catch(() => [])] as const),
      );
      setGroupMembers(Object.fromEntries(memberEntries));
      const grantEntries = await Promise.all(
        nextVaults.map(async (vault) => [vault.id, await serverApi.vaultGrants(vault.id).catch(() => [])] as const),
      );
      setGrantsByVault(Object.fromEntries(grantEntries));
    } catch (reason) {
      setError(String(reason));
    }
  }, []);
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

  const tabs: Array<{ value: PermissionsTab; label: string }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'users', label: 'Users' },
    { value: 'groups', label: 'Groups' },
    { value: 'templates', label: 'Templates' },
  ];

  return (
    <>
      <PageHeader eyebrow="ACCESS CONTROL" title="Permissions" subtitle="Reusable templates, user groups, and per-vault grants." />
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="tab-bar" role="tablist" aria-label="Permissions sections">
        {tabs.map((entry) => (
          <Button
            key={entry.value}
            role="tab"
            aria-selected={tab === entry.value}
            variant="ghost"
            className={tab === entry.value ? 'active' : ''}
            onClick={() => setTab(entry.value)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {tab === 'overview' && (
        <PermissionsOverview
          groups={groups}
          users={users}
          groupMembers={groupMembers}
          grantsByVault={grantsByVault}
          vaults={vaults}
          search={search}
          onSearch={setSearch}
        />
      )}

      {tab === 'users' && (
        <PermissionsUsers
          users={users}
          groups={groups}
          templates={templates}
          vaults={vaults}
          groupMembers={groupMembers}
          grantsByVault={grantsByVault}
          onChange={() => void load()}
        />
      )}

      {tab === 'groups' && (
        <Panel title={`${groups.length} groups`} icon={<Users size={17} />}>
          <div className="panel-actions"><Button size="sm" onClick={() => setCreatingGroup(true)}><Plus size={15} /> New group</Button></div>
          {creatingGroup && (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const name = String(data.get('name') ?? '').trim();
                if (!name) return;
                setCreatingGroup(false);
                void run(() => serverApi.createGroup({ name, description: String(data.get('description') ?? '').trim() || null }));
              }}
            >
              <Field label="Name" name="name" required />
              <Field label="Description" name="description" />
              <Button size="sm">Create group</Button>
            </form>
          )}
          <div className="user-list">
            {groups.map((group) => (
              <div className="user-row" key={group.id}>
                <div className="grow"><strong>{group.name}</strong><small>{group.description || 'No description'} · {group.memberCount} members</small></div>
                <Button variant="outline" size="sm" onClick={() => setSelectedGroupId(selectedGroupId === group.id ? null : group.id)}>
                  {selectedGroupId === group.id ? 'Close' : 'Manage'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirm({
                    title: `Delete ${group.name}?`,
                    description: 'The group and all its vault grants are removed.',
                    label: 'Delete group',
                    action: () => serverApi.deleteGroup(group.id),
                  })}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
          {selectedGroupId && (() => {
            const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
            if (!selectedGroup) return null;
            return (
              <div className="subject-detail">
                <GroupMembersEditor
                  group={selectedGroup}
                  members={groupMembers[selectedGroupId] ?? []}
                  users={users}
                  onChange={() => void load()}
                />
                <Separator />
                <SubjectVaultGrants
                  subjectType="group"
                  subjectId={selectedGroup.id}
                  subjectName={selectedGroup.name}
                  vaults={vaults}
                  templates={templates}
                  grantsByVault={grantsByVault}
                  onChange={() => void load()}
                />
              </div>
            );
          })()}
        </Panel>
      )}

      {tab === 'templates' && (
        <Panel title={`${templates.length} templates`} icon={<ShieldCheck size={17} />}>
          <div className="panel-actions"><Button size="sm" onClick={() => setEditor({ template: null, mode: 'create' })}><Plus size={15} /> New template</Button></div>
          <div className="user-list">
            {templates.map((template) => (
              <div className="user-row" key={template.id}>
                <div className="grow">
                  <strong>{template.name} {template.isBuiltin && <Badge variant="outline">built-in</Badge>}</strong>
                  <small>{template.description || 'No description'}</small>
                  <div className="capability-summary-row"><CapabilitySummary capabilities={template.capabilities} /></div>
                </div>
                {template.isBuiltin ? (
                  <Button variant="outline" size="sm" onClick={() => setEditor({ template, mode: 'clone' })}>Clone</Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setEditor({ template, mode: 'edit' })}>Edit</Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirm({
                        title: `Delete ${template.name}?`,
                        description: 'Grants that reference this template revert to their default capabilities.',
                        label: 'Delete template',
                        action: () => serverApi.deleteTemplate(template.id),
                      })}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {editor && (
        <TemplateEditorDialog
          template={editor.template}
          mode={editor.mode}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
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
    </>
  );
}

function GroupMembersEditor({
  group,
  members,
  users,
  onChange,
}: {
  group: UserGroup | null;
  members: UserGroupMember[];
  users: ServerUser[];
  onChange: () => void;
}) {
  const [choice, setChoice] = useState('');
  const [error, setError] = useState('');
  if (!group) return null;
  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = users.filter((user) => user.status === 'active' && !memberIds.has(user.id));
  const selected = candidates.some((user) => user.id === choice) ? choice : candidates[0]?.id ?? '';

  async function mutate(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      onChange();
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <div className="group-members">
      <Separator />
      <strong>Members of {group.name}</strong>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="user-list">
        {members.length === 0 && <p className="subtle">No members yet.</p>}
        {members.map((member) => (
          <div className="user-row" key={member.userId}>
            <div className="avatar">{member.displayName.slice(0, 2).toUpperCase()}</div>
            <div className="grow"><strong>{member.displayName}</strong><small>{member.username}</small></div>
            <Button variant="destructive" size="sm" onClick={() => void mutate(() => serverApi.removeGroupMember(group.id, member.userId))}>Remove</Button>
          </div>
        ))}
      </div>
      {candidates.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) void mutate(() => serverApi.addGroupMember(group.id, selected));
          }}
        >
          <label className="field"><span>Add user</span>
            <SelectMenu
              label="Add group member"
              value={selected}
              options={candidates.map((user) => ({ value: user.id, label: `${user.displayName} (${user.username})` }))}
              onChange={setChoice}
            />
          </label>
          <Button size="sm">Add member</Button>
        </form>
      )}
    </div>
  );
}

function PermissionsOverview({
  groups,
  users,
  groupMembers,
  grantsByVault,
  vaults,
  search,
  onSearch,
}: {
  groups: UserGroup[];
  users: ServerUser[];
  groupMembers: Record<string, UserGroupMember[]>;
  grantsByVault: Record<string, VaultGrant[]>;
  vaults: HostedVaultSummary[];
  search: string;
  onSearch: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();
  const vaultName = (id: string) => vaults.find((vault) => vault.id === id)?.name ?? id;

  // Aggregate grants by subject across every vault.
  const grantsForSubject = (type: GrantSubjectType, subjectId: string) =>
    Object.entries(grantsByVault).flatMap(([vaultId, grants]) =>
      grants.filter((grant) => grant.subjectType === type && grant.subjectId === subjectId).map((grant) => ({ vaultId, grant })),
    );
  const groupsForUser = (userId: string) =>
    groups.filter((group) => (groupMembers[group.id] ?? []).some((member) => member.userId === userId));

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const visibleGroups = groups.filter((group) => !query || group.name.toLowerCase().includes(query));
  const visibleUsers = users.filter(
    (user) => !query || user.displayName.toLowerCase().includes(query) || user.username.toLowerCase().includes(query),
  );

  function TreeNode({ id, label, sub, children }: { id: string; label: React.ReactNode; sub?: string; children?: React.ReactNode }) {
    const isOpen = expanded.has(id);
    return (
      <div className="tree-node">
        <button type="button" className="tree-row" aria-expanded={isOpen} onClick={() => toggle(id)}>
          {children ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="tree-spacer" />}
          <span className="grow"><strong>{label}</strong>{sub && <small> {sub}</small>}</span>
        </button>
        {isOpen && children && <div className="tree-children">{children}</div>}
      </div>
    );
  }

  return (
    <Panel title="Access overview" icon={<Search size={17} />}>
      <Input placeholder="Search users, groups, and vaults…" value={search} onChange={(event) => onSearch(event.target.value)} aria-label="Search permissions" />
      <div className="permission-tree">
        <div className="tree-section">
          <p className="eyebrow">Groups</p>
          {visibleGroups.length === 0 && <p className="subtle">No matching groups.</p>}
          {visibleGroups.map((group) => {
            const members = groupMembers[group.id] ?? [];
            const grants = grantsForSubject('group', group.id);
            return (
              <TreeNode key={group.id} id={`group:${group.id}`} label={group.name} sub={`· ${members.length} members · ${grants.length} vault grants`}>
                <TreeNode id={`group:${group.id}:members`} label="Members" sub={`(${members.length})`}>
                  {members.map((member) => <div className="tree-leaf" key={member.userId}>{member.displayName} <small>{member.username}</small></div>)}
                  {members.length === 0 && <div className="tree-leaf subtle">None</div>}
                </TreeNode>
                <TreeNode id={`group:${group.id}:grants`} label="Vault grants" sub={`(${grants.length})`}>
                  {grants.map(({ vaultId, grant }) => (
                    <div className="tree-leaf" key={vaultId}>{vaultName(vaultId)} <small>{grant.templateName ?? `${grant.capabilities.length} capabilities`}</small></div>
                  ))}
                  {grants.length === 0 && <div className="tree-leaf subtle">None</div>}
                </TreeNode>
              </TreeNode>
            );
          })}
        </div>
        <div className="tree-section">
          <p className="eyebrow">Users</p>
          {visibleUsers.length === 0 && <p className="subtle">No matching users.</p>}
          {visibleUsers.map((user) => {
            const userGroups = groupsForUser(user.id);
            const grants = grantsForSubject('user', user.id);
            return (
              <TreeNode key={user.id} id={`user:${user.id}`} label={user.displayName} sub={`· ${user.username}`}>
                <TreeNode id={`user:${user.id}:groups`} label="Group memberships" sub={`(${userGroups.length})`}>
                  {userGroups.map((group) => <div className="tree-leaf" key={group.id}>{group.name}</div>)}
                  {userGroups.length === 0 && <div className="tree-leaf subtle">None</div>}
                </TreeNode>
                <TreeNode id={`user:${user.id}:grants`} label="Direct vault grants" sub={`(${grants.length})`}>
                  {grants.map(({ vaultId, grant }) => (
                    <div className="tree-leaf" key={vaultId}>{vaultName(vaultId)} <small>{grant.templateName ?? `${grant.capabilities.length} capabilities`}</small></div>
                  ))}
                  {grants.length === 0 && <div className="tree-leaf subtle">None</div>}
                </TreeNode>
              </TreeNode>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function GrantEditorDialog({
  vaultId,
  subjectType,
  subjectId,
  subjectName,
  vaultName,
  current,
  templates,
  onClose,
  onSaved,
}: {
  vaultId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
  subjectName: string;
  vaultName: string;
  current: VaultGrant | null;
  templates: PermissionTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<'template' | 'custom'>(current?.templateId ? 'template' : 'custom');
  const [templateId, setTemplateId] = useState(current?.templateId ?? templates[0]?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(current?.capabilities ?? []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(token: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload = mode === 'template'
        ? { templateId }
        : { capabilities: ALL_CAPABILITIES.filter((token) => selected.has(token)) };
      await serverApi.putVaultGrant(vaultId, subjectType, subjectId, payload);
      onSaved();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  return (
    <DialogShell title={`Access for ${subjectName}`} description={`Vault: ${vaultName}`} onClose={onClose}>
      <div className="settings-row">
        <span>Source</span>
        <SelectMenu
          label="Grant source"
          value={mode}
          options={[{ value: 'template', label: 'Template' }, { value: 'custom', label: 'Custom capabilities' }]}
          onChange={(value) => setMode(value as 'template' | 'custom')}
        />
      </div>
      {mode === 'template' ? (
        <div className="settings-row">
          <span>Template</span>
          <SelectMenu label="Template" value={templateId} options={templates.map((template) => ({ value: template.id, label: template.name }))} onChange={setTemplateId} />
        </div>
      ) : (
        <div className="capability-editor">
          {CAPABILITY_GROUPS.map((group) => (
            <div className="capability-group" key={group.domain}>
              <strong>{group.domain}</strong>
              {group.capabilities.map((capability) => (
                <label className="check" key={capability.token}>
                  <Checkbox checked={selected.has(capability.token)} onChange={() => toggle(capability.token)} aria-label={capability.token} />
                  {capability.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="ui-dialog-actions">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void save()}>Apply</Button>
      </div>
    </DialogShell>
  );
}

/**
 * Lists and edits a subject's (user or group) vault grants. Groups can be
 * granted on any vault; user grants override an existing membership, so new user
 * grants are added from the vault's own Access section.
 */
function SubjectVaultGrants({
  subjectType,
  subjectId,
  subjectName,
  vaults,
  templates,
  grantsByVault,
  onChange,
}: {
  subjectType: GrantSubjectType;
  subjectId: string;
  subjectName: string;
  vaults: HostedVaultSummary[];
  templates: PermissionTemplate[];
  grantsByVault: Record<string, VaultGrant[]>;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<{ vaultId: string; vaultName: string; current: VaultGrant | null } | null>(null);
  const [addVaultId, setAddVaultId] = useState('');
  const [error, setError] = useState('');

  const vaultName = (id: string) => vaults.find((vault) => vault.id === id)?.name ?? id;
  const grants = Object.entries(grantsByVault).flatMap(([vaultId, vaultGrants]) =>
    vaultGrants
      .filter((grant) => grant.subjectType === subjectType && grant.subjectId === subjectId)
      .map((grant) => ({ vaultId, grant })));
  const grantedIds = new Set(grants.map((entry) => entry.vaultId));
  const addableVaults = vaults.filter((vault) => !grantedIds.has(vault.id));
  const addVault = addableVaults.some((vault) => vault.id === addVaultId) ? addVaultId : addableVaults[0]?.id ?? '';

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      onChange();
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <>
      <strong>Vault grants</strong>
      {subjectType === 'user'
        ? <p className="subtle">Override a member's capabilities per vault. Add a user to a vault from the vault's Access section first.</p>
        : <p className="subtle">Grant this group access to vaults through a template or specific capabilities.</p>}
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="user-list">
        {grants.length === 0 && <p className="subtle">No vault grants.</p>}
        {grants.map(({ vaultId, grant }) => (
          <div className="user-row access-grant-row" key={vaultId}>
            <div className="grow"><strong>{vaultName(vaultId)}</strong><small>{grant.templateName ?? `${grant.capabilities.length} capabilities`}</small></div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ vaultId, vaultName: vaultName(vaultId), current: grant })}>Edit access</Button>
            <Button variant="destructive" size="sm" onClick={() => void run(() => serverApi.deleteVaultGrant(vaultId, subjectType, subjectId))}>{subjectType === 'group' ? 'Remove' : 'Reset'}</Button>
          </div>
        ))}
      </div>
      {subjectType === 'group' && addableVaults.length > 0 && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (addVault) setEditing({ vaultId: addVault, vaultName: vaultName(addVault), current: null });
          }}
        >
          <label className="field"><span>Grant on vault</span>
            <SelectMenu label="Grant group on vault" value={addVault} options={addableVaults.map((vault) => ({ value: vault.id, label: vault.name }))} onChange={setAddVaultId} />
          </label>
          <Button size="sm">Configure</Button>
        </form>
      )}
      {editing && (
        <GrantEditorDialog
          vaultId={editing.vaultId}
          vaultName={editing.vaultName}
          subjectType={subjectType}
          subjectId={subjectId}
          subjectName={subjectName}
          current={editing.current}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }}
        />
      )}
    </>
  );
}

function PermissionsUsers({
  users,
  groups,
  templates,
  vaults,
  groupMembers,
  grantsByVault,
  onChange,
}: {
  users: ServerUser[];
  groups: UserGroup[];
  templates: PermissionTemplate[];
  vaults: HostedVaultSummary[];
  groupMembers: Record<string, UserGroupMember[]>;
  grantsByVault: Record<string, VaultGrant[]>;
  onChange: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addGroupId, setAddGroupId] = useState('');
  const [error, setError] = useState('');

  const query = search.trim().toLowerCase();
  const visible = users.filter((user) => !query || user.displayName.toLowerCase().includes(query) || user.username.toLowerCase().includes(query));
  const selected = users.find((user) => user.id === selectedId) ?? null;

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      onChange();
    } catch (reason) {
      setError(String(reason));
    }
  }

  const memberGroups = selected ? groups.filter((group) => (groupMembers[group.id] ?? []).some((member) => member.userId === selected.id)) : [];
  const joinableGroups = selected ? groups.filter((group) => !memberGroups.some((joined) => joined.id === group.id)) : [];
  const joinGroupId = joinableGroups.some((group) => group.id === addGroupId) ? addGroupId : joinableGroups[0]?.id ?? '';

  return (
    <Panel title="User access" icon={<Users size={17} />}>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <Input placeholder="Search users…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search users" />
      <div className="permission-user-layout">
        <div className="user-list user-picker">
          {visible.map((user) => (
            <button type="button" key={user.id} className={`user-row user-pick${selectedId === user.id ? ' active' : ''}`} onClick={() => setSelectedId(user.id)}>
              <Avatar user={user} size={28} />
              <div className="grow"><strong>{user.displayName}</strong><small>{user.username}</small></div>
            </button>
          ))}
          {visible.length === 0 && <p className="subtle">No matching users.</p>}
        </div>
        <div className="user-detail">
          {!selected ? <p className="subtle">Select a user to manage their groups and vault access.</p> : (
            <>
              <div className="account-identity"><Avatar user={selected} size={40} /><div><strong>{selected.displayName}</strong><small>{selected.username} · {selected.role}</small></div></div>

              <Separator />
              <strong>Group memberships</strong>
              <div className="capability-chips">
                {memberGroups.length === 0 && <span className="subtle">No groups</span>}
                {memberGroups.map((group) => (
                  <span className="request-chip removable" key={group.id}>
                    {group.name}
                    <button type="button" aria-label={`Remove from ${group.name}`} onClick={() => void run(() => serverApi.removeGroupMember(group.id, selected.id))}>×</button>
                  </span>
                ))}
              </div>
              {joinableGroups.length > 0 && (
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (joinGroupId) void run(() => serverApi.addGroupMember(joinGroupId, selected.id)); }}>
                  <label className="field"><span>Add to group</span>
                    <SelectMenu label="Add user to group" value={joinGroupId} options={joinableGroups.map((group) => ({ value: group.id, label: group.name }))} onChange={setAddGroupId} />
                  </label>
                  <Button size="sm">Add</Button>
                </form>
              )}

              <Separator />
              <SubjectVaultGrants
                subjectType="user"
                subjectId={selected.id}
                subjectName={selected.displayName}
                vaults={vaults}
                templates={templates}
                grantsByVault={grantsByVault}
                onChange={onChange}
              />
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

// --- User profile & account ---

function Avatar({ user, size = 36 }: { user: Pick<ServerUser, 'id' | 'displayName' | 'hasAvatar' | 'avatarUpdatedAt'>; size?: number }) {
  const dimension = { width: size, height: size, minWidth: size };
  if (user.hasAvatar) {
    return <img className="avatar avatar-img" style={dimension} width={size} height={size} alt="" src={serverApi.avatarUrl(user.id, user.avatarUpdatedAt)} />;
  }
  return <div className="avatar" style={dimension}>{user.displayName.slice(0, 2).toUpperCase()}</div>;
}

/** Read-only view of a user's group memberships and direct vault grants. */
function UserAssignments({ userId }: { userId: string }) {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [grants, setGrants] = useState<Array<{ vaultName: string; grant: VaultGrant }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [allGroups, allVaults] = await Promise.all([serverApi.groups(), serverApi.vaults()]);
        const memberLists = await Promise.all(
          allGroups.map(async (group) => [group, await serverApi.groupMembers(group.id).catch(() => [])] as const),
        );
        const grantLists = await Promise.all(
          allVaults.map(async (vault) => [vault, await serverApi.vaultGrants(vault.id).catch(() => [])] as const),
        );
        if (cancelled) return;
        setGroups(memberLists.filter(([, members]) => members.some((member) => member.userId === userId)).map(([group]) => group));
        setGrants(grantLists.flatMap(([vault, vaultGrants]) =>
          vaultGrants
            .filter((grant) => grant.subjectType === 'user' && grant.subjectId === userId)
            .map((grant) => ({ vaultName: vault.name, grant })),
        ));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  if (loading) return <p className="subtle">Loading assignments…</p>;
  return (
    <div className="assignments">
      <div>
        <strong>Group memberships</strong>
        {groups.length === 0 ? <p className="subtle">None</p> : <div className="capability-chips">{groups.map((group) => <span className="request-chip" key={group.id}>{group.name}</span>)}</div>}
      </div>
      <div>
        <strong>Vault grants</strong>
        {grants.length === 0 ? <p className="subtle">None</p> : (
          <div className="user-list">
            {grants.map(({ vaultName, grant }) => (
              <div className="user-row" key={`${vaultName}:${grant.subjectId}`}>
                <div className="grow"><strong>{vaultName}</strong><small>{grant.templateName ?? `${grant.capabilities.length} capabilities`}</small></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditUserDialog({ user, onClose, onSaved }: { user: ServerUser; onClose: () => void; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {};
      if (displayName.trim() && displayName.trim() !== user.displayName) payload.displayName = displayName.trim();
      if (username.trim() && username.trim() !== user.username) payload.username = username.trim();
      if (Object.keys(payload).length > 0) await serverApi.updateUser(user.id, payload);
      onSaved();
    } catch (reason) {
      setError(String(reason));
      setBusy(false);
    }
  }

  return (
    <DialogShell title={`Edit ${user.username}`} description="Update the account's profile and review its assignments." onClose={onClose}>
      <label className="field"><span>Display name</span><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoFocus /></label>
      <label className="field"><span>Username</span><Input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      <Separator />
      <UserAssignments userId={user.id} />
      <div className="ui-dialog-actions">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button disabled={busy} onClick={() => void save()}>Save changes</Button>
      </div>
    </DialogShell>
  );
}

function AccountDialog({
  me,
  appearance,
  onAppearanceChange,
  onClose,
  onUpdated,
}: {
  me: ServerUser;
  appearance: ReturnType<typeof useAdminAppearance>['appearance'];
  onAppearanceChange: ReturnType<typeof useAdminAppearance>['setAppearance'];
  onClose: () => void;
  onUpdated: (user: ServerUser) => void;
}) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const accents: AdminAccent[] = ['violet', 'blue', 'emerald', 'rose', 'orange', 'cyan'];

  async function run(action: () => Promise<ServerUser | void>, message: string) {
    setError('');
    setStatus('');
    try {
      const result = await action();
      if (result) onUpdated(result);
      setStatus(message);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function saveProfile() {
    const payload: Record<string, unknown> = {};
    if (displayName.trim() && displayName.trim() !== me.displayName) payload.displayName = displayName.trim();
    if (username.trim() && username.trim() !== me.username) payload.username = username.trim();
    if (Object.keys(payload).length === 0) { setStatus('No changes to save.'); return; }
    await run(() => serverApi.updateSelf(payload), 'Profile updated.');
  }

  async function onAvatarSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('Avatars must be 1 MB or smaller.'); return; }
    const base64 = await fileToBase64(file);
    await run(() => serverApi.uploadOwnAvatar(file.type, base64), 'Avatar updated.');
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setStatus('');
    try {
      await serverApi.changeOwnPassword(String(form.get('current') ?? ''), String(form.get('next') ?? ''));
      (event.currentTarget as HTMLFormElement).reset();
      setStatus('Password changed.');
    } catch (reason) {
      setError(String(reason));
    }
  }

  return (
    <DialogShell title="Your account" description="Manage your profile, avatar, password, and appearance." onClose={onClose}>
      {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}</div>}
      {status && <p className="subtle" role="status">{status}</p>}

      <div className="account-identity">
        <Avatar user={me} size={56} />
        <div className="account-avatar-actions">
          <Button variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()}>Upload avatar</Button>
          {me.hasAvatar && <Button variant="outline" size="sm" onClick={() => void run(() => serverApi.deleteOwnAvatar(), 'Avatar removed.')}>Remove</Button>}
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onAvatarSelected} />
        </div>
      </div>

      <label className="field"><span>Display name</span><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="field"><span>Username</span><Input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <div className="ui-dialog-actions"><Button size="sm" onClick={() => void saveProfile()}>Save profile</Button></div>

      <Separator />
      <strong>Appearance</strong>
      <div className="settings-row">
        <span>Theme</span>
        <SelectMenu
          label="Theme"
          value={appearance.theme}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'midnight', label: 'Midnight' }, { value: 'warm', label: 'Warm' }, { value: 'light', label: 'Light' }]}
          onChange={(value) => onAppearanceChange((current) => ({ ...current, theme: value as AdminTheme }))}
        />
      </div>
      <div className="settings-row">
        <span>Accent</span>
        <div className="accent-picker">
          {accents.map((accent) => (
            <button key={accent} type="button" className={`accent-dot accent-${accent}${appearance.accent === accent ? ' active' : ''}`} aria-label={accent} onClick={() => onAppearanceChange((current) => ({ ...current, accent }))} />
          ))}
        </div>
      </div>
      <label className="check"><Switch label="Compact density" checked={appearance.compact} onCheckedChange={(checked) => onAppearanceChange((current) => ({ ...current, compact: checked }))} /> Compact density</label>

      <Separator />
      <strong>Change password</strong>
      <form className="account-password" onSubmit={changePassword}>
        <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
        <Field label="New password" name="next" type="password" autoComplete="new-password" minLength={12} required />
        <Button size="sm">Change password</Button>
      </form>

      <div className="ui-dialog-actions"><Button variant="outline" onClick={onClose}>Close</Button></div>
    </DialogShell>
  );
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
