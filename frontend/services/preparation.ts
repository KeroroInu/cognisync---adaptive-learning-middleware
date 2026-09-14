export interface PreparationRecord {
  id: string; kind: 'save' | 'run' | 'chat'; created_at: string; session_id: string | null;
  payload: { request: { code: string; message: string; output: string[]; error: string }; status: string; reply?: string };
}
export async function preparationRequest<T>(body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/preparation/records`, {
      method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(typeof result?.detail === 'string' ? result.detail : '没有保存成功，请稍后重试。');
    return result.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接超时，先刷新查看记录；草稿仍在本机。');
    throw error;
  } finally { clearTimeout(timer); }
}
export const preparationDraftKey = (userId: string) => `cognisync:preparation:v1:${userId}`;
