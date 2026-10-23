import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Classroom } from './Classroom';

describe('classroom initial interface', () => {
  it('loads class content without a start/end control and keeps research export discoverable', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Classroom /></MemoryRouter>);
    expect(html).toContain('正在读取');
    expect(html).not.toContain('新的一课');
    expect(html).not.toContain('开始上课');
    expect(html).toContain('解构班');
    expect(html).toContain('开发班');
    expect(html).toContain('体验组');
    expect(html).toContain('数据导出');
    expect(html).not.toContain('准备一组题');
    expect(html).not.toContain('发布到学生页面');
    expect(html).not.toContain('下课 · 关闭学习入口');
    expect(html).not.toContain('满意');
  });
});
