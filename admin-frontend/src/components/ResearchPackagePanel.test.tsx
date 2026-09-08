import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchPackagePanel } from './ResearchPackagePanel';

describe('Research package controls', () => {
  it('exposes filters and explicitly distinguishes evidence from anonymous data', () => {
    const html = renderToStaticMarkup(<ResearchPackagePanel />);
    expect(html).toContain('下载研究包 ZIP');
    expect(html).toContain('常规 AI 协作');
    expect(html).toContain('包含当前知识图谱');
    expect(html).toContain('自由文本仍需脱敏');
    const inputs = html.match(/<input[^>]+type="checkbox"[^>]*>/g) || [];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).not.toContain('checked');
    expect(inputs[1]).toContain('checked');
  });
});
