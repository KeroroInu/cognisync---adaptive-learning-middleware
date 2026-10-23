import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchPackagePanel, researchPackageFilename } from './ResearchPackagePanel';
import { adminApi } from '../lib/adminApi';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Research package controls', () => {
  it('exposes filters and explicitly distinguishes evidence from anonymous data', () => {
    const html = renderToStaticMarkup(<ResearchPackagePanel />);
    expect(html).toContain('下载实验数据');
    expect(html).toContain('解构班');
    expect(html).toContain('开发班');
    expect(html).toContain('<option value="体验组">体验组</option>');
    expect(html).not.toContain('实验组');
    expect(html).toContain('<details');
    expect(html).toContain('选择课次');
    expect(html).toContain('<option value="" selected="">全部课次</option>');
    expect(html).toContain('正在读取课次');
    expect(html).toContain('按课次、班级、学生与历次提交整理');
    expect(html).toContain('问卷、量表等跨课资料仍保留');
    expect(html).toContain('不猜测归类');
    expect(html).toContain('包含当前知识图谱');
    expect(html).toContain('自由文本仍需脱敏');
    const inputs = html.match(/<input[^>]+type="checkbox"[^>]*>/g) || [];
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).not.toContain('checked');
    expect(inputs[1]).toContain('checked');
    expect(inputs[2]).toContain('checked');
  });

  it('does not offer a download before the lesson catalog has loaded', () => {
    const html = renderToStaticMarkup(<ResearchPackagePanel />);
    expect(html).toMatch(/<select[^>]+id="research-export-lesson"[^>]+disabled=""/);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+class="exports-download"/);
    expect(html).toContain('aria-describedby="research-export-scope"');
  });

  it('names downloads with a concise lesson, class, and date', () => {
    const date = new Date('2026-10-23T05:00:00Z');
    expect(researchPackageFilename('解构班', '第 02 课 · 完整贪吃蛇', date)).toBe('SFLS_实验数据_第2课_解构班_2026-10-23.zip');
    expect(researchPackageFilename('', '', date)).toBe('SFLS_实验数据_全部课次_全部班级_2026-10-23.zip');
    expect(researchPackageFilename('体验/组:*?', '../未归课\\资料<>|\n', date)).toBe('SFLS_实验数据_未归课资料_体验组_2026-10-23.zip');
    expect(researchPackageFilename('开发班', '独立主题'.repeat(30), date).length).toBeLessThan(80);
  });

  it('requests the directory for only the selected class and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { lessons: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => 'fixture-token' });
    const controller = new AbortController();
    await expect(adminApi.getResearchExportLessons(' 解构班 ', controller.signal)).resolves.toEqual({ lessons: [] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/admin/export/research-lessons?${new URLSearchParams({ class_name: '解构班' })}`);
    expect(options.signal).toBe(controller.signal);
    expect(options.headers.Authorization).toBe('Bearer fixture-token');
  });

  it('omits a class filter for the complete directory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { lessons: [] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => '' });
    await adminApi.getResearchExportLessons();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/export/research-lessons');
  });
});
