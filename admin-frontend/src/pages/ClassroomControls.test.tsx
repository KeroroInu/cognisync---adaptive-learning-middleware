import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClassroomConfirmation } from './Classroom';

const confirmation = {
  title: '现在下课？',
  scope: '高一（2）班',
  description: '给学生 10 秒保存，然后关闭本班的学习和 AI 入口。数据保留，教师端不受影响。',
  confirmLabel: '确认下课',
  busy: false,
  error: '',
  onConfirm: () => undefined,
  onCancel: () => undefined,
};

describe('classroom action confirmation', () => {
  it('names the affected class and explains the consequence before acting', () => {
    const html = renderToStaticMarkup(<ClassroomConfirmation {...confirmation} danger />);
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="classroom-confirm-title"');
    expect(html).toContain('aria-describedby="classroom-confirm-description"');
    expect(html).toContain('高一（2）班');
    expect(html).toContain('10 秒保存');
    expect(html).toContain('取消');
    expect(html).toContain('确认下课');
    expect(html).toContain('class="classroom-end"');
  });

  it('disables cancel and confirm while a request is in progress', () => {
    const html = renderToStaticMarkup(<ClassroomConfirmation {...confirmation} busy />);
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('正在处理…');
    expect(html).not.toContain('>确认下课<');
  });

  it('keeps a failed action visible with an actionable error', () => {
    const html = renderToStaticMarkup(<ClassroomConfirmation {...confirmation} error="连接超时，请刷新查看结果。" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('连接超时');
    expect(html).not.toContain('disabled=""');
  });

  it('shows a plain-text question preview, never executing teacher content', () => {
    const html = renderToStaticMarkup(<ClassroomConfirmation {...confirmation} title="向学生发布这道题？" preview={'<script>alert(1)</script>'} />);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
