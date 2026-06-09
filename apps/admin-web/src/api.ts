import type { AdminOverview, AuditEvent, ServerUser } from './types';

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
  bootstrapStatus: () => api<{ required: boolean }>('/api/v1/auth/bootstrap-status'),
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
  revokeSessions: (id: string) =>
    api<void>(`/api/v1/admin/users/${id}/revoke-sessions`, { method: 'POST' }),
  auditEvents: () => api<AuditEvent[]>('/api/v1/admin/audit-events'),
};
