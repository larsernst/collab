import type {
  AdminOverview,
  AuditEvent,
  CreatedInvitation,
  HostedVaultActivityEvent,
  HostedVaultAdminDetail,
  HostedFileEntry,
  HostedFileRevision,
  HostedVaultImportResult,
  HostedVaultMember,
  HostedVaultStorage,
  HostedVaultManifest,
  HostedVaultSummary,
  Invitation,
  ServerUser,
} from './types';

interface DataResponse<T> {
  data: T;
}

interface ErrorResponse {
  error?: {
    message?: string;
    requestId?: string;
  };
}

function readCookie(name: string) {
  return document.cookie
    .split(';')
    .map((value) => value.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const csrf = readCookie('collab_csrf');
  if (csrf && init.method && init.method !== 'GET') headers.set('x-collab-csrf', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    const suffix = body.error?.requestId ? ` (${body.error.requestId})` : '';
    throw new Error(`${body.error?.message ?? `Request failed with ${response.status}`}${suffix}`);
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as DataResponse<T>).data;
}

async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    const suffix = body.error?.requestId ? ` (${body.error.requestId})` : '';
    throw new Error(`${body.error?.message ?? `Request failed with ${response.status}`}${suffix}`);
  }
  return response.blob();
}

export const serverApi = {
  bootstrapStatus: () => api<{ required: boolean }>('/api/v1/auth/bootstrap-status', { cache: 'no-store' }),
  bootstrap: (payload: Record<string, unknown>) =>
    api<{ user: ServerUser; csrfToken: string }>('/api/v1/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (payload: Record<string, unknown>) =>
    api<{ user: ServerUser; csrfToken: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  acceptInvitation: (token: string, password: string) =>
    api<{ user: ServerUser; csrfToken: string }>(`/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => api<void>('/api/v1/auth/logout', { method: 'POST' }),
  me: () => api<ServerUser>('/api/v1/users/me'),
  overview: () => api<AdminOverview>('/api/v1/admin/overview'),
  users: () => api<ServerUser[]>('/api/v1/admin/users'),
  createUser: (payload: Record<string, unknown>) =>
    api<ServerUser>('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: string, payload: Record<string, unknown>) =>
    api<ServerUser>(`/api/v1/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) => api<void>(`/api/v1/admin/users/${id}`, { method: 'DELETE' }),
  revokeSessions: (id: string) =>
    api<void>(`/api/v1/admin/users/${id}/revoke-sessions`, { method: 'POST' }),
  resetPassword: (id: string, newPassword: string) =>
    api<void>(`/api/v1/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  userActivity: (id: string) => api<AuditEvent[]>(`/api/v1/admin/users/${id}/activity`),
  invitations: () => api<Invitation[]>('/api/v1/admin/invitations'),
  createInvitation: (payload: Record<string, unknown>) =>
    api<CreatedInvitation>('/api/v1/admin/invitations', { method: 'POST', body: JSON.stringify(payload) }),
  vaults: () => api<HostedVaultSummary[]>('/api/v1/admin/vaults'),
  createVault: (payload: Record<string, unknown>) =>
    api<{ id: string }>('/api/v1/vaults', { method: 'POST', body: JSON.stringify(payload) }),
  vaultDetail: (id: string) => api<HostedVaultAdminDetail>(`/api/v1/admin/vaults/${id}`),
  updateVault: (id: string, payload: Record<string, unknown>) =>
    api<HostedVaultAdminDetail>(`/api/v1/admin/vaults/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteVault: (id: string) => api<void>(`/api/v1/admin/vaults/${id}`, { method: 'DELETE' }),
  vaultMembers: (id: string) => api<HostedVaultMember[]>(`/api/v1/admin/vaults/${id}/members`),
  addVaultMember: (id: string, payload: Record<string, unknown>) =>
    api<HostedVaultMember>(`/api/v1/admin/vaults/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateVaultMember: (id: string, userId: string, payload: Record<string, unknown>) =>
    api<HostedVaultMember>(`/api/v1/admin/vaults/${id}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  removeVaultMember: (id: string, userId: string) =>
    api<void>(`/api/v1/admin/vaults/${id}/members/${userId}`, { method: 'DELETE' }),
  vaultActivity: (id: string) => api<HostedVaultActivityEvent[]>(`/api/v1/admin/vaults/${id}/activity`),
  vaultStorage: (id: string) => api<HostedVaultStorage>(`/api/v1/vaults/${id}/storage`),
  vaultFiles: (id: string) => api<HostedVaultManifest>(`/api/v1/vaults/${id}/manifest`),
  fileRevisions: (vaultId: string, fileId: string) =>
    api<HostedFileRevision[]>(`/api/v1/vaults/${vaultId}/files/${fileId}/revisions`),
  downloadFile: (vaultId: string, fileId: string) =>
    apiBlob(`/api/v1/vaults/${vaultId}/files/${fileId}/content`),
  downloadFolder: (vaultId: string, fileId: string) =>
    apiBlob(`/api/v1/vaults/${vaultId}/files/${fileId}/archive`),
  moveFile: (vaultId: string, payload: Record<string, unknown>) =>
    api<{ resultManifestSequence: number }>(`/api/v1/vaults/${vaultId}/operations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  restoreFileRevision: (vaultId: string, fileId: string, revisionId: string, expectedRevisionSequence: number) =>
    api<unknown>(`/api/v1/vaults/${vaultId}/files/${fileId}/revisions/${revisionId}`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevisionSequence }),
    }),
  importVault: (id: string, archiveBase64: string) =>
    api<HostedVaultImportResult>(`/api/v1/vaults/${id}/import`, {
      method: 'POST',
      body: JSON.stringify({ archiveBase64 }),
    }),
  exportVault: (id: string) => apiBlob(`/api/v1/vaults/${id}/export`),
  auditEvents: () => api<AuditEvent[]>('/api/v1/admin/audit-events'),
};
