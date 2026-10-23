import { afterEach, expect, it, vi } from 'vitest';
import { draftKey, emptyAnswers, readDraft, worksheetText, type WorksheetTemplate } from '../services/worksheet';

const template: WorksheetTemplate = { lesson_id: 'L03', template_version: '1', title: '我的任务', objective: '移动一步', rules: [], acceptance: ['保持蛇长'], analysis_prompt: '哪些部分配合？', change_prompt: '先验证哪一步？', test_hint: '移动前后对照' };
afterEach(() => vi.unstubAllGlobals());
it('separates local drafts by user and task, rejects corrupted data', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) });
  values.set(draftKey('u', 'a'), JSON.stringify({ schema: 1, userId: 'u', materialId: 'a', baseRevision: 2, requestId: 'retry-id', action: 'plan', answers: { ...emptyAnswers(), analysis_note: '只有本人' } }));
  expect(readDraft('u', 'a')?.requestId).toBe('retry-id');
  expect(readDraft('v', 'a')).toBeNull(); expect(readDraft('u', 'b')).toBeNull();
  values.set(draftKey('v', 'a'), values.get(draftKey('u', 'a'))!);
  expect(readDraft('v', 'a')).toBeNull();
  values.set(draftKey('u', 'a'), '{bad'); expect(readDraft('u', 'a')).toBeNull();
});
it('labels copied unsynced text and human test reports honestly', () => {
  const text = worksheetText(template, { ...emptyAnswers(), analysis_note: '待验证', tests: [{ case: '右', expected: '1', actual: '1', status: 'passed', next_action: '' }] }, '本机未同步草稿');
  expect(text).toContain('本机未同步草稿'); expect(text).toContain('通过（学生报告）'); expect(text).toContain('待验证');
  expect(text).toContain('暂未说明');
  expect(worksheetText(template, { ...emptyAnswers(), record_source: 'ai_assisted' }, 'v2')).toContain('AI 帮我整理');
});
