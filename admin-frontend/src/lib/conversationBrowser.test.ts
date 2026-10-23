import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendMessages, conversationBrowserApi, conversationDate, publicMessages, type WebConversationMessage } from './conversationBrowser';

const filters = { query: '  同学 & 任务  ', className: ' 解构班 ', page: 2, versions: 'all' as const };
const message = (id: string, role = 'user'): WebConversationMessage => ({ id, role, text: id, timestamp: null });
describe('read-only conversation browser API', () => {
  const fetcher = vi.fn();
  beforeEach(() => {
    fetcher.mockReset();
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { items: [], total: 0, page: 2, page_size: 30 } })));
    vi.stubGlobal('localStorage', { getItem: () => 'fixture-teacher-token' });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('lists lightweight SFLS metadata with filters without reading archives or old sessions', async () => {
    const controller = new AbortController();
    await conversationBrowserApi.artifacts(filters, controller.signal);
    const [url, options] = fetcher.mock.calls[0];
    const parsed = new URL(url, 'http://fixture.local');
    expect(parsed.pathname).toBe('/api/admin/conversations/artifacts');
    expect(parsed.searchParams.get('query')).toBe('同学 & 任务');
    expect(parsed.searchParams.get('class_name')).toBe('解构班');
    expect(parsed.searchParams.get('versions')).toBe('all');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('page_size')).toBe('30');
    expect(options).toMatchObject({ method: 'GET', signal: controller.signal, headers: { Authorization: 'Bearer fixture-teacher-token' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('aggregates web records by student and omits SFLS version filters', async () => {
    await conversationBrowserApi.web({ ...filters, query: '', className: '' });
    const parsed = new URL(fetcher.mock.calls[0][0], 'http://fixture.local');
    expect(parsed.pathname).toBe('/api/admin/conversations/web');
    expect(parsed.searchParams.has('versions')).toBe(false);
    expect(parsed.searchParams.has('query')).toBe(false);
    expect(parsed.searchParams.has('class_name')).toBe(false);
  });
  it('requests only selected student public messages with a cancellable 50-row page', async () => {
    const controller = new AbortController();
    await conversationBrowserApi.messages('student/a', 50, controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/conversations/web/student%2Fa/messages?limit=50&offset=50', expect.objectContaining({ method: 'GET', signal: controller.signal }));
  });
  it('keeps tool/analysis/system turns out of previews and appends without duplicates', () => {
    expect(publicMessages([message('one'), message('analysis', 'analysis'), message('tool', 'tool'), message('system', 'system'), message('two', 'assistant')]).map(item => item.id)).toEqual(['one', 'two']);
    expect(appendMessages([message('one')], [message('one'), message('two', 'assistant'), message('two'), message('hidden', 'tool')]).map(item => item.id)).toEqual(['one', 'two']);
  });
  it('does not invent dates for absent or malformed timestamps', () => {
    expect(conversationDate(null)).toBe('时间未记录');
    expect(conversationDate('not-a-date')).toBe('时间未记录');
  });
});
