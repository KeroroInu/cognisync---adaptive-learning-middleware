import type { AssessmentQuestion } from './assessments';

export const CLASSROOM_ACCESS_EVENT = 'cognisync:classroom-access';
export const CLASSROOM_CLOSING_EVENT = 'cognisync:classroom-closing';
export const CLASSROOM_OPEN_EVENT = 'cognisync:classroom-open';
export interface ClassroomSession {
  id: string; class_name: string; title: string;
  state: 'open' | 'closing' | 'closed'; closes_at: string | null;
}
export interface ClassroomPrompt { id: string; question: AssessmentQuestion; questions?: AssessmentQuestion[]; title?: string; served_at: string }
export interface LessonEntry { task_id: string; lesson_id: string; session_id: string; title: string; group: string }
export interface ClassroomState { session: ClassroomSession | null; prompt: ClassroomPrompt | null; lesson_entry?: LessonEntry | null }

export class ClassroomError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ClassroomError'; }
}

/** Observe access denials without replacing fetch globally or treating class closure as logout. */
export async function classroomFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 403) {
    const result = await response.clone().json().catch(() => null);
    const detail = result?.detail;
    if (detail?.code === 'CLASSROOM_CLOSED' || detail?.code === 'CLASSROOM_CLOSING') {
      window.dispatchEvent(new CustomEvent(CLASSROOM_ACCESS_EVENT, { detail: { code: detail.code } }));
      throw new ClassroomError(detail.message || (detail.code === 'CLASSROOM_CLOSED' ? '老师已结束课堂。' : '课堂即将结束，请等待保存。'), response.status, detail.code);
    }
  }
  return response;
}

async function classroomRequest<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await classroomFetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/classroom${path}`, {
      signal: controller.signal, method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      const detail = result.detail;
      const message = typeof detail === 'string' ? detail : detail?.message;
      throw new ClassroomError(message || (response.status === 401 ? '登录已过期，请重新登录。' : '暂时没有连接上，请重试。'), response.status, detail?.code);
    }
    return result.data as T;
  } catch (error) {
    if (controller.signal.aborted) throw new ClassroomError('连接超时，未提交的回答仍保留在本机。', 0);
    throw error;
  } finally { window.clearTimeout(timeout); }
}
export const getClassroomState = () => classroomRequest<ClassroomState>('/state');
export const answerClassroomPrompt = (id: string, answer: string | null) => classroomRequest(`/prompts/${encodeURIComponent(id)}/responses`, { answer });
export const answerClassroomSet = (id: string, answers: Record<string, string | null>, started_at: string) => classroomRequest(`/prompts/${encodeURIComponent(id)}/responses`, { answers, started_at });

export const classroomDraftKey = (userId: string, promptId: string) => `cognisync:classroom-answer:v1:${userId}:${promptId}`;
export function readClassroomDraft(userId: string, prompt: ClassroomPrompt): string {
  try {
    const answer = JSON.parse(localStorage.getItem(classroomDraftKey(userId, prompt.id)) || 'null');
    if (typeof answer === 'string' && answer.length <= 4000 && (prompt.question.type === 'text' || prompt.question.options.some(option => option.value === answer))) return answer;
  } catch { /* Ignore unavailable or invalid local drafts; never import another student's answer. */ }
  return '';
}

/** A single timer schedules the next request only after the previous request settled. */
export function createClassroomPoller(run: () => Promise<void>, visible: () => boolean, interval = 3000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  const refresh = async () => {
    if (stopped || running || !visible()) return;
    clearTimeout(timer); running = true;
    try { await run(); }
    finally { running = false; if (!stopped) timer = setTimeout(() => void refresh(), interval); }
  };
  return { refresh, stop: () => { stopped = true; clearTimeout(timer); } };
}
