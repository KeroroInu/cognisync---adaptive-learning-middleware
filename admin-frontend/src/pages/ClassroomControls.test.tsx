import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Classroom } from './Classroom';
import { ClassroomNotices } from '../components/ClassroomNotices';

describe('simple classroom controls', () => {
  it('offers exactly the two class destinations without a lesson-start workflow', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Classroom /></MemoryRouter>);
    expect(html).toContain('解构班'); expect(html).toContain('开发班');
    for (const old of ['新的一课', '开始上课', '重新开放课堂', '确认下课']) expect(html).not.toContain(old);
  });
  it('keeps notification composition collapsed until requested', () => {
    const html = renderToStaticMarkup(<ClassroomNotices className="解构班" />);
    expect(html).toContain('发给学生');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('撤回通知');
    expect(html).toContain('aria-expanded="false"');
  });
});
