import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, resolveApiBaseUrl } from './lib/apiClient';

describe('resolveApiBaseUrl', () => {
  it('uses the unified reverse-proxy path in production', () => {
    expect(resolveApiBaseUrl(true, 'http://localhost:8000/api')).toBe('/api');
  });

  it('keeps development requests on the same-origin proxy even with a legacy absolute URL', () => {
    expect(resolveApiBaseUrl(false, 'http://localhost:8000/api')).toBe('/api');
  });

  it('falls back to the unified path when no target is configured', () => {
    expect(resolveApiBaseUrl(false, undefined)).toBe('/api');
  });
});

describe('admin API error handling', () => {
  const fetcher = vi.fn();
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map([['auth_token', 'teacher-token']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    fetcher.mockReset();
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ['AUTH_BUSY', '登录人数较多，请稍后再试。'],
    ['AUTH_QUEUE_TIMEOUT', '等待登录超时，请稍后再试。'],
  ])('preserves %s queue guidance and submits a login POST only once', async (code, message) => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: { code, message } }), { status: 503 }));
    await expect(apiClient.post('/admin/auth/login', { student_id: 'teacher', password: 'test-password' })).rejects.toThrow(message);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/auth/login', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ student_id: 'teacher', password: 'test-password' }),
    }));
    expect(stored.get('auth_token')).toBe('teacher-token');
  });

  it('clears an expired token and returns Chinese 401 guidance', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(apiClient.get('/admin/auth/me')).rejects.toThrow('登录已过期，请重新登录。');
    expect(stored.has('auth_token')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('explains a failed login without calling it an expired session', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(apiClient.post('/admin/auth/login', {})).rejects.toThrow('学号或密码错误，请检查后重试。');
    expect(stored.has('auth_token')).toBe(false);
  });

  it('keeps backend authentication guidance while clearing a revoked token', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: '密码已更新，请重新登录' }), { status: 401 }));
    await expect(apiClient.get('/admin/auth/me')).rejects.toThrow('密码已更新，请重新登录');
    expect(stored.has('auth_token')).toBe(false);
  });

  it('returns Chinese 403 guidance without discarding a valid token', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(apiClient.get('/admin/users')).rejects.toThrow('没有操作权限，请联系管理员。');
    expect(stored.get('auth_token')).toBe('teacher-token');
  });

  it('preserves a FastAPI string detail instead of swallowing the thrown error', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: '该账号没有管理员权限，请联系管理员' }), { status: 403 }));
    await expect(apiClient.post('/admin/auth/login', {})).rejects.toThrow('该账号没有管理员权限，请联系管理员');
  });

  it('preserves the existing error.message response format', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: '该题已经发布。' } }), { status: 409 }));
    await expect(apiClient.post('/admin/classroom/example', {})).rejects.toThrow('该题已经发布。');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not show raw HTML or a JSON parser error from a proxy outage', async () => {
    fetcher.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    await expect(apiClient.get('/admin/users')).rejects.toThrow('服务器暂时无法响应，请稍后再试。');
    expect(stored.get('auth_token')).toBe('teacher-token');
  });

  it('rejects an HTML page returned with a successful HTTP status', async () => {
    fetcher.mockResolvedValue(new Response('<html>Proxy login</html>', { status: 200 }));
    await expect(apiClient.get('/admin/users')).rejects.toThrow('服务器响应异常，请刷新后重试。');
  });

  it('explains a network failure and never retries the POST', async () => {
    fetcher.mockRejectedValue(new TypeError('Load failed'));
    await expect(apiClient.post('/admin/auth/login', {})).rejects.toThrow('无法连接服务器，请检查网络后重试。');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored.get('auth_token')).toBe('teacher-token');
  });

  it('preserves explicit cancellation without presenting it as network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    fetcher.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(apiClient.get('/admin/users', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', message: '请求已取消。' });
  });

  it('unwraps successful data and still sends the authentication header', async () => {
    const data = { user: { name: '测试教师' }, token: 'new-token' };
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data })));
    await expect(apiClient.get('/admin/auth/me')).resolves.toEqual(data);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/auth/me', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer teacher-token' }) }));
  });

  it('keeps business failures in successful HTTP responses as errors', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: false, error: { code: 'SAVE_FAILED', message: '保存未完成，请重试。' } })));
    await expect(apiClient.post('/admin/example', {})).rejects.toThrow('保存未完成，请重试。');
  });
});
