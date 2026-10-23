import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Assessments } from './Assessments';

describe('assessment teacher workspace', () => {
  it('separates finding a paper from checking this class, without pre/post screens', () => {
    const html = renderToStaticMarkup(<Assessments />);
    expect(html).toContain('题本库');
    expect(html).toContain('aria-label="可发放题本"');
    expect(html).toContain('aria-label="本班发放记录"');
    expect(html).toContain('aria-label="搜索题本"');
    expect(html).toContain('aria-label="刷新本班答卷数"');
    expect(html).toContain('体验组');
    expect(html).toContain('自定义题本');
    expect(html).not.toContain('首次填写');
    expect(html).not.toContain('课后填写');
  });
});
