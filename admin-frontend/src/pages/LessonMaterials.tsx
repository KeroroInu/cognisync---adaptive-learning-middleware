import { useEffect, useRef, useState } from 'react';
import { classroomAdmin } from '../lib/classroom';
import './LessonMaterials.css';

type Material = { id: string; title: string; kind: string; closed_at: string | null; configuration: { task?: string; support?: string; accept_submissions?: boolean } };
type Receipt = { id: string; name: string; student_id: string; kind: string; created_at: string; size: number };
async function fileRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/admin/classroom${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(typeof data?.detail === 'string' ? data.detail : '文件操作没有完成'); }
  return response;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function LessonMaterials({ sessionId, open }: { sessionId: string; open: boolean }) {
  const [items, setItems] = useState<Material[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''), [task, setTask] = useState(''), [support, setSupport] = useState(''), [phase, setPhase] = useState('practice');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null), [fileId, setFileId] = useState(() => crypto.randomUUID());
  const [acceptSubmissions, setAcceptSubmissions] = useState(true);
  const filePicker = useRef<HTMLInputElement>(null);
  const [receiptId, setReceiptId] = useState(''), [page, setPage] = useState(0), [receipts, setReceipts] = useState<{ total: number; items: Receipt[] } | null>(null);
  async function load() { setItems(await classroomAdmin<Material[]>(`/sessions/${sessionId}/materials`)); }
  useEffect(() => { const controller = new AbortController(); void classroomAdmin<Material[]>(`/sessions/${sessionId}/materials`, undefined, controller.signal).then(setItems).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }); return () => controller.abort(); }, [sessionId]);
  useEffect(() => { if (!receiptId) return; const controller = new AbortController(); setReceipts(null); void classroomAdmin<{ total: number; items: Receipt[] }>(`/materials/${receiptId}/receipts?offset=${page * 50}`, undefined, controller.signal).then(setReceipts).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }); return () => controller.abort(); }, [receiptId, page]);
  async function act(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await work(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); } finally { setBusy(false); } }
  function edited() { setRequestId(crypto.randomUUID()); }
  return <section className="classroom-panel lesson-materials" aria-label="作业与资料"><h2>作业与资料</h2><p>发布作业包，学生下载后在本地完成，再回这里交作品。</p>
    {error && <p role="alert" className="classroom-error">{error}</p>}
    <fieldset disabled={busy || !open}>
      <div className="classroom-actions"><label>选择作业包或资料<input ref={filePicker} type="file" accept=".pdf,.md,.txt,.py,.zip,.png,.jpg,.pptx" onChange={event => { setFile(event.target.files?.[0] || null); setFileId(crypto.randomUUID()); }} /></label>
        {file?.name.toLowerCase().endsWith('.zip') && <label><input type="checkbox" checked={acceptSubmissions} onChange={event => { setAcceptSubmissions(event.target.checked); setFileId(crypto.randomUUID()); }} />学生需要交回作品</label>}
        <button disabled={!file} onClick={() => void act(async () => { if (!file) return; if (file.size > 10 * 1024 * 1024) throw new Error('文件最多 10 MiB'); await fileRequest(`/sessions/${sessionId}/files?request_id=${fileId}&filename=${encodeURIComponent(file.name)}&accept_submissions=${acceptSubmissions && file.name.toLowerCase().endsWith('.zip')}`, { method: 'POST', body: file }); setFile(null); if (filePicker.current) filePicker.current.value = ''; setFileId(crypto.randomUUID()); })}>发布给本班</button></div>
      <details><summary>制作 Mac / Windows 任务包</summary>
        <label>名称<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); edited(); }} placeholder="例如：第一次独立创作" /></label>
        <label>用途<select value={phase} onChange={event => { setPhase(event.target.value); edited(); }}><option value="practice">练习</option><option value="pre">前测</option><option value="post">后测 / 迁移</option></select></label>
        <label>任务要求<textarea rows={4} maxLength={16000} value={task} onChange={event => { setTask(event.target.value); edited(); }} placeholder="让学生做什么、交什么。前后测请使用统一评分要求。" /></label>
        <label>给 Pi 的支持要求<textarea rows={4} maxLength={8000} value={support} onChange={event => { setSupport(event.target.value); edited(); }} placeholder="写明允许怎样帮助、教材范围、注释和填空要求。不要填 API 密钥。" /></label>
        <p>学生首次启动联网安装；用 /login 填老师单独提供的密钥。Windows 脚本权限与机房网络仍需实测，平台关课不能停止本地 Pi。</p>
        <button className="classroom-primary" disabled={!title.trim() || !task.trim() || !support.trim()} onClick={() => void act(async () => { await classroomAdmin(`/sessions/${sessionId}/packages`, { request_id: requestId, title, task, support, phase }); setTitle(''); setTask(''); setSupport(''); edited(); })}>发布任务包</button>
      </details>
    </fieldset>
    {!items.length && <p>还没有发布作业。</p>}
    <ul>{items.map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.closed_at ? '已停止' : '可下载'} · {item.kind === 'pi' || item.configuration.accept_submissions ? '需交作品' : '阅读资料'}</span><div className="classroom-actions"><button onClick={() => { setReceiptId(item.id); setPage(0); }}>查看下载与提交</button>{!item.closed_at && <button disabled={busy} onClick={() => void act(async () => { await classroomAdmin(`/materials/${item.id}/close`, {}); })}>停止下载与提交</button>}</div>{item.configuration.task && <details><summary>发布内容</summary><pre>{item.configuration.task}{'\n\n'}{item.configuration.support}</pre></details>}</li>)}</ul>
    {receipts && <section aria-label="收取记录"><h3>下载与提交 · {receipts.total} 条</h3>{receipts.items.map(receipt => <div className="lesson-receipt" key={receipt.id}><span>{receipt.name} · {receipt.student_id}</span><span>{receipt.kind === 'submission' ? '提交作品' : '发起下载'} · {new Date(receipt.created_at).toLocaleString()}</span>{receipt.kind === 'submission' && <button disabled={busy} onClick={() => void act(async () => saveBlob(await (await fileRequest(`/receipts/${receipt.id}/file`)).blob(), `作品-${receipt.id}.zip`))}>下载原件</button>}</div>)}<div className="classroom-actions"><button disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1}</span><button disabled={(page + 1) * 50 >= receipts.total} onClick={() => setPage(p => p + 1)}>下一页</button></div></section>}
  </section>;
}

type Evidence = { total: number; knowledge_points: string[]; limitation: string; items: { id: string; user_id: string; name: string; student_id: string; at: string; parts: { role: string; kind: string; text: string; mentioned_targets: string[] }[]; payload: unknown }[] };
export function LessonEvidence({ sessionId }: { sessionId: string }) {
  const [source, setSource] = useState('preparation'), [userId, setUserId] = useState(''), [page, setPage] = useState(0), [opened, setOpened] = useState(false), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Evidence | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return; const controller = new AbortController(); setData(null); setError('');
    void classroomAdmin<Evidence>(`/sessions/${sessionId}/evidence?source=${source}&offset=${page * 50}${userId ? `&user_id=${userId}` : ''}`, undefined, controller.signal).then(setData).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [sessionId, source, userId, page, opened, revision]);
  return <details className="classroom-panel lesson-materials" onToggle={event => setOpened(event.currentTarget.open)}><summary>本课证据 · 对话与知识点</summary>
    <div className="classroom-actions"><label>查看<select value={source} onChange={event => { setSource(event.target.value); setPage(0); }}><option value="preparation">准备区代码与对话</option><option value="chat">分组课堂对话</option><option value="event">分组课堂操作</option></select></label><button onClick={() => setRevision(v => v + 1)}>刷新证据</button>{userId && <button onClick={() => { setUserId(''); setPage(0); }}>返回全班</button>}</div>
    {error && <p role="alert">{error}</p>}{data && <><p>本课知识点：{data.knowledge_points.join('、') || '尚未设置'}</p><p>{data.limitation}</p><p>共 {data.total} 条；完整原始数据及已上传作品可在“数据导出”下载。</p>
      {data.items.map(item => <details key={item.id}><summary>{item.name} · {item.student_id} · {new Date(item.at).toLocaleString()}</summary><button onClick={() => { setUserId(item.user_id); setPage(0); }}>只看这位学生</button>{item.parts.map((part, index) => <section key={index}><strong>{({ student: '学生原话', user: '学生原话', assistant: 'AI 提供', student_code: '学生编辑器快照' } as Record<string, string>)[part.role] || part.role}</strong><span> · {part.mentioned_targets.length ? `提及：${part.mentioned_targets.join('、')}` : '未检出同名知识点（不等于没学会）'}</span><pre>{part.text || '无文本'}</pre></section>)}<details><summary>原始记录</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details></details>)}
      <div className="classroom-actions"><button disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1}</span><button disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button><button onClick={() => saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `本课证据-${sessionId}-${source}-${page + 1}.json`)}>导出当前页</button></div>
    </>}
  </details>;
}
