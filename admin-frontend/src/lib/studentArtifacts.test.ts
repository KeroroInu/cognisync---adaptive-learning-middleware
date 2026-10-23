import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studentArtifactsApi } from './studentArtifacts';

describe('student artifact requests', () => {
  const fetcher = vi.fn();
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear(); stored.set('auth_token', 'teacher-token'); fetcher.mockReset();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches lightweight paginated version metadata with teacher JWT', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [], total: 0, page: 2, page_size: 20 } })));
    const result = await studentArtifactsApi.list('student/a', 2);
    expect(result.total).toBe(0);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/users/student%2Fa/artifacts?page=2&page_size=20', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer teacher-token' }) }));
  });

  it('forwards AbortSignal so changing student or selected version cancels old preview requests', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} })));
    const controller = new AbortController();
    await studentArtifactsApi.detail('student', 'receipt/one', controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/users/student/artifacts/receipt%2Fone', expect.objectContaining({ signal: controller.signal }));
  });

  it('downloads archive using authentication rather than a tokenless browser link', async () => {
    fetcher.mockResolvedValue(new Response('zip-bytes', { headers: { 'content-type': 'application/zip' } }));
    const result = await studentArtifactsApi.archive('receipt-1');
    expect(await result.text()).toBe('zip-bytes');
    expect(fetcher).toHaveBeenCalledWith('/api/admin/classroom/receipts/receipt-1/file', { headers: { Authorization: 'Bearer teacher-token' }, cache: 'no-store' });
  });

  it('clears expired authentication on archive 401 and never downloads the error page', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(studentArtifactsApi.archive('receipt')).rejects.toThrow('登录已过期');
    expect(stored.has('auth_token')).toBe(false);
  });

  it('keeps a valid teacher token when download is forbidden', async () => {
    fetcher.mockResolvedValue(new Response('{}', { status: 403 }));
    await expect(studentArtifactsApi.archive('receipt')).rejects.toThrow('没有下载权限');
    expect(stored.get('auth_token')).toBe('teacher-token');
  });

  it('gives a useful network failure without retrying or changing records', async () => {
    fetcher.mockRejectedValue(new TypeError('network'));
    await expect(studentArtifactsApi.archive('receipt')).rejects.toThrow('无法连接服务器');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
