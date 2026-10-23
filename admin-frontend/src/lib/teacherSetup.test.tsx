import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { adminApi } from './adminApi';
import { Users } from '../pages/Users';
import { StudentAssistantConfig } from '../components/StudentAssistantConfig';

afterEach(() => { vi.unstubAllGlobals(); });
describe('teacher setup', () => {
  it('exposes one cross-page unassigned selection and a separate assistant setting', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Users /><StudentAssistantConfig /></MemoryRouter>);
    expect(html).toContain('全选未分组（跨页）');
    expect(html).toContain('按教学分组筛选');
    expect(html).toContain('刷新名单');
    expect(html).toContain('学生平台 AI 助手');
    expect(html).toContain('配置 API key');
    expect(html).not.toContain('type="password"'); // Closed until teacher opens it.
  });
  it('filters the list and snapshots IDs before an explicit batch write', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ success: true, data: { ids: ['s1', 's2'] } })));
    vi.stubGlobal('fetch', fetcher);
    await adminApi.getUsers(2, 10, '同学', 'unassigned');
    expect(fetcher.mock.calls[0][0]).toContain('experiment_group=unassigned');
    const selected = await adminApi.getUnassignedStudentIds('同学');
    expect(fetcher.mock.calls[1][0]).toContain('/users/unassigned-ids?query=');
    await adminApi.assignStudents(selected.ids, '开发班');
    expect(fetcher).toHaveBeenLastCalledWith('/api/admin/users/batch-assign', expect.objectContaining({ method: 'POST', body: JSON.stringify({ user_ids: ['s1', 's2'], class_name: '开发班' }) }));
  });
  it('omits unchanged keys and saves only the requested role', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ success: true, data: {} })));
    vi.stubGlobal('fetch', fetcher);
    await adminApi.saveLlmConfig('chat', { provider: 'deepseek', model: 'model', base_url: 'https://api.example/v1', api_key: undefined });
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(body.role).toBe('chat');
    expect(body.config).not.toHaveProperty('api_key');
  });
});
