import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomQuestion } from '../components/ClassroomGate';
import { Register } from '../views/Register';
import { CLASSROOM_ACCESS_EVENT, classroomDraftKey, classroomFetch, createClassroomPoller, readClassroomDraft, type ClassroomPrompt } from '../services/classroom';
import { codeDraftKey, createCodePersistence, readCodeDraft } from '../services/codePersistence';
import { acknowledgePendingWorkspace, readPendingWorkspace, storePendingWorkspace } from '../data/workspaceDraft';
import type { SnakeProjectWorkspace } from '../data/snakeProjectDemo';

const prompt: ClassroomPrompt = { id: 'publication-a', served_at: '2026-09-13T12:00:00Z', question: {
  id: 'question-a', text: '这一步，你最想先检查什么？', type: 'choice', required: true,
  options: [{ value: 'run', label: '运行结果' }, { value: 'code', label: '代码里的条件' }],
} };
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('classroom registration and question', () => {
  it('classroom registration only asks for name, student ID, password and optional gender', () => {
    const html = renderToStaticMarkup(<Register classroomOnly language="zh" onRegisterSuccess={() => {}} onPendingScale={() => {}} onNavigateToLogin={() => {}} />);
    expect(html).toContain('姓名'); expect(html).toContain('学号'); expect(html).toContain('密码');
    expect(html).toContain('minLength="6"'); expect(html).toContain('显示密码');
    expect(html).toContain('暂不填写'); expect(html).toContain('男'); expect(html).toContain('女');
    expect(html).not.toContain('确认密码'); expect(html).not.toContain('邮箱'); expect(html).not.toContain('例如：高二');
    expect(html).not.toContain('认知'); expect(html).not.toContain('选择测评');
  });
  it('legacy registration retains confirmation and optional class/email', () => {
    const html = renderToStaticMarkup(<Register language="zh" onRegisterSuccess={() => {}} onPendingScale={() => {}} onNavigateToLogin={() => {}} />);
    expect(html).toContain('确认密码'); expect(html).toContain('班级'); expect(html).toContain('邮箱');
  });
  it('shows the teacher question unchanged and one simple response control', () => {
    const html = renderToStaticMarkup(<ClassroomQuestion prompt={prompt} userId="a" onAnswered={() => {}} onDismiss={() => {}} />);
    expect(html).toContain(prompt.question.text); expect(html).toContain('role="dialog"'); expect(html).toContain('稍后回答');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('前测'); expect(html).not.toContain('textarea');
  });
  it('drafts are scoped by student and publication, not reusable question ID', () => {
    values.set(classroomDraftKey('a', prompt.id), JSON.stringify('code'));
    expect(readClassroomDraft('a', prompt)).toBe('code');
    expect(readClassroomDraft('b', prompt)).toBe('');
    expect(readClassroomDraft('a', { ...prompt, id: 'publication-b' })).toBe('');
    values.set(classroomDraftKey('a', prompt.id), JSON.stringify('not-an-option'));
    expect(readClassroomDraft('a', prompt)).toBe('');
  });
  it('unavailable or malformed drafts do not stop the classroom', () => {
    values.set(classroomDraftKey('a', prompt.id), '{broken');
    expect(readClassroomDraft('a', prompt)).toBe('');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readClassroomDraft('a', prompt)).toBe('');
  });
});

describe('polling and access errors', () => {
  it('never overlaps requests and waits three seconds after completion', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const poller = createClassroomPoller(run, () => true);
    const first = poller.refresh(); await poller.refresh();
    await vi.advanceTimersByTimeAsync(12000); expect(run).toHaveBeenCalledTimes(1);
    finish(); await first; await vi.advanceTimersByTimeAsync(2999); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    poller.stop(); finish(); await vi.advanceTimersByTimeAsync(10000); expect(run).toHaveBeenCalledTimes(2);
  });
  it('pauses while hidden and refreshes once visible again', async () => {
    vi.useFakeTimers(); let visible = false;
    const run = vi.fn(async () => {}); const poller = createClassroomPoller(run, () => visible);
    await poller.refresh(); expect(run).not.toHaveBeenCalled();
    visible = true; await poller.refresh(); expect(run).toHaveBeenCalledTimes(1);
    visible = false; await vi.advanceTimersByTimeAsync(10000); expect(run).toHaveBeenCalledTimes(1);
    visible = true; await poller.refresh(); expect(run).toHaveBeenCalledTimes(2); poller.stop();
  });
  it('structured classroom 403 requests a state refresh and preserves login token', async () => {
    const events: Event[] = []; vi.stubGlobal('window', { dispatchEvent: (event: Event) => { events.push(event); } });
    values.set('cognisync-token', 'still-authenticated');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: { code: 'CLASSROOM_CLOSED', message: '老师已结束课堂。' } }), { status: 403 })));
    await expect(classroomFetch('/api/chat')).rejects.toMatchObject({ status: 403, code: 'CLASSROOM_CLOSED', message: '老师已结束课堂。' });
    expect(events[0].type).toBe(CLASSROOM_ACCESS_EVENT); expect(values.get('cognisync-token')).toBe('still-authenticated');
  });
  it('ordinary permission errors are not confused with class closure', async () => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Forbidden' }), { status: 403 })));
    expect((await classroomFetch('/api/research')).status).toBe(403);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('code preservation during classroom closure', () => {
  it('keeps the latest unacknowledged PDT snapshot isolated across refresh and user changes', () => {
    const first: SnakeProjectWorkspace = { version: 1, observations: [], functions: [], evidence: [], path: { orderedCardIds: [], prerequisites: {}, relationKinds: {} }, progress: {}, creativeFunctions: [], savedAt: '2026-09-13T00:00:00Z' };
    const second = { ...first, savedAt: '2026-09-13T00:00:01Z' };
    expect(storePendingWorkspace('student-a:task', first)).toBe(true);
    storePendingWorkspace('student-a:task', second);
    acknowledgePendingWorkspace('student-a:task', first);
    expect(readPendingWorkspace('student-a:task')).toEqual(second);
    expect(readPendingWorkspace('student-b:task')).toBeNull();
    acknowledgePendingWorkspace('student-a:task', second);
    expect(readPendingWorkspace('student-a:task')).toBeNull();
  });
  it('serializes saves, keeps latest local code until it is acknowledged', async () => {
    const releases: (() => void)[] = [];
    const save = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)));
    const queue = createCodePersistence({ scope: 'a:task', save, current: () => true, onStatus: vi.fn(), onStorageError: vi.fn() });
    queue.enqueue('first'); const flushing = queue.flush(); await Promise.resolve();
    queue.enqueue('latest'); queue.flush(true); expect(save).toHaveBeenCalledTimes(1);
    releases.shift()!(); await Promise.resolve(); await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2); expect(readCodeDraft('a:task')).toBe('latest');
    releases.shift()!(); await flushing; expect(readCodeDraft('a:task')).toBeNull();
  });
  it('a rejected final save retains scoped draft and can retry after reopening', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValueOnce(undefined);
    const queue = createCodePersistence({ scope: 'a:task', save, current: () => true, onStatus: vi.fn(), onStorageError: vi.fn() });
    queue.enqueue('unfinished'); await queue.flush(true);
    expect(readCodeDraft('a:task')).toBe('unfinished'); expect(readCodeDraft('b:task')).toBeNull();
    await queue.flush(); expect(save).toHaveBeenCalledTimes(2); expect(values.has(codeDraftKey('a:task'))).toBe(false);
  });
  it('empty flush does not deadlock later saves; changed account never borrows new token', async () => {
    let current = true; const save = vi.fn(async () => {});
    const queue = createCodePersistence({ scope: 'a:task', save, current: () => current, onStatus: vi.fn(), onStorageError: vi.fn() });
    await queue.flush(); queue.enqueue('draft'); current = false; await queue.flush();
    expect(save).not.toHaveBeenCalled(); expect(readCodeDraft('a:task')).toBe('draft');
  });
});
