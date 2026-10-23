import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AssessmentAccess, AssessmentEntry, AssessmentStatus } from '../components/AssessmentEntry';

it('keeps an entry even with no pending questionnaire and marks pending without a fake count', () => {
  const entry = (pending: boolean) => renderToStaticMarkup(<AssessmentAccess.Provider value={{ pending, open: () => {} }}><AssessmentEntry /></AssessmentAccess.Provider>);
  expect(entry(false)).toContain('问卷与测试');
  expect(entry(false)).not.toContain('有待填写内容');
  expect(entry(true)).toContain('有待填写内容');
});

it('distinguishes loading, errors, and an actually empty response', () => {
  const status = (checking: boolean, error: string) => renderToStaticMarkup(<AssessmentStatus checking={checking} error={error} onClose={() => {}} onRetry={() => {}} />);
  expect(status(true, '')).toContain('正在查看老师的安排');
  expect(status(true, '')).not.toContain('暂时没有需要填写');
  expect(status(false, '读取失败')).toContain('role="alert"');
  expect(status(false, '读取失败')).not.toContain('暂时没有需要填写');
  expect(status(false, '')).toContain('暂时没有需要填写');
  expect(status(false, '')).toContain('返回课堂');
});
