import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import catalog from '../../backend/app/resources/instrument_drafts_20261012.json';
import { AssessmentConversation } from '../components/AssessmentGate';
import { visibleQuestions, cleanVisibleAnswers, validDraftAnswer, type AssessmentQuestion } from '../services/assessments';

it('keeps 19 main background questions, branches like Word, clears hidden supplements', () => {
  const questions = catalog.instruments[0].draft.questions as AssessmentQuestion[];
  expect(questions.filter(q => !q.parent_id)).toHaveLength(19);
  const visible = visibleQuestions(questions, { q3: '5', q8: '1' });
  expect(visible.map(q => q.id)).toContain('q14');
  expect(visible.map(q => q.id)).not.toContain('q10');
  expect(cleanVisibleAnswers(questions, { q1: ['2'], q1_other: '旧补充' })).not.toHaveProperty('q1_other');
  const q10 = questions.find(q => q.id === 'q10')!;
  expect(validDraftAnswer(q10, '__skip__')).toBe(true);
  expect(validDraftAnswer({ ...q10, skip_label: '' }, '__skip__')).toBe(false);
});

it('renders code with preserved whitespace, and the unknown checkbox without conflating missing', () => {
  const round = { id: 'preview', served_at: '2026-10-12T00:00:00Z', questions: [{ id: 'q', text: '工具名称', type: 'text' as const, required: false, options: [], skip_label: '不记得名称', code: 'for i in range(2):\n    print(i)' }] };
  const html = renderToStaticMarkup(<AssessmentConversation round={round} userId="preview" onDone={async () => {}} onLogout={() => {}} />);
  expect(html).toContain('<pre class="question-code"><code>');
  expect(html).toContain('\n    print(i)');
  expect(html).toContain('不记得名称');
  expect(html).toContain('type="checkbox"');
});
