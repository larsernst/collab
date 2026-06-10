import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, serverApi } from './api';

describe('admin API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'collab_csrf=; Max-Age=0';
  });

  it('sends same-origin credentials and CSRF for mutations', async () => {
    document.cookie = 'collab_csrf=csrf-token';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/test', { method: 'POST', body: '{}' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        credentials: 'same-origin',
        method: 'POST',
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('x-collab-csrf')).toBe('csrf-token');
  });

  it('surfaces safe server messages and request IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Denied', requestId: 'request-1' } }), {
          status: 403,
        }),
      ),
    );
    await expect(api('/api/test')).rejects.toThrow('Denied (request-1)');
  });

  it('bypasses browser caches when checking whether bootstrap is required', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { required: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await serverApi.bootstrapStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/bootstrap-status',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
