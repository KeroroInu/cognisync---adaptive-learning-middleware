import { useEffect, useState } from 'react';
import { TEACHING_CLASSES } from '../lib/teachingClasses';

interface AdviceItem {
  id: string; name: string; student_id: string; class_name: string | null;
  content: string; received_at: string; client_context: { title: string };
}

export function StudentAdvicePanel() {
  const [open, setOpen] = useState(false);
  const [className, setClassName] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ items: AdviceItem[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError(''); setData(null);
    const query = new URLSearchParams({ limit: '20', offset: String(offset) });
    if (className) query.set('class_name', className);
    void fetch(`/api/admin/advice?${query}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }, signal: controller.signal,
    }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(response.status === 401 ? '请重新登录教师端。' : '暂时无法读取建议，请重试。');
      if (!disposed) setData(result.data);
    }).catch(error => {
      if (!disposed) setError(controller.signal.aborted ? '读取超时，请重试。' : error.message);
    }).finally(() => { clearTimeout(timer); if (!disposed) setBusy(false); });
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [open, className, offset, refresh]);
  return <details className="student-advice" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>学生建议</summary>
    {open && <div>
      <p>学生通过 SFLS 的 /advice 发送，保留原文。建议也包含在上方数据下载中，不作为能力得分。</p>
      <div className="advice-controls">
        <label>班级 <select value={className} onChange={event => { setClassName(event.target.value); setOffset(0); }}>
          <option value="">全部班级</option>{TEACHING_CLASSES.map(item => <option key={item.name}>{item.name}</option>)}
        </select></label>
        <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新</button>
      </div>
      {busy && <p role="status">正在读取…</p>}
      {error && <p role="alert">{error}</p>}
      {data && <>
        <p>共 {data.total} 条{data.total === 0 ? '，收到后会显示在这里。' : ''}</p>
        {data.items.map(item => <article key={item.id}>
          <header><strong>{item.name} · {item.student_id}</strong><span>{item.class_name || '未分班'} · {new Date(item.received_at).toLocaleString('zh-CN')}</span></header>
          <p className="advice-content">{item.content}</p>
          <small>任务：{item.client_context.title}（客户端上报）</small>
        </article>)}
        {data.total > 20 && <nav aria-label="学生建议分页">
          <button type="button" disabled={offset === 0 || busy} onClick={() => setOffset(value => Math.max(0, value - 20))}>上一页</button>
          <span>第 {Math.floor(offset / 20) + 1} 页</span>
          <button type="button" disabled={offset + 20 >= data.total || busy} onClick={() => setOffset(value => value + 20)}>下一页</button>
        </nav>}
      </>}
    </div>}
  </details>;
}
