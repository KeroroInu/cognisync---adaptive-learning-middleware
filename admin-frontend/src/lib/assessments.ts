import { createRequestId } from './requestId';

export interface AssessmentQuestion {
  hint?: string;
  code?: string; skip_label?: string; parent_id?: string | null;
  id: string; text: string; type: 'choice' | 'multiple' | 'text'; required: boolean;
  options: { value: string; label: string; exclusive?: boolean }[];
  max_selections?: number | null;
  show_if?: { question_id: string; values: string[] }[];
}
export interface AssessmentDraft {
  phase: 'pre' | 'post'; name: string; class_name: string; source: string; questions: AssessmentQuestion[];
}
export interface AssessmentRound extends AssessmentDraft {
  id: string; enabled: boolean; revision: number; published_at: string | null; response_count: number;
}
export async function assessmentAdmin<T>(path = '', body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/admin/assessments${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    const message = typeof result.detail === 'string' ? result.detail
      : Array.isArray(result.detail) ? result.detail.map((d: {msg: string}) => d.msg).join('；') : '操作失败，请重试';
    throw new Error(message);
  }
  return result.data as T;
}
export const emptyQuestion = (): AssessmentQuestion => ({ id: `q_${createRequestId().replace(/-/g, '')}`, text: '', type: 'choice', required: true,
  options: [{ value: '1', label: '' }, { value: '2', label: '' }] });
