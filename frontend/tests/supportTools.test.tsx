import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SupportTools } from '../components/SupportTools';

it('uses natural language and keeps research labels out of the student controls', () => {
  const html = renderToStaticMarkup(<SupportTools busy={false} response={{ level: 0, paused: false }} onAction={() => {}} />);
  expect(html).toContain('没理解'); expect(html).toContain('理解了'); expect(html).toContain('再具体一点');
  expect(html).not.toMatch(/L[0-3]|掌握度|能力等级/);
  expect(html).not.toContain('看看完整示例');
});
it('offers restoration without hiding earlier support and confirms a complete example', () => {
  const html = renderToStaticMarkup(<SupportTools busy={false} response={{ level: 2, paused: true }} onAction={() => {}} />);
  expect(html).toContain('继续帮我'); expect(html).toContain('看看完整示例');
});
it('offers a practice exit and never ships an answer inside the question controls', () => {
  const html = renderToStaticMarkup(<SupportTools busy={false} response={{ level: 0, paused: false,
    practice: { instance_id: 'p', question: '会打印几次？', code: 'print(1)', options: ['1', '2'] } }} onAction={() => {}} />);
  expect(html).toContain('回到项目'); expect(html).toContain('看解释'); expect(html).toContain('理解小检查');
  expect(html).not.toContain('部分任务练习');
});
