export interface AssessmentQuestion {
  hint?: string;
  code?: string; skip_label?: string; parent_id?: string | null;
  id: string; text: string; type: 'choice' | 'multiple' | 'text'; required: boolean;
  options: { value: string; label: string; exclusive?: boolean }[];
  max_selections?: number | null;
  show_if?: { question_id: string; values: string[] }[];
}
export type AssessmentAnswers = Record<string, string | string[] | null>;
export function visibleQuestions(questions: AssessmentQuestion[], answers: AssessmentAnswers) {
  const visible = new Set<string>();
  return questions.filter(q => {
    const show = (!q.parent_id || visible.has(q.parent_id)) && (q.show_if || []).every(c => visible.has(c.question_id) && c.values.some(v => Array.isArray(answers[c.question_id]) ? (answers[c.question_id] as string[]).includes(v) : answers[c.question_id] === v));
    if (show) visible.add(q.id);
    return show;
  });
}
export function cleanVisibleAnswers(questions: AssessmentQuestion[], answers: AssessmentAnswers): AssessmentAnswers {
  return Object.fromEntries(visibleQuestions(questions, answers).filter(q => q.id in answers).map(q => [q.id, answers[q.id]]));
}
export function toggleMultiple(q: AssessmentQuestion, current: string[], value: string): string[] {
  if (current.includes(value)) return current.filter(v => v !== value);
  if (q.options.find(o => o.value === value)?.exclusive) return [value];
  const next = current.filter(v => !q.options.find(o => o.value === v)?.exclusive);
  return next.length >= (q.max_selections || q.options.length) ? current : [...next, value];
}
export function validDraftAnswer(q: AssessmentQuestion, answer: unknown): answer is string | string[] | null {
  if (answer === null) return true;
  if (q.type === 'multiple') return Array.isArray(answer) && answer.length <= (q.max_selections || q.options.length) && new Set(answer).size === answer.length
    && answer.every(v => typeof v === 'string' && q.options.some(o => o.value === v)) && (answer.length <= 1 || !answer.some(v => q.options.find(o => o.value === v)?.exclusive));
  return typeof answer === 'string' && answer.length <= 4000 && (answer !== '__skip__' || Boolean(q.skip_label)) && (q.type === 'text' || answer === '' || q.options.some(o => o.value === answer));
}
export interface PendingAssessment {
  id: string; phase: 'pre' | 'post'; revision: number; served_at: string;
  questions: AssessmentQuestion[];
}

export async function assessmentRequest<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/assessments${path}`, {
    signal: controller.signal,
    cache: 'no-store',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(typeof result.detail === 'string' ? result.detail : '暂时没能保存，请稍后重试。');
  return result.data as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接超时，答案仍在本机，请重试。');
    throw error;
  } finally { window.clearTimeout(timeout); }
}
export const getPendingAssessment = () => assessmentRequest<PendingAssessment | null>('/pending');
export const getAssessmentStatus = () => assessmentRequest<Pick<PendingAssessment, 'id' | 'revision'> | null>('/status');
