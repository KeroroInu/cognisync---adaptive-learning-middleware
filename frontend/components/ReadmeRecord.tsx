import { useEffect, useState } from 'react';

type Record = { receipt_id: string; created_at: string; text: string | null; message: string; task_validation_status?: string };

/** Submission text is never evaluated as HTML or allowed to load remote images. */
export function ReadmeRecord({ materialId, revision }: { materialId: string; revision: number }) {
  const [record, setRecord] = useState<Record | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setRecord(null); setError('');
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/materials/${materialId}/readme`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` }, signal: controller.signal,
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '暂时无法读取作品记录');
      if (!controller.signal.aborted) setRecord(data.data);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [materialId, revision, attempt]);
  return <section className="readme-record" aria-label="作品记录">
    <div className="studio-section-heading"><div><span className="studio-eyebrow">README</span><h2>我的作品记录</h2></div><button onClick={() => setAttempt(value => value + 1)} disabled={loading}>刷新</button></div>
    <p className="studio-muted">在 SFLS 中整理和补充，提交后显示在这里，不必再填一份表。</p>
    {loading ? <p role="status">正在读取…</p> : error ? <p role="alert">{error}</p> : record ? <>
      <small>最近提交 · {new Date(record.created_at).toLocaleString()}</small>
      {record.task_validation_status && record.task_validation_status !== 'matched' && <p role="status">此提交的任务配置需老师核对，原件已保留。</p>}
      {record.text !== null ? <pre className="studio-readme">{record.text}</pre> : <p>{record.message}</p>}
      <small>来自提交包的原文，可能由 AI 整理；不是自动评分或掌握证明。</small>
    </> : <div className="studio-empty"><h3>还没有提交作品</h3><p>完成后让 SFLS 根据对话整理 README，看看哪里还没说清楚，再补上一两句。</p></div>}
  </section>;
}
