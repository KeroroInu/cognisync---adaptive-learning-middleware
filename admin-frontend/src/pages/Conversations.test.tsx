import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessages, Conversations } from './Conversations';

describe('teacher conversation preview', () => {
  it('starts with submitted SFLS records, filters and a read-only two-column view', () => {
    const html = renderToStaticMarkup(<Conversations />);
    expect(html).toContain('对话速览');
    expect(html).toContain('SFLS 作品包');
    expect(html).toContain('网页助手');
    expect(html).toContain('每人每任务最新提交');
    expect(html).toContain('全部历史提交');
    expect(html).toContain('aria-label="对话记录列表"');
    expect(html).toContain('aria-label="对话内容"');
    expect(html).toContain('不含学生电脑上尚未提交的对话');
    expect(html).not.toContain('删除会话');
    expect(html).not.toContain('自动总结');
  });
  it('renders public messages as escaped text with accurate speaker labels and line breaks', () => {
    const html = renderToStaticMarkup(<ConversationMessages assistantLabel="SFLS" messages={[
      { id: 'one', role: 'user', text: '<script>alert(1)</script>\n第二行', at: null },
      { id: 'two', role: 'assistant', text: '已修改', at: 'invalid', truncated: true },
      { id: 'hidden', role: 'tool', text: 'secret tool output', at: null },
      { id: 'analysis', role: 'analysis', text: 'secret analysis', at: null },
    ]} />);
    expect(html).toContain('学生</strong>');
    expect(html).toContain('SFLS</strong>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;\n第二行');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('secret tool output');
    expect(html).not.toContain('secret analysis');
    expect(html).toContain('时间未记录');
    expect(html).toContain('仅预览前段');
  });
});
