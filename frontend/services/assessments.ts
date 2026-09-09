export interface AssessmentQuestion {
  id: string; text: string; type: 'choice' | 'text'; required: boolean;
  options: { value: string; label: string }[];
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
