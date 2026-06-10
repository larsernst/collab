import type { AdminOverview, AuditEvent, CreatedInvitation, HostedVaultSummary, Invitation, ServerUser } from './types';

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
  auditEvents: () => api<AuditEvent[]>('/api/v1/admin/audit-events'),
};
