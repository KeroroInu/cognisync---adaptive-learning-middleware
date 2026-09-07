/** Local workspace identity is separate from the real task ID sent to APIs. */
export function createWorkspaceScope(userId: string, taskId: string): string {
  if (!userId || !taskId) throw new Error('工作区缺少学生或任务身份');
  return `learner-v2:${encodeURIComponent(userId)}:${encodeURIComponent(taskId)}`;
}

/** Old pages and queued callbacks must never borrow a newly logged-in token. */
export function captureCurrentSession(): () => boolean {
  const readToken = () => {
    try { return window.localStorage.getItem('cognisync-token'); } catch { return null; }
  };
  const token = readToken();
  return () => Boolean(token) && readToken() === token;
}
