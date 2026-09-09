import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { AssessmentConversation } from '../components/AssessmentGate';

const round = { id: 'round-a', phase: 'pre' as const, revision: 1, served_at: '2026-09-09T01:00:00Z', questions: [
  { id: 'q1', text: '第一道题原文', type: 'choice' as const, required: true, options: [{ value: '1', label: '完全同意' }, { value: '2', label: '不同意' }] },
  { id: 'q2', text: '第二道题原文', type: 'text' as const, required: true, options: [] },
] };
afterEach(() => vi.unstubAllGlobals());
it('shows one original question, without a pretest title or AI rewriting', () => {
  const html = renderToStaticMarkup(<AssessmentConversation round={round} userId="student-a" onDone={async () => {}} onLogout={() => {}} />);
  expect(html).toContain('我有几个问题想问你');
  expect(html).toContain('第一道题原文');
  expect(html).toContain('完全同意');
  expect(html).not.toContain('第二道题原文');
  expect(html).not.toContain('前测');
});
it('isolates local drafts by student and round and ignores malformed answers', () => {
  const getItem = vi.fn(() => JSON.stringify({ answers: { q1: 42 }, started_at: round.served_at }));
  vi.stubGlobal('localStorage', { getItem });
  expect(() => renderToStaticMarkup(<AssessmentConversation round={round} userId="student-b" onDone={async () => {}} onLogout={() => {}} />)).not.toThrow();
  expect(getItem).toHaveBeenCalledWith('cognisync:assessment:v1:student-b:round-a');
});
