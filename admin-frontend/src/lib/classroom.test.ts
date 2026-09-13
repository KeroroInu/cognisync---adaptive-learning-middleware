import { afterEach, describe, expect, it, vi } from 'vitest';
import { classroomAdmin, classroomAnswerLabel, validateClassroomQuestion, type ClassroomPrompt } from './classroom';
import type { AssessmentQuestion } from './assessments';

const question: AssessmentQuestion = {
  id: 'q1', text: '你先检查了什么？', type: 'choice', required: true,
  options: [{ value: '1', label: '运行结果' }, { value: '2', label: '代码' }],
};
const prompt: ClassroomPrompt = { id: 'p1', question, published_at: '2026-09-13T01:00:00Z', closed_at: null };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('classroom question and answer data', () => {
  it('does not allow empty questions or incomplete options to be published', () => {
    expect(validateClassroomQuestion({ ...question, text: '  ' })).not.toBe('');
    expect(validateClassroomQuestion({ ...question, options: [{ value: '1', label: '  ' }] })).not.toBe('');
    expect(validateClassroomQuestion({ ...question, options: [{ value: '1', label: 'A' }, { value: '1 ', label: 'B' }] })).toContain('不能重复');
    expect(validateClassroomQuestion(question)).toBe('');
    expect(validateClassroomQuestion({ ...question, type: 'text', options: [] })).toBe('');
  });
  it('displays the frozen option label without treating unanswered as a score', () => {
    expect(classroomAnswerLabel(prompt, '1')).toBe('运行结果');
    expect(classroomAnswerLabel(prompt, null)).toBe('未填写（可选题）');
    expect(classroomAnswerLabel(prompt, 'my own answer')).toBe('my own answer');
  });
});

describe('classroom API', () => {
  function setupFetch(response: unknown, status = 200) {
    vi.stubGlobal('localStorage', { getItem: () => 'teacher-token' });
    const fetcher = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => response });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  it('uses the current origin and teacher authorization for read requests', async () => {
    const fetcher = setupFetch({ success: true, data: [prompt] });
    expect(await classroomAdmin('/sessions')).toEqual([prompt]);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/classroom/sessions', expect.objectContaining({
      method: 'GET', body: undefined, headers: expect.objectContaining({ Authorization: 'Bearer teacher-token' }),
    }));
  });
  it('keeps a logical publish request id in the body for backend deduplication', async () => {
    const fetcher = setupFetch({ success: true, data: prompt });
    const body = { question, request_id: 'same-request-id' };
    await classroomAdmin('/sessions/s1/prompts', body);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/classroom/sessions/s1/prompts', expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });
  it('shows validation errors instead of silently treating failures as success', async () => {
    setupFetch({ detail: [{ msg: '本节课已结束' }] }, 409);
    await expect(classroomAdmin('/sessions/s1/prompts', { question })).rejects.toThrow('本节课已结束');
  });
  it('aborts after a bounded wait and warns that a write may already have reached the server', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', { getItem: () => 'teacher-token' });
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const pending = expect(classroomAdmin('/sessions/s1/prompts', { question })).rejects.toThrow('不会重复发布');
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
  });
});
