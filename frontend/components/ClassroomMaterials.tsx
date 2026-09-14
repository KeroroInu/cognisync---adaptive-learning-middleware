import { useEffect, useRef, useState } from 'react';
type Material = { id: string; title: string; kind: string; filename: string; configuration: { task?: string } };
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
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const upload = useRef<{ material: string; file: File; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setItems([]);
    const poll = async () => {
      try { if (document.visibilityState !== 'hidden') { const result = await (await request('', { signal: controller.signal })).json(); if (!controller.signal.aborted) setItems(result.data); } }
      catch { /* Opening the drawer explicitly retries; do not interrupt Python/chat. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 10000);
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => { if (!open) return; dialog.current?.showModal(); return () => { dialog.current?.close(); trigger.current?.focus(); }; }, [open]);
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '请求没有完成'); } finally { setBusy(false); }
  }
  async function download(item: Material, platform: string) {
    const response = await request(`/${item.id}/download?platform=${platform}`, { method: 'POST' });
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = url; link.download = item.kind === 'pi' ? `课堂任务-${platform}.zip` : item.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNotice('已开始下载。任务包先解压，再打开 Start；做完后回来交 submission.zip。');
  }
  async function submit(item: Material, file: File) {
    if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.zip')) throw new Error('请选择不超过 10 MiB 的 submission.zip');
    if (!upload.current || upload.current.file !== file || upload.current.material !== item.id) upload.current = { material: item.id, file, id: crypto.randomUUID() };
    await request(`/${item.id}/submit?request_id=${upload.current.id}`, { method: 'POST', body: file });
    setNotice('作品已收到。原文件和上传时间会一起保存。'); upload.current = null;
  }
  return <><button ref={trigger} onClick={() => { setOpen(true); void act(async () => setItems((await (await request('')).json()).data)); }}>课堂资料{items.length ? ` · ${items.length}` : ''}</button>
    {open && <dialog className="prep-material-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }} aria-label="课堂资料">
      <header><h2>老师发来的资料</h2><button disabled={busy} onClick={() => setOpen(false)} aria-label="关闭课堂资料">×</button></header>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!items.length ? <p>暂时没有资料。老师发布后会出现在这里。</p> : items.map(item => <section key={item.id}><h3>{item.title}</h3>
        {item.configuration.task && <details><summary>任务要求</summary><p>{item.configuration.task}</p></details>}
        <div className="prep-material-actions">{item.kind === 'pi' ? <><button disabled={busy} onClick={() => void act(() => download(item, 'mac'))}>下载 Mac 包</button><button disabled={busy} onClick={() => void act(() => download(item, 'windows'))}>下载 Windows 包</button><label>交作品<input type="file" accept=".zip" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void act(() => submit(item, file)); }} /></label></> : <button disabled={busy} onClick={() => void act(() => download(item, 'mac'))}>下载文件</button>}</div>
      </section>)}<small>作品包含本任务的代码、AI 对话和操作时间。不要放个人隐私或密钥。</small>
    </dialog>}
  </>;
}
