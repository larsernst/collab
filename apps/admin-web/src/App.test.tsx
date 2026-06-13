import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, fileToBase64, isSelectedFile } from './App';
import { serverApi } from './api';

vi.mock('./api', () => ({
  serverApi: {
    bootstrapStatus: vi.fn(),
    bootstrap: vi.fn(),
    login: vi.fn(),
    acceptInvitation: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    updateSelf: vi.fn(),
    changeOwnPassword: vi.fn(),
    uploadOwnAvatar: vi.fn(),
    deleteOwnAvatar: vi.fn(),
    avatarUrl: vi.fn((id: string) => `/api/v1/users/${id}/avatar`),
    overview: vi.fn(),
    users: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    revokeSessions: vi.fn(),
    resetPassword: vi.fn(),
    userActivity: vi.fn(),
    invitations: vi.fn(),
    createInvitation: vi.fn(),
    vaults: vi.fn(),
    createVault: vi.fn(),
    vaultDetail: vi.fn(),
    updateVault: vi.fn(),
    deleteVault: vi.fn(),
    vaultMembers: vi.fn(),
    addVaultMember: vi.fn(),
    updateVaultMember: vi.fn(),
    removeVaultMember: vi.fn(),
    vaultActivity: vi.fn(),
    vaultStorage: vi.fn(),
    vaultFiles: vi.fn(),
    fileRevisions: vi.fn(),
    downloadFile: vi.fn(),
    downloadFolder: vi.fn(),
    moveFile: vi.fn(),
    restoreFileRevision: vi.fn(),
    importVault: vi.fn(),
    exportVault: vi.fn(),
    auditEvents: vi.fn(),
    templates: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    groups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    groupMembers: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    vaultGrants: vi.fn(),
    putVaultGrant: vi.fn(),
    deleteVaultGrant: vi.fn(),
  },
}));

const admin = {
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin User',
  role: 'admin' as const,
  status: 'active' as const,
  createdAt: '2026-06-09T00:00:00Z',
  lastLoginAt: null,
  activeSessions: 1,
  isPrimaryAdmin: true,
};

const disabledMember = {
  ...admin,
  id: 'member-1',
  username: 'member',
  displayName: 'Member User',
  role: 'member' as const,
  status: 'disabled' as const,
  activeSessions: 0,
  isPrimaryAdmin: false,
};

const storedValues = new Map<string, string>();
const localStorageMock = {
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
  key: (index: number) => [...storedValues.keys()][index] ?? null,
  get length() { return storedValues.size; },
};

describe('admin application', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock);
    localStorage.clear();
    vi.mocked(serverApi.overview).mockResolvedValue({
      health: 'ok',
      serverVersion: '0.4.3',
      protocolVersion: 1,
      uptimeSeconds: 10,
      users: 1,
      activeUsers: 1,
      activeSessions: 1,
      pendingInvitations: 0,
      hostedVaults: 0,
      storage: { databaseBytes: 1024, blobBytes: 0 },
      operationalWarnings: [],
      recentAuditEvents: [],
    });
    vi.mocked(serverApi.invitations).mockResolvedValue([]);
    vi.mocked(serverApi.vaults).mockResolvedValue([]);
    vi.mocked(serverApi.vaultStorage).mockResolvedValue({
      activeBytes: 0,
      trashBytes: 0,
      retainedRevisionBytes: 0,
      uniqueBlobBytes: 0,
      activeFiles: 0,
      trashedFiles: 0,
      revisionCount: 0,
      snapshotCount: 0,
    });
    vi.mocked(serverApi.vaultFiles).mockResolvedValue({ vaultId: 'vault-1', sequence: 0, files: [] });
    vi.mocked(serverApi.fileRevisions).mockResolvedValue([]);
    vi.mocked(serverApi.templates).mockResolvedValue([]);
    vi.mocked(serverApi.groups).mockResolvedValue([]);
    vi.mocked(serverApi.groupMembers).mockResolvedValue([]);
    vi.mocked(serverApi.vaultGrants).mockResolvedValue([]);
    vi.mocked(serverApi.updateSelf).mockResolvedValue(admin);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the one-time bootstrap screen when no administrator exists', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: true });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Create the first administrator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create administrator' })).toBeTruthy();
  });

  it('completes the browser bootstrap flow into the administration dashboard', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: true });
    vi.mocked(serverApi.bootstrap).mockResolvedValue({ user: admin, csrfToken: 'csrf' });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Admin User' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create administrator' }));
    expect(await screen.findByRole('heading', { name: 'Server dashboard' })).toBeTruthy();
    expect(serverApi.bootstrap).toHaveBeenCalled();
  });

  it('shows the dashboard for an authenticated administrator', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Server dashboard' })).toBeTruthy();
    await waitFor(() => expect(serverApi.overview).toHaveBeenCalled());
    expect(screen.getByText('Active users')).toBeTruthy();
    expect(screen.getByText('v0.4.3')).toBeTruthy();
  });

  it('does not render administration pages for a non-admin user', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue({ ...admin, role: 'member' });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Server dashboard' })).toBeNull();
  });

  it('exposes labelled navigation and keyboard-focusable administration controls', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Administration' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh dashboard' })).toBeTruthy();
    expect(screen.getByTitle('Sign out')).toBeTruthy();
  });

  it('shows canonical hosted-vault status in the administration inventory', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1',
      name: 'Archived Vault',
      ownerDisplayName: 'Admin User',
      status: 'archived',
      members: 2,
      storageBytes: 1024,
      updatedAt: '2026-06-10T00:00:00Z',
    }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    expect(await screen.findByText('Archived Vault')).toBeTruthy();
    expect(screen.getByText('archived')).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();
  });

  it('manages hosted-vault members and lifecycle from the vault detail view', async () => {
    const activeMember = { ...disabledMember, status: 'active' as const };
    const vaultSummary = {
      id: 'vault-1',
      name: 'Team Vault',
      ownerDisplayName: 'Admin User',
      status: 'active' as const,
      members: 2,
      storageBytes: 2048,
      updatedAt: '2026-06-10T00:00:00Z',
    };
    const vaultDetail = {
      id: 'vault-1',
      name: 'Team Vault',
      ownerUserId: 'admin-1',
      ownerUsername: 'admin',
      ownerDisplayName: 'Admin User',
      status: 'active' as const,
      manifestSequence: 13,
      members: 2,
      activeFiles: 4,
      trashedFiles: 1,
      storageBytes: 2048,
      createdAt: '2026-06-09T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
    };
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin, activeMember]);
    vi.mocked(serverApi.vaults).mockResolvedValue([vaultSummary]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue(vaultDetail);
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
      { userId: 'member-1', username: 'member', displayName: 'Member User', role: 'editor', owner: false, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([
      { id: 'event-1', actorDisplayName: 'Admin User', eventType: 'vault.created', targetType: 'vault', targetId: 'vault-1', createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.updateVaultMember).mockResolvedValue({
      userId: 'member-1', username: 'member', displayName: 'Member User', role: 'viewer', owner: false, createdAt: '2026-06-09T00:00:00Z',
    });
    vi.mocked(serverApi.updateVault).mockResolvedValue({ ...vaultDetail, status: 'archived' });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));

    expect(await screen.findByRole('heading', { name: 'Team Vault' })).toBeTruthy();
    expect(screen.getByText('Vault storage')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByText('1 in trash')).toBeTruthy();
    expect(await screen.findByText('vault created')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Role for member' }));
    fireEvent.click(screen.getByRole('option', { name: 'viewer' }));
    await waitFor(() =>
      expect(serverApi.updateVaultMember).toHaveBeenCalledWith('vault-1', 'member-1', { role: 'viewer' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive vault' }));
    await waitFor(() => expect(serverApi.updateVault).toHaveBeenCalledWith('vault-1', { status: 'archived' }));
  });

  it('creates and renames hosted vaults from the web interface', async () => {
    const vaultSummary = {
      id: 'vault-1',
      name: 'Team Vault',
      ownerDisplayName: 'Admin User',
      status: 'active' as const,
      members: 1,
      storageBytes: 0,
      updatedAt: '2026-06-10T00:00:00Z',
    };
    const vaultDetail = {
      id: 'vault-1',
      name: 'Team Vault',
      ownerUserId: 'admin-1',
      ownerUsername: 'admin',
      ownerDisplayName: 'Admin User',
      status: 'active' as const,
      manifestSequence: 0,
      members: 1,
      activeFiles: 0,
      trashedFiles: 0,
      storageBytes: 0,
      createdAt: '2026-06-09T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
    };
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([vaultSummary]);
    vi.mocked(serverApi.createVault).mockResolvedValue({ id: 'vault-2' });
    vi.mocked(serverApi.vaultDetail).mockResolvedValue(vaultDetail);
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);
    vi.mocked(serverApi.updateVault).mockResolvedValue({ ...vaultDetail, name: 'Renamed Vault' });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: /New vault/ }));
    fireEvent.change(await screen.findByLabelText('Vault name'), { target: { value: 'Fresh Vault' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create vault' }));
    await waitFor(() => expect(serverApi.createVault).toHaveBeenCalledWith({ name: 'Fresh Vault' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const renameDialog = await screen.findByRole('dialog', { name: 'Rename vault' });
    fireEvent.change(within(renameDialog).getByLabelText('Vault name'), { target: { value: 'Renamed Vault' } });
    fireEvent.click(within(renameDialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(serverApi.updateVault).toHaveBeenCalledWith('vault-1', { name: 'Renamed Vault' }));
  });

  it('shows storage accounting and exports hosted vaults from the web interface', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:export'),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active',
      members: 1, storageBytes: 4096, updatedAt: '2026-06-10T00:00:00Z',
    }]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue({
      id: 'vault-1', name: 'Team Vault', ownerUserId: 'admin-1', ownerUsername: 'admin',
      ownerDisplayName: 'Admin User', status: 'active', manifestSequence: 2, members: 1,
      activeFiles: 1, trashedFiles: 0, storageBytes: 4096,
      createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
    });
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);
    vi.mocked(serverApi.vaultStorage).mockResolvedValue({
      activeBytes: 1024, trashBytes: 0, retainedRevisionBytes: 4096, uniqueBlobBytes: 2048,
      activeFiles: 1, trashedFiles: 0, revisionCount: 4, snapshotCount: 1,
    });
    vi.mocked(serverApi.exportVault).mockResolvedValue(new Blob(['zip']));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));

    expect(await screen.findByText('Storage and transfer')).toBeTruthy();
    expect(screen.getByText('Retained history')).toBeTruthy();
    expect(screen.getByText('4 revisions · 1 snapshots')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }));
    await waitFor(() => expect(serverApi.exportVault).toHaveBeenCalledWith('vault-1'));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('shows the three most recent activity events with a collapsible submenu for the rest', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active',
      members: 1, storageBytes: 0, updatedAt: '2026-06-10T00:00:00Z',
    }]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue({
      id: 'vault-1', name: 'Team Vault', ownerUserId: 'admin-1', ownerUsername: 'admin',
      ownerDisplayName: 'Admin User', status: 'active', manifestSequence: 5, members: 1,
      activeFiles: 0, trashedFiles: 0, storageBytes: 0,
      createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
    });
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([
      { id: 'e1', actorDisplayName: 'Admin User', eventType: 'file.created', targetType: 'file', targetId: 'f1', createdAt: '2026-06-10T05:00:00Z' },
      { id: 'e2', actorDisplayName: 'Admin User', eventType: 'file.moved', targetType: 'file', targetId: 'f2', createdAt: '2026-06-10T04:00:00Z' },
      { id: 'e3', actorDisplayName: 'Admin User', eventType: 'member.added', targetType: 'member', targetId: 'm1', createdAt: '2026-06-10T03:00:00Z' },
      { id: 'e4', actorDisplayName: 'Admin User', eventType: 'vault.created', targetType: 'vault', targetId: 'vault-1', createdAt: '2026-06-09T00:00:00Z' },
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));

    expect(await screen.findByText('Most recent activity')).toBeTruthy();
    expect(screen.getByText('file created')).toBeTruthy();
    // The fourth (oldest) event is hidden until the submenu is expanded.
    expect(screen.queryByText('vault created')).toBeNull();

    const toggle = screen.getByRole('button', { name: 'Show 1 earlier event' });
    fireEvent.click(toggle);
    expect(await screen.findByText('vault created')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide earlier activity' }));
    await waitFor(() => expect(screen.queryByText('vault created')).toBeNull());
  });

  it('imports a ZIP into an empty vault directly from the file dialog selection', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active',
      members: 1, storageBytes: 0, updatedAt: '2026-06-10T00:00:00Z',
    }]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue({
      id: 'vault-1', name: 'Team Vault', ownerUserId: 'admin-1', ownerUsername: 'admin',
      ownerDisplayName: 'Admin User', status: 'active', manifestSequence: 0, members: 1,
      activeFiles: 0, trashedFiles: 0, storageBytes: 0,
      createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
    });
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);
    vi.mocked(serverApi.importVault).mockResolvedValue({
      importedFiles: 1, importedFolders: 0, importedBytes: 2, resultManifestSequence: 1,
    });

    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));

    const importButton = await screen.findByRole('button', { name: /Import ZIP into empty vault/ });
    expect(importButton).toBeTruthy();

    const archive = new window.File([new Uint8Array([80, 75])], 'vault.zip', { type: 'application/zip' });
    Object.defineProperty(archive, 'arrayBuffer', {
      value: () => Promise.resolve(new Uint8Array([80, 75]).buffer),
    });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [archive] } });

    await waitFor(() => expect(serverApi.importVault).toHaveBeenCalledWith('vault-1', 'UEs='));
  });

  it('validates and encodes selected ZIP browser files', async () => {
    const archive = new window.File([new Uint8Array([80, 75])], 'vault.zip', { type: 'application/zip' });
    Object.defineProperty(archive, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new Uint8Array([80, 75]).buffer),
    });

    expect(isSelectedFile(archive)).toBe(true);
    expect(await fileToBase64(archive)).toBe('UEs=');
  });

  it('browses, moves, downloads, and restores hosted vault files', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'operation-1' });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:file'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Other Owner', status: 'active',
      members: 1, storageBytes: 12, updatedAt: '2026-06-10T00:00:00Z',
    }]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue({
      id: 'vault-1', name: 'Team Vault', ownerUserId: 'owner-1', ownerUsername: 'owner',
      ownerDisplayName: 'Other Owner', status: 'active', manifestSequence: 4, members: 1,
      activeFiles: 2, trashedFiles: 0, storageBytes: 12,
      createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
    });
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);
    const currentRevision = { id: 'revision-2', sequence: 2, contentHash: 'hash-2', sizeBytes: 12, createdByDisplayName: 'Owner', createdAt: '2026-06-10T00:00:00Z' };
    vi.mocked(serverApi.vaultFiles).mockResolvedValue({
      vaultId: 'vault-1',
      sequence: 4,
      files: [
        { id: 'folder-1', parentId: null, name: 'Notes', relativePath: 'Notes', kind: 'folder', documentType: null, state: 'active', currentRevision: null, createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z' },
        { id: 'file-1', parentId: 'folder-1', name: 'Test.md', relativePath: 'Notes/Test.md', kind: 'document', documentType: 'note', state: 'active', currentRevision, createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z' },
      ],
    });
    vi.mocked(serverApi.fileRevisions).mockResolvedValue([
      currentRevision,
      { ...currentRevision, id: 'revision-1', sequence: 1, contentHash: 'hash-1', sizeBytes: 8 },
    ]);
    vi.mocked(serverApi.downloadFile).mockResolvedValue(new Blob(['file']));
    vi.mocked(serverApi.moveFile).mockResolvedValue({ resultManifestSequence: 5 });
    vi.mocked(serverApi.restoreFileRevision).mockResolvedValue({});

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));
    expect(await screen.findByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(screen.queryByText('Test.md')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Test.md')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vault root' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Vault root' }));
    fireEvent.change(screen.getByLabelText('Search vault files'), { target: { value: 'test.md' } });
    expect(await screen.findByText('Notes/Test.md')).toBeTruthy();
    expect(screen.getByText('1 matches across the vault')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Download Notes/Test.md' }));
    await waitFor(() => expect(serverApi.downloadFile).toHaveBeenCalledWith('vault-1', 'file-1'));

    // Clearing the search returns to the folder browser (Vault root).
    fireEvent.change(screen.getByLabelText('Search vault files'), { target: { value: '' } });

    // Folders download as ZIP archives.
    vi.mocked(serverApi.downloadFolder).mockResolvedValue(new Blob(['zip']));
    fireEvent.click(await screen.findByRole('button', { name: 'Download Notes' }));
    await waitFor(() => expect(serverApi.downloadFolder).toHaveBeenCalledWith('vault-1', 'folder-1'));

    // Moving is drag-and-drop: drag the file onto the Vault root breadcrumb.
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const testRow = (await screen.findByText('Test.md')).closest('.file-row');
    expect(testRow).toBeTruthy();
    fireEvent.dragStart(testRow!, { dataTransfer: { effectAllowed: 'move' } });
    const vaultRootCrumb = screen.getByRole('button', { name: 'Vault root' });
    fireEvent.dragOver(vaultRootCrumb);
    fireEvent.drop(vaultRootCrumb);
    await waitFor(() => expect(serverApi.moveFile).toHaveBeenCalledWith('vault-1', expect.objectContaining({
      operationType: 'move', targetFileId: 'file-1', parentId: null,
    })));

    // History is a dropdown menu instead of a separate panel.
    fireEvent.click(await screen.findByRole('button', { name: 'History Notes/Test.md' }));
    expect(await screen.findByText('Revision 1')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[1]);
    await waitFor(() => expect(serverApi.restoreFileRevision).toHaveBeenCalledWith('vault-1', 'file-1', 'revision-1', 2));
  });

  it('adds vault members and protects owner and pending-delete vaults', async () => {
    const activeMember = { ...disabledMember, status: 'active' as const };
    const extraUser = { ...activeMember, id: 'user-3', username: 'carol', displayName: 'Carol' };
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin, activeMember, extraUser]);
    vi.mocked(serverApi.vaults).mockResolvedValue([{
      id: 'vault-1',
      name: 'Frozen Vault',
      ownerDisplayName: 'Admin User',
      status: 'pending_delete',
      members: 1,
      storageBytes: 0,
      updatedAt: '2026-06-10T00:00:00Z',
    }]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue({
      id: 'vault-1',
      name: 'Frozen Vault',
      ownerUserId: 'admin-1',
      ownerUsername: 'admin',
      ownerDisplayName: 'Admin User',
      status: 'pending_delete',
      manifestSequence: 2,
      members: 1,
      activeFiles: 0,
      trashedFiles: 0,
      storageBytes: 0,
      createdAt: '2026-06-09T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
    });
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Frozen Vault' }));

    expect(await screen.findByRole('heading', { name: 'Frozen Vault' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore vault' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete vault' })).toBeNull();
    expect(screen.queryByLabelText('Add member user')).toBeNull();
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates a one-time invitation link through the user-management flow', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.createInvitation).mockResolvedValue({
      invitation: {
        id: 'invite-1',
        username: 'alice',
        displayName: 'Alice',
        role: 'member',
        createdAt: '2026-06-09T00:00:00Z',
        expiresAt: '2026-06-12T00:00:00Z',
        acceptedAt: null,
        revokedAt: null,
      },
      token: 'one-time-token',
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(serverApi.createInvitation).toHaveBeenCalled());
    expect(await screen.findByText(/one-time-token/)).toBeTruthy();
  });

  it('re-enables and deletes normal accounts while protecting the primary administrator', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin, disabledMember]);
    vi.mocked(serverApi.updateUser).mockResolvedValue({ ...disabledMember, status: 'active' });
    vi.mocked(serverApi.deleteUser).mockResolvedValue(undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-enable' }));
    await waitFor(() => expect(serverApi.updateUser).toHaveBeenCalledWith('member-1', { disabled: false }));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete account' });
    expect((deleteButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((deleteButtons[1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deleteButtons[1]);
    const cancelledDialog = await screen.findByRole('dialog', { name: 'Delete member?' });
    fireEvent.click(within(cancelledDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(serverApi.deleteUser).not.toHaveBeenCalled();

    fireEvent.click(deleteButtons[1]);
    const confirmDialog = await screen.findByRole('dialog', { name: 'Delete member?' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete account' }));
    await waitFor(() => expect(serverApi.deleteUser).toHaveBeenCalledWith('member-1'));
  });

  it('persists administration appearance settings', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    fireEvent.click(screen.getByRole('option', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'emerald' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Compact density' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(document.documentElement.dataset.accent).toBe('emerald');
      expect(document.documentElement.dataset.density).toBe('compact');
    });
    expect(JSON.parse(localStorage.getItem('collab-admin-appearance') ?? '{}')).toEqual({
      theme: 'light',
      accent: 'emerald',
      compact: true,
    });
  });

  it('renders the permissions overview tree and filters by search', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([
      admin,
      { ...disabledMember, status: 'active' as const },
    ]);
    vi.mocked(serverApi.groups).mockResolvedValue([
      { id: 'group-1', name: 'Reviewers', description: 'QA reviewers', memberCount: 1, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.groupMembers).mockResolvedValue([
      { userId: 'member-1', username: 'member', displayName: 'Member User', addedAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaults).mockResolvedValue([
      { id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active', members: 2, storageBytes: 0, updatedAt: '2026-06-10T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultGrants).mockResolvedValue([
      { subjectType: 'group', subjectId: 'group-1', subjectName: 'Reviewers', templateId: 't1', templateName: 'reviewer', capabilities: ['vault.read'], createdAt: '2026-06-09T00:00:00Z' },
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }));

    // Both the group and the users appear in the tree.
    expect(await screen.findByText('Reviewers')).toBeTruthy();
    expect(screen.getByText('Member User')).toBeTruthy();

    // Expanding the group reveals its members and vault grants.
    fireEvent.click(screen.getByText('Reviewers'));
    expect(await screen.findByText('Vault grants')).toBeTruthy();
    fireEvent.click(screen.getByText('Vault grants'));
    expect(await screen.findByText('Team Vault')).toBeTruthy();

    // Searching narrows the tree to matching subjects.
    fireEvent.change(screen.getByLabelText('Search permissions'), { target: { value: 'review' } });
    expect(screen.getByText('Reviewers')).toBeTruthy();
    expect(screen.queryByText('Member User')).toBeNull();
  });

  it('creates a permission template from grouped capability checkboxes', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.templates).mockResolvedValue([
      { id: 'builtin-viewer', name: 'viewer', description: 'Read only', isBuiltin: true, capabilities: ['vault.read'], createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.createTemplate).mockResolvedValue({
      id: 'tpl-new', name: 'PDF reviewer', description: null, isBuiltin: false, capabilities: ['vault.read', 'pdf.comment'], createdAt: '2026-06-11T00:00:00Z', updatedAt: '2026-06-11T00:00:00Z',
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Templates' }));
    // Built-ins are read-only (clone only); custom creation opens the editor.
    expect(await screen.findByText('viewer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));

    const dialog = await screen.findByRole('dialog', { name: 'New template' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'PDF reviewer' } });
    fireEvent.click(within(dialog).getByLabelText('vault.read'));
    fireEvent.click(within(dialog).getByLabelText('pdf.comment'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));

    await waitFor(() => expect(serverApi.createTemplate).toHaveBeenCalledWith({
      name: 'PDF reviewer',
      description: null,
      capabilities: ['vault.read', 'pdf.comment'],
    }));
  });

  it('edits a user display name and username from the admin users page', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.updateUser).mockResolvedValue({ ...admin, displayName: 'Renamed Admin', username: 'admin2' });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Users' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit admin' });
    fireEvent.change(within(dialog).getByLabelText('Display name'), { target: { value: 'Renamed Admin' } });
    fireEvent.change(within(dialog).getByLabelText('Username'), { target: { value: 'admin2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(serverApi.updateUser).toHaveBeenCalledWith('admin-1', { displayName: 'Renamed Admin', username: 'admin2' }));
  });

  it('adds a user to a group from the permissions users tab', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.groups).mockResolvedValue([
      { id: 'group-1', name: 'Reviewers', description: null, memberCount: 0, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.addGroupMember).mockResolvedValue(undefined);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Users' }));
    // Select the user in the picker, then add them to the group.
    await waitFor(() => expect(document.querySelector('.user-pick')).not.toBeNull());
    fireEvent.click(document.querySelector('.user-pick') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() => expect(serverApi.addGroupMember).toHaveBeenCalledWith('group-1', 'admin-1'));
  });

  it('updates the signed-in account profile from the account dialog', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.updateSelf).mockResolvedValue({ ...admin, displayName: 'My New Name' });

    render(<App />);
    await screen.findByRole('heading', { name: 'Server dashboard' });
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Your account' });
    fireEvent.change(within(dialog).getByLabelText('Display name'), { target: { value: 'My New Name' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(serverApi.updateSelf).toHaveBeenCalledWith({ displayName: 'My New Name' }));
  });

  it('grants a group access to a vault from the permissions groups tab', async () => {
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.groups).mockResolvedValue([
      { id: 'group-1', name: 'Reviewers', description: null, memberCount: 0, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.templates).mockResolvedValue([
      { id: 'tpl-1', name: 'reviewer', description: null, isBuiltin: false, capabilities: ['vault.read'], createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaults).mockResolvedValue([
      { id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active', members: 1, storageBytes: 0, updatedAt: '2026-06-10T00:00:00Z' },
    ]);
    vi.mocked(serverApi.putVaultGrant).mockResolvedValue({
      subjectType: 'group', subjectId: 'group-1', subjectName: 'Reviewers', templateId: 'tpl-1', templateName: 'reviewer', capabilities: ['vault.read'], createdAt: '2026-06-11T00:00:00Z',
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Groups' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }));
    const dialog = await screen.findByRole('dialog', { name: 'Access for Reviewers' });
    // Switch the grant source to a template and apply.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Grant source' }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Template' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(serverApi.putVaultGrant).toHaveBeenCalledWith('vault-1', 'group', 'group-1', { templateId: 'tpl-1' }));
  });

  it('grants a group access to a vault through a template', async () => {
    const vaultSummary = { id: 'vault-1', name: 'Team Vault', ownerDisplayName: 'Admin User', status: 'active' as const, members: 1, storageBytes: 0, updatedAt: '2026-06-10T00:00:00Z' };
    const vaultDetail = {
      id: 'vault-1', name: 'Team Vault', ownerUserId: 'admin-1', ownerUsername: 'admin', ownerDisplayName: 'Admin User',
      status: 'active' as const, manifestSequence: 0, members: 1, activeFiles: 0, trashedFiles: 0, storageBytes: 0,
      createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-10T00:00:00Z',
    };
    vi.mocked(serverApi.bootstrapStatus).mockResolvedValue({ required: false });
    vi.mocked(serverApi.me).mockResolvedValue(admin);
    vi.mocked(serverApi.users).mockResolvedValue([admin]);
    vi.mocked(serverApi.vaults).mockResolvedValue([vaultSummary]);
    vi.mocked(serverApi.vaultDetail).mockResolvedValue(vaultDetail);
    vi.mocked(serverApi.vaultMembers).mockResolvedValue([
      { userId: 'admin-1', username: 'admin', displayName: 'Admin User', role: 'admin', owner: true, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.vaultActivity).mockResolvedValue([]);
    vi.mocked(serverApi.groups).mockResolvedValue([
      { id: 'group-1', name: 'Reviewers', description: null, memberCount: 0, createdAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.templates).mockResolvedValue([
      { id: 'tpl-1', name: 'reviewer', description: null, isBuiltin: false, capabilities: ['vault.read', 'kanban.card.move'], createdAt: '2026-06-09T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z' },
    ]);
    vi.mocked(serverApi.putVaultGrant).mockResolvedValue({
      subjectType: 'group', subjectId: 'group-1', subjectName: 'Reviewers', templateId: 'tpl-1', templateName: 'reviewer', capabilities: ['vault.read', 'kanban.card.move'], createdAt: '2026-06-11T00:00:00Z',
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vaults' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Team Vault' }));
    expect(await screen.findByRole('heading', { name: 'Team Vault' })).toBeTruthy();

    // Pick the reviewer template in the Access grants form and apply.
    fireEvent.click(screen.getByRole('button', { name: 'Grant template' }));
    fireEvent.click(screen.getByRole('option', { name: 'reviewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply grant' }));

    await waitFor(() => expect(serverApi.putVaultGrant).toHaveBeenCalledWith('vault-1', 'group', 'group-1', { templateId: 'tpl-1' }));
  });
});
