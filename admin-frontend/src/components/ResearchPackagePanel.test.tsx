import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResearchPackagePanel } from './ResearchPackagePanel';

describe('Research package controls', () => {
  it('exposes filters and explicitly distinguishes evidence from anonymous data', () => {
    const html = renderToStaticMarkup(<ResearchPackagePanel />);
    expect(html).toContain('下载实验数据');
    expect(html).toContain('解构班');
    expect(html).toContain('开发班');
    expect(html).toContain('<option value="体验组">体验组</option>');
    expect(html).not.toContain('实验组');
    expect(html).toContain('<details');
    expect(html).toContain('包含当前知识图谱');
    expect(html).toContain('自由文本仍需脱敏');
    const inputs = html.match(/<input[^>]+type="checkbox"[^>]*>/g) || [];
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).not.toContain('checked');
    expect(inputs[1]).toContain('checked');
    expect(inputs[2]).toContain('checked');
  });
});
