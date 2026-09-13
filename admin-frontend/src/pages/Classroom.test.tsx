import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Classroom } from './Classroom';

describe('classroom initial interface', () => {
  it('loads session state before exposing class controls and keeps research export discoverable', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Classroom /></MemoryRouter>);
    expect(html).toContain('正在读取课堂');
    expect(html).toContain('新课次');
    expect(html).toContain('数据导出 → 课堂研究包');
    expect(html).not.toContain('发布到学生页面');
    expect(html).not.toContain('下课 · 关闭学习入口');
    expect(html).not.toContain('满意');
  });
});
