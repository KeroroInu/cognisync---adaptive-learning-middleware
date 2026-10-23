import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactContents, StudentArtifacts, artifactDate } from './StudentArtifacts';
import type { StudentArtifactDetail } from '../lib/studentArtifacts';

const fixture = (extra: Partial<StudentArtifactDetail> = {}): StudentArtifactDetail => ({
  receipt_id: 'receipt-1', material_id: 'task-1', task_title: '第1课 · AI 会写代码以后', task_kind: 'sfls',
  created_at: '2026-10-22T08:00:00Z', filename: 'G2026001_学生.zip', size: 2048, sha256: 'hash',
  task_validation_status: 'matched', manual_import: false, download_url: '/api/ignored',
  readme: null, code_files: [], messages: [], warnings: [],
  evidence: { has_events: true, has_sessions: true, code_file_count: 0, message_count: 0, displayed_message_count: 0, truncated: false },
  ...extra,
});

describe('student submission source previews', () => {
  it('loads received artifacts first without asking a teacher to write an observation', () => {
    const html = renderToStaticMarkup(<StudentArtifacts userId="student-1" />);
    expect(html).toContain('已交作品与 SFLS 对话');
    expect(html).toContain('正在读取提交记录');
    expect(html).not.toContain('保存点评');
    expect(html).not.toContain('暂无知识图谱');
  });

  it('renders source code as escaped, read-only text without interpreting HTML', () => {
    const detail = fixture({ code_files: [{ path: 'project/snake.py', text: 'print("<script>alert(1)</script>")\n# 学生代码', truncated: false }], evidence: { ...fixture().evidence, code_file_count: 1 } });
    const html = renderToStaticMarkup(<ArtifactContents detail={detail} />);
    expect(html).toContain('project/snake.py');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain('textarea');
  });

  it('distinguishes actual student and SFLS turns, retains line breaks and bounds initial rendering', () => {
    const detail = fixture({ messages: Array.from({ length: 45 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `发言 ${i}\n第二行`, at: null, session_path: 'evidence/sessions/session.jsonl', line: i + 1 })), evidence: { ...fixture().evidence, message_count: 45, displayed_message_count: 45 } });
    const html = renderToStaticMarkup(<ArtifactContents detail={detail} />);
    expect(html).toContain('is-user');
    expect(html).toContain('is-assistant');
    expect(html).toContain('学生</strong>');
    expect(html).toContain('SFLS</strong>');
    expect(html).toContain('发言 39\n第二行');
    expect(html).not.toContain('发言 40\n');
    expect(html).toContain('还有 5 条');
    expect(html).toContain('时间未记录');
  });

  it('does not treat a template README as a missing submission or infer mastery', () => {
    const detail = fixture({ readme: { path: 'project/README.md', text: '# 我的作品\n<iframe src="http://example.test">', is_template: true, truncated: false } });
    const html = renderToStaticMarkup(<ArtifactContents detail={detail} />);
    expect(html).toContain('仍是初始模板');
    expect(html).toContain('这不影响已收到的代码和对话');
    expect(html).toContain('&lt;iframe');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('掌握度');
  });

  it('labels missing, truncated and lower-bound evidence instead of creating records', () => {
    const detail = fixture({ messages: [{ role: 'user', text: '很长的发言', at: 'invalid date', session_path: 'session', line: 1, truncated: true }], evidence: { ...fixture().evidence, has_events: false, message_count: 200, displayed_message_count: 1, truncated: true, message_count_is_lower_bound: true } });
    const html = renderToStaticMarkup(<ArtifactContents detail={detail} />);
    expect(html).toContain('至少 200 条');
    expect(html).toContain('此包未发现：过程事件、源代码');
    expect(html).toContain('不代表学生没有完成');
    expect(html).toContain('仅预览前段');
    expect(html).toContain('完整记录请下载作品包');
    expect(html).not.toContain('Invalid Date');
  });

  it('never displays an invalid timestamp as a fabricated date', () => {
    expect(artifactDate(null)).toBe('时间未记录');
    expect(artifactDate('not a date')).toBe('时间未记录');
  });
});
