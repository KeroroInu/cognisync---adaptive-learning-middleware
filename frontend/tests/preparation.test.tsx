import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preparation } from '../views/Preparation';
import { preparationDraftKey, preparationRequest } from '../services/preparation';
afterEach(() => vi.unstubAllGlobals());
describe('共同准备区', () => {
  it('without a teacher-started lesson shows Python and AI, not old task or game', () => {
    const html = renderToStaticMarkup(<Preparation userId="new" name="同学" classroom={{ session: null, prompt: null }} onEnter={() => {}} onLogout={() => {}} />);
    expect(html).toContain('Python 小实验'); expect(html).toContain('等待老师开始本课');
    expect(html).not.toContain('贪吃蛇'); expect(html).not.toContain('L0'); expect(html).not.toContain('知识图谱');
    expect(html).toContain('Enter 发送');
  });
  it('scopes drafts by the authenticated student', () => {
    const getItem = vi.fn(() => null); vi.stubGlobal('localStorage', { getItem });
    renderToStaticMarkup(<Preparation userId="student-b" name="乙" classroom={null} onEnter={() => {}} onLogout={() => {}} />);
    expect(getItem).toHaveBeenCalledWith(preparationDraftKey('student-b'));
    expect(preparationDraftKey('student-a')).not.toBe(preparationDraftKey('student-b'));
  });
  it('teacher entry is explicit and closed class does not offer AI', () => {
    const classroom = { session: { id: 'session', class_name: '一班', title: '本课', state: 'open' as const, closes_at: null }, prompt: null,
      lesson_entry: { task_id: 'task', lesson_id: 'lesson', session_id: 'session', title: '条件判断', group: 'pdt' } };
    const props = { userId: 'a', name: '甲', onEnter: () => {}, onLogout: () => {} };
    expect(renderToStaticMarkup(<Preparation {...props} classroom={classroom} />)).toContain('进入本课：');
    expect(renderToStaticMarkup(<Preparation {...props} classroom={{ ...classroom, lesson_entry: null, session: { ...classroom.session, state: 'closed' } }} />)).toContain('老师已关闭 AI');
  });
  it('does not retry a failed POST or erase its original error', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'token' });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: '老师已关闭 AI' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(preparationRequest({ kind: 'chat' })).rejects.toThrow('老师已关闭 AI');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
