import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Classroom } from './Classroom';
import { TeacherTools } from './TeacherTools';

describe('teacher tools placement', () => {
  it('keeps infrequent installer and API setup out of the classroom landing page', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Classroom /></MemoryRouter>);
    expect(html).toContain('课堂工作台');
    expect(html).toContain('href="/tools"');
    expect(html).not.toContain('SFLS 离线安装包');
    expect(html).not.toContain('student-assistant-settings');
    expect(html).not.toContain('配置 API key');
  });

  it('keeps installer downloads and opt-in assistant configuration available on the tools page', () => {
    const html = renderToStaticMarkup(<MemoryRouter><TeacherTools /></MemoryRouter>);
    expect(html).toContain('classroom-admin teacher-tools-page');
    expect(html).toContain('SFLS 离线安装包');
    expect(html).toContain('学生平台 AI 助手');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('href="/classroom"');
  });
});
