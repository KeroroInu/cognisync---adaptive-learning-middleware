import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendChatMessage } from '../services/api';

const request = { userId: 'student', message: '这里为什么没变？', language: 'zh' as const, isResearchMode: true };

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('readable chat failures without duplicate model requests', () => {
  it.each(['AI_BUSY', 'AI_QUEUE_TIMEOUT'])('keeps structured %s readable', async code => {
    const message = code === 'AI_BUSY' ? '提问较多，请稍后再试。' : '等待 AI 超时，请稍后再试。';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: { code, message } }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(sendChatMessage(request)).rejects.toMatchObject({ message, code, status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not expose HTML proxy failures or JSON parser errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>upstream failed</html>', { status: 502 })));
    await expect(sendChatMessage(request)).rejects.toMatchObject({ message: 'AI 暂时没有连上，请稍后重试。', status: 502 });
  });

  it('rejects an invalid success response without resending the question', async () => {
    const fetch = vi.fn(async () => new Response('<html>proxy fallback</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(sendChatMessage(request)).rejects.toMatchObject({ message: 'AI 暂时没有连上，请稍后重试。', code: 'INVALID_RESPONSE', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives a short network recovery hint without automatically resending', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetch);
    await expect(sendChatMessage(request)).rejects.toMatchObject({ message: '网络没有连上，请检查连接后重试。', code: 'NETWORK_ERROR' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves classroom closure and its state refresh notification', async () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { code: 'CLASSROOM_CLOSED', message: '老师已结束课堂。' } }), { status: 403 })));
    await expect(sendChatMessage(request)).rejects.toMatchObject({ code: 'CLASSROOM_CLOSED', message: '老师已结束课堂。' });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps meaningful validation messages and successful replies unchanged', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: '请先选择一个功能。' }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { message: '看一下返回值。' } })));
    vi.stubGlobal('fetch', fetch);
    await expect(sendChatMessage(request)).rejects.toThrow('请先选择一个功能。');
    await expect(sendChatMessage(request)).resolves.toEqual({ message: '看一下返回值。' });
  });

  it('localizes unavailable-provider feedback rather than showing internal English', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'AI service temporarily unavailable, please retry' }), { status: 503 })));
    await expect(sendChatMessage(request)).rejects.toThrow('AI 暂时没有连上，请稍后重试。');
    await expect(sendChatMessage({ ...request, language: 'en' })).rejects.toThrow('AI is temporarily unavailable. Please try again shortly.');
  });
});
