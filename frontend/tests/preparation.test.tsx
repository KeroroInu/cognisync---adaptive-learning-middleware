import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preparation } from '../views/Preparation';
import { preparationDraftKey, preparationRequest } from '../services/preparation';
afterEach(() => vi.unstubAllGlobals());
describe('共同准备区', () => {
  it('starts with the common task workspace and keeps Python optional', () => {
    const html = renderToStaticMarkup(<Preparation theme="light" userId="new" name="同学" classroom={{ session: null, prompt: null }} onEnter={() => {}} onLogout={() => {}} />);
    expect(html).toContain('Python 小实验'); expect(html).toContain('我的课堂'); expect(html).not.toContain('等待老师开课');
    expect(html).not.toContain('贪吃蛇'); expect(html).not.toContain('L0'); expect(html).not.toContain('知识图谱');
    expect(html).toContain('当前开放'); expect(html).toContain('aria-label="展开任务栏" aria-expanded="false"'); expect(html).not.toContain('向 AI 提问');
  });
  it('scopes drafts by the authenticated student', () => {
    const getItem = vi.fn(() => null); vi.stubGlobal('localStorage', { getItem });
    renderToStaticMarkup(<Preparation theme="dark" userId="student-b" name="乙" classroom={null} onEnter={() => {}} onLogout={() => {}} />);
    expect(getItem).toHaveBeenCalledWith(preparationDraftKey('student-b'));
    expect(preparationDraftKey('student-a')).not.toBe(preparationDraftKey('student-b'));
  });
  it('removes the obsolete web lesson entry even when old configuration remains', () => {
    const classroom = { session: { id: 'session', class_name: '一班', title: '本课', state: 'open' as const, closes_at: null }, prompt: null,
      lesson_entry: { task_id: 'task', lesson_id: 'lesson', session_id: 'session', title: '条件判断', group: 'pdt' } };
    const props = { userId: 'a', name: '甲', theme: 'light' as const, onEnter: () => {}, onLogout: () => {} };
    expect(renderToStaticMarkup(<Preparation {...props} classroom={classroom} />)).not.toContain('网页编程练习');
    expect(renderToStaticMarkup(<Preparation {...props} classroom={{ ...classroom, lesson_entry: null, session: { ...classroom.session, state: 'closed' } }} />)).not.toContain('网页编程练习');
  });
  it('does not retry a failed POST or erase its original error', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'token' });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: '老师已关闭 AI' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(preparationRequest({ kind: 'chat' })).rejects.toThrow('老师已关闭 AI');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
