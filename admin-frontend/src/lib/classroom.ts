import type { AssessmentQuestion } from './assessments';

export interface ClassroomPrompt {
  id: string;
  question: AssessmentQuestion;
  questions?: AssessmentQuestion[];
  title?: string;
  published_at: string;
  closed_at: string | null;
  source?: string;
}

export interface ClassroomSession {
  id: string;
  class_name: string;
  title: string;
  state: 'open' | 'closing' | 'closed';
  closes_at: string | null;
  created_at: string;
  is_current: boolean;
  prompt: ClassroomPrompt | null;
  response_count: number;
}

export interface ClassroomResponses {
  prompt: ClassroomPrompt;
  responses: { id: string; user_id: string; student_id: string; name: string; answer: string | null; answers?: Record<string, string | null> | null; created_at: string }[];
  total: number;
  total_students: number;
}

/** A timeout must not be treated as proof that a publish request failed to reach the server. */
export async function classroomAdmin<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(`/api/admin/classroom${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      const detail = result?.detail;
      throw new Error(typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((item: { msg: string }) => item.msg).join('；')
        : response.status === 401 ? '登录已过期，请重新登录教师端。' : '课堂操作失败，请重新读取后再试。');
    }
    return result.data as T;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('连接超时，请先刷新查看结果；再次提交会使用同一请求，不会重复发布。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function validateClassroomQuestion(question: AssessmentQuestion): string {
  if (!question.text.trim()) return '先写下想问学生的问题。';
  if (question.type === 'choice') {
    if (question.options.length < 2) return '单选题至少需要两个选项。';
    if (question.options.length > 12 || question.options.some(option => option.label.length > 300)) return '每题最多 12 个选项，每个选项最多 300 字。';
    if (question.options.some(option => !option.label.trim() || !option.value.trim())) return '每个选项都需要文字和保存值。';
    if (new Set(question.options.map(option => option.value.trim())).size !== question.options.length) return '选项保存值不能重复。';
  }
  return '';
}

export function classroomAnswerLabel(prompt: ClassroomPrompt, answer: string | null): string {
  if (answer === null || answer === '') return '未填写（可选题）';
  return prompt.question.options.find(option => option.value === answer)?.label ?? answer;
}
