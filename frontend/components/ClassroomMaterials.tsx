import { useEffect, useRef, useState } from 'react';
type Material = { id: string; title: string; kind: string; filename: string; configuration: { task?: string; accept_submissions?: boolean }; submission?: { count: number; last_submitted_at: string | null } };
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/materials${path}`, {
    ...options, headers: { Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}`, ...options.headers }, signal: options.signal ?? AbortSignal.timeout(60000),
  });
  if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(typeof result?.detail === 'string' ? result.detail : '没有完成，请重试或联系老师。'); }
  return response;
}
export function ClassroomMaterials({ sessionId }: { sessionId?: string }) {
  const [items, setItems] = useState<Material[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ material: string; file: File } | null>(null);
  const [loading, setLoading] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const upload = useRef<{ material: string; file: File; id: string } | null>(null);
  const working = useRef(false), sequence = useRef(0);
  async function load(signal?: AbortSignal) {
    const generation = ++sequence.current;
    const result = await (await request('', { signal })).json();
    if (!signal?.aborted && generation === sequence.current) { setItems(result.data); setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setItems([]); setSelectedFile(null); setLoading(true);
    const poll = async () => {
      try { if (document.visibilityState !== 'hidden' && !working.current) await load(controller.signal); }
      catch { /* Opening the drawer explicitly retries; do not interrupt Python/chat. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 10000);
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => { if (!open) return; dialog.current?.showModal(); return () => { dialog.current?.close(); trigger.current?.focus(); }; }, [open]);
  async function act(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '请求没有完成'); } finally { working.current = false; setBusy(false); setLoading(false); }
  }
  async function download(item: Material, platform: string) {
    const response = await request(`/${item.id}/download?platform=${platform}`, { method: 'POST' });
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = url; link.download = item.kind === 'pi' ? `课堂任务-${platform}.zip` : item.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNotice(item.kind === 'pi' ? '已开始下载。解压后打开 Start；完成并退出 Pi 后，回来上传生成的 submission.zip。' : item.configuration.accept_submissions ? '已开始下载。按包里的任务说明完成，最后将作品压缩成 ZIP 上传。' : '资料已开始下载。');
  }
  async function submit(item: Material, file: File) {
    if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.zip')) throw new Error('请选择不超过 10 MiB 的 ZIP 作品包。不要放环境、依赖或密钥。');
    if (!upload.current || upload.current.file !== file || upload.current.material !== item.id) upload.current = { material: item.id, file, id: crypto.randomUUID() };
    const receipt = (await (await request(`/${item.id}/submit?request_id=${upload.current.id}`, { method: 'POST', body: file })).json()).data;
    ++sequence.current;
    setItems(previous => previous.map(row => row.id === item.id ? { ...row, submission: { count: (row.submission?.count || 0) + 1, last_submitted_at: receipt.created_at } } : row));
    setNotice('作品已提交，老师可以查看了。'); upload.current = null; setSelectedFile(null);
    // A failed status refresh must not turn an accepted upload into a retry.
    try { await load(); } catch { /* The confirmed receipt above remains visible. */ }
  }
  return <><button ref={trigger} onClick={() => { setOpen(true); void act(() => load()); }}>作业与资料{items.length ? ` · ${items.length}` : ''}</button>
    {open && <dialog className="prep-material-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }} aria-label="作业与资料">
      <header><h2>作业与资料</h2><button disabled={busy} onClick={() => setOpen(false)} aria-label="关闭作业与资料">×</button></header>
      <p className="prep-material-guide">下载作业包 → 在电脑上完成 → 上传作品</p>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {error && <button disabled={busy} onClick={() => void act(() => load())}>刷新作业列表</button>}
      {loading ? <p role="status">正在读取作业…</p> : !items.length ? <p>老师还没有发布作业，稍后到这里看。</p> : items.map(item => <section key={item.id}><h3>{item.title}</h3>
        {(item.kind === 'pi' || item.configuration.accept_submissions) && <p className="prep-submission-status">{item.submission?.count ? `已提交 ${item.submission.count} 次 · ${new Date(item.submission.last_submitted_at!).toLocaleString()}` : '还未提交'}</p>}
        {item.configuration.task && <details><summary>任务要求</summary><p>{item.configuration.task}</p></details>}
        <div className="prep-material-actions">{item.kind === 'pi' ? <><button disabled={busy} onClick={() => void act(() => download(item, 'mac'))}>下载 Mac 包</button><button disabled={busy} onClick={() => void act(() => download(item, 'windows'))}>下载 Windows 包</button></> : <button disabled={busy} onClick={() => void act(() => download(item, 'mac'))}>{item.configuration.accept_submissions ? '下载作业包' : '下载资料'}</button>}</div>
        {(item.kind === 'pi' || item.configuration.accept_submissions) && <div className="prep-material-upload">
          <label>选择作品 ZIP<input key={`${item.id}:${item.submission?.count || 0}`} type="file" accept=".zip" disabled={busy || (item.submission?.count || 0) >= 3} onChange={event => { const file = event.target.files?.[0]; setSelectedFile(file ? { material: item.id, file } : null); upload.current = null; }} /></label>
          <button className="prep-primary" disabled={busy || selectedFile?.material !== item.id || (item.submission?.count || 0) >= 3} onClick={() => { if (selectedFile?.material === item.id) void act(() => submit(item, selectedFile.file)); }}>{busy && selectedFile?.material === item.id ? '正在上传…' : '上传作品'}</button>
          <small>{(item.submission?.count || 0) >= 3 ? '已保留 3 次提交，如需修改请联系老师。' : '最多 10 MiB，可提交 3 次，每次作品都会保留。'}</small>
        </div>}
      </section>)}<small>按老师要求附上代码和 AI 对话记录。不要上传密码、密钥或无关的私人文件。</small>
    </dialog>}
  </>;
}
