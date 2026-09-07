import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeacherNotes } from './TeacherNotes';

describe('TeacherNotes initial interface', () => {
  it('keeps interpretation and evidence optional and collapsed', () => {
    const html = renderToStaticMarkup(<TeacherNotes userId="student" />);
    expect(html).toContain('看到的行为');
    expect(html).toContain('学生不需要填写');
    const details = html.match(/<details[^>]*>([\s\S]*?)<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/<details[^>]*\sopen/);
    expect(details).toContain('教师判断');
    expect(details).toContain('关联学习事件');
    expect(details).not.toContain('required');
  });

  it('does not allow saving before records have loaded', () => {
    const html = renderToStaticMarkup(<TeacherNotes userId="student" />);
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('正在读取课堂记录');
    expect(html).toContain('admin-input');
  });
});
