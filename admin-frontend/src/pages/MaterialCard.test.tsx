import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupMaterials, MaterialCard, type Material } from './LessonMaterials';

const item = {
  id: 'fixture-task', title: '第1课 · AI 会写代码以后', kind: 'sfls', closed_at: null,
  student_visible: true, submission_count: 4, download_count: 27,
  participation: { eligible_user_count: 35, download_user_count: 2, submission_user_count: 1, pending_user_count: 34, statistics_started_at: null, excluded_student_ids: [] as string[] },
  configuration: { task: '先尝试，再讨论。', inherit_previous: false,
    library: { version: 'fixture', lesson_number: 1, slides_path: '/slides/fixture.html' } },
};
const noop = () => {};
const render = (overrides: Partial<Material> = {}, disabled = false, history = false) =>
  renderToStaticMarkup(<MaterialCard item={{ ...item, ...overrides }} disabled={disabled} history={history} onToggle={noop} onReceipts={noop} onParticipation={noop} />);

describe('teacher material cards', () => {
  it('separates the title, visibility, learning mode and actual counts', () => {
    const html = render();
    expect(html).toContain('<h3>第1课 · AI 会写代码以后</h3>');
    expect(html).toContain('学生正在看');
    expect(html).toContain('首次体验');
    expect(html).toContain('下载 <strong>2</strong> 人');
    expect(html).toContain('已交 <strong>1</strong> 人');
    expect(html).toContain('未交 <strong>34</strong> 人');
    expect(html).not.toContain('27');
    expect(html).toContain('重复下载与多次提交按 1 人计');
    expect(html).toContain('收起任务');
    expect(html).not.toContain('发布给本班');
  });
  it('keeps slide navigation a real link with the same action class', () => {
    const html = render();
    expect(html).toContain('class="lesson-action" href="/slides/fixture.html" target="_blank" rel="noreferrer"');
    expect(html).toContain('全部版本记录');
    expect(html).toContain('查看学生名单');
  });
  it('does not make external or unsupported slide paths into links', () => {
    const html = render({ configuration: { ...item.configuration, library: { ...item.configuration.library, slides_path: 'https://example.invalid/' } } });
    expect(html).not.toContain('打开课件');
    expect(html).not.toContain('https://example.invalid/');
  });
  it('keeps pending publication and continuation distinct', () => {
    const html = render({ student_visible: false, configuration: { ...item.configuration, inherit_previous: true } });
    expect(html).toContain('待发布');
    expect(html).toContain('继续本人上次作品');
    expect(html).toContain('发布给本班');
    expect(html).not.toContain('收起任务');
  });
  it('keeps historical reopening and count defaults available', () => {
    const html = render({ student_visible: false, submission_count: undefined, download_count: undefined }, false, true);
    expect(html).toContain('历史版本');
    expect(html).toContain('重新开放');
    expect(html).toContain('共收 <strong>0</strong> 份 · 下载 <strong>0</strong> 次');
    expect(html).toContain('版本 fixture');
    expect(html).not.toContain('查看学生名单');
  });
  it('disables publication changes without blocking historical receipt access', () => {
    const html = render({}, true);
    expect(html).toContain('class="lesson-action is-quiet" disabled=""');
    expect(html).toContain('class="lesson-action is-emphasized">查看学生名单');
    expect(html).toContain('全部版本记录');
  });
  it('keeps task text escaped and collapsed by default', () => {
    const html = render({ configuration: { ...item.configuration, task: '<script>fixture</script>' } });
    expect(html).toContain('<details class="lesson-material-details">');
    expect(html).toContain('&lt;script&gt;fixture&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('explains the counting cutoff and exclusion without resetting historical counts', () => {
    const html = render({ participation: { ...item.participation, statistics_started_at: '2026-10-22T03:00:00Z', excluded_student_ids: ['1'] } });
    expect(html).toContain('起统计');
    expect(html).toContain('演示账号不计入统计');
    expect(render({ participation: undefined })).toContain('人数统计暂不可用');
  });
});

describe('teacher task sections', () => {
  const material = (id: string, lesson: number, extra: Partial<Material> = {}): Material => ({
    ...item, id, student_visible: false, closed_at: '2026-10-21T00:00:00Z',
    submission_count: 0, download_count: 0,
    configuration: { ...item.configuration, library: { ...item.configuration.library, version: '2026-10-21.1', lesson_number: lesson } }, ...extra,
  });
  it('keeps only the current task in the main section and retains used old tasks in history', () => {
    const current = material('new-c01', 1, { student_visible: true, closed_at: null });
    const old = material('old-c01', 1, { submission_count: 4, download_count: 27 });
    const unusedOld = material('unused-old-c01', 1);
    const next = material('future-c02', 2);
    const result = groupMaterials([old, next, unusedOld, current]);
    expect(result.current.map(row => row.id)).toEqual(['new-c01']);
    expect(result.library.map(row => row.id)).toEqual(['future-c02']);
    expect(result.history.map(row => row.id).sort()).toEqual(['old-c01', 'unused-old-c01']);
    expect(result.history.find(row => row.id === old.id)?.submission_count).toBe(4);
  });
  it('offers only the newest unused future edition, not every same-name task', () => {
    const old = material('old-future', 2, { created_at: '2026-10-20T00:00:00Z' });
    const latest = material('latest-future', 2, { created_at: '2026-10-22T00:00:00Z' });
    const result = groupMaterials([old, latest]);
    expect(result.library.map(row => row.id)).toEqual(['latest-future']);
    expect(result.history.map(row => row.id)).toEqual(['old-future']);
  });
  it('preserves closed custom materials and every used receipt-bearing task', () => {
    const custom = material('old-custom', 9, { configuration: { task: '自定义资料' } });
    const used = material('used-c02', 2, { download_count: 1 });
    const result = groupMaterials([custom, used]);
    expect(result.current).toEqual([]);
    expect(result.library).toEqual([]);
    expect(result.history.map(row => row.id).sort()).toEqual(['old-custom', 'used-c02']);
  });
});
