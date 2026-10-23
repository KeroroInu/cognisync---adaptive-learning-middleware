import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LessonMaterials } from './LessonMaterials';

describe('experience task composition', () => {
  it('starts from a plain independent task rather than the snake curriculum', () => {
    const html = renderToStaticMarkup(<LessonMaterials sessionId="fixture-experience" open className="体验组" />);
    expect(html).toContain('新建任务 / 上传资料');
    expect(html).toContain('发布给体验组');
    expect(html).toContain('value="experience-');
    expect(html).not.toContain('snake-course');
    expect(html).not.toContain('第 1–5 课');
    expect(html).not.toContain('两班使用相同');
    expect(html).not.toContain('type="checkbox" checked');
  });
  it('distinguishes readable knowledge from optional teacher guidance', () => {
    const html = renderToStaticMarkup(<LessonMaterials sessionId="fixture-experience" open className="体验组" />);
    expect(html).toContain('教材与知识提示 · 学生可见');
    expect(html).toContain('给 SFLS 的引导 · 不显示在学生任务单');
    expect(html).toContain('不是保密文件');
    expect(html).toContain('maxLength="8000"');
  });
});
