import { Component, lazy, Suspense, useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { BookOpen, Download, FileText, FolderOpen, PenTool, Upload, Check, ChevronRight, Briefcase, PanelLeft } from 'lucide-react';
import { ReadmeRecord } from './ReadmeRecord';
import { useCompanionToolbox } from './CompanionTools';
import './ClassroomMaterials.css';
import { SflsGuide } from './SflsGuide';
import { StudentInstaller } from './StudentInstaller';
import { TaskInstructions } from './TaskInstructions';
const TaskDesign = lazy(() => import('./TaskDesign').then(module => ({ default: module.TaskDesign })));
class TaskDesignBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section role="alert" className="studio-document"><h2>工具没有成功打开</h2><p>已保存的设计不会丢失。请重新载入页面后再试。</p><button onClick={() => window.location.reload()}>重新载入工具</button></section>;
    return this.props.children;
  }
}
import type { WorksheetTemplate } from '../services/worksheet';
type Material = { max_submissions?: number; id: string; title: string; kind: string; filename: string; configuration: { task?: string; phase?: string; curriculum?: string; inherit_previous?: boolean; accept_submissions?: boolean; worksheet?: WorksheetTemplate }; submission?: { count: number; last_submitted_at: string | null } };
async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/materials${path}`, {
    ...options, headers: { Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}`, ...options.headers }, signal: options.signal ?? AbortSignal.timeout(60000),
  });
  if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(typeof result?.detail === 'string' ? result.detail : '没有完成，请重试或联系老师。'); }
  return response;
}
export function ClassroomMaterials({ sessionId, userId = '', embedded = false, onToolboxOpen, onPython }: { sessionId?: string; userId?: string; embedded?: boolean; onToolboxOpen?: () => void; onPython?: () => void }) {
  const [items, setItems] = useState<Material[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ material: string; file: File } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarId = useId();
  const mainPanel = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'task' | 'record' | 'requirements' | 'board' | 'guide' | 'tools'>('task');
  const [designTool, setDesignTool] = useState<'requirements' | 'board'>('requirements');
  const [designId, setDesignId] = useState(''), [dirtyDesign, setDirtyDesign] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const upload = useRef<{ material: string; file: File; id: string } | null>(null);
  const working = useRef(false), sequence = useRef(0);
  const previousTask = useRef<string | undefined>(undefined);
  async function load(signal?: AbortSignal) {
    const generation = ++sequence.current;
    const result = await (await request('', { signal })).json();
    if (!signal?.aborted && generation === sequence.current) {
      const nextItems: Material[] = result.data;
      const nextTask = nextItems.find(item => ['pi', 'sfls'].includes(item.kind) || item.configuration.accept_submissions)?.id;
      if (previousTask.current !== nextTask) {
        if (previousTask.current) setNotice(nextTask ? '老师已切换任务。未保存的设计草稿仍留在本机。' : '本次任务已收起，等待老师安排。');
        setSelectedId(''); setSelectedFile(null); setDesignId(''); setDirtyDesign(''); setView('task');
        previousTask.current = nextTask;
      }
      setItems(nextItems); setLoading(false); setError('');
    }
  }
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    previousTask.current = undefined;
    setItems([]); setSelectedId(''); setSelectedFile(null); setLoading(true); setDesignId(''); setDirtyDesign(''); setView('task'); setSidebarOpen(false); setNotice(''); setError('');
    const poll = async () => {
      try { if (document.visibilityState !== 'hidden' && !working.current) await load(controller.signal); }
      catch (cause) { if (!controller.signal.aborted && embedded) { setError(cause instanceof Error ? cause.message : '任务列表暂时没有连接上'); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 10000);
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, embedded, userId]);
  useEffect(() => { if (!open) return; dialog.current?.showModal(); return () => { dialog.current?.close(); trigger.current?.focus(); }; }, [open]);
  async function act(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '请求没有完成'); } finally { working.current = false; setBusy(false); setLoading(false); }
  }
  async function download(item: Material, platform: string) {
    if (dirtyDesign) throw new Error('请先保存设计，再下载；新包才能带上你的修改。');
    const response = await request(`/${item.id}/download?platform=${platform}`, { method: 'POST' });
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    const lesson = item.configuration.worksheet?.lesson_id;
    link.href = url; link.download = ['pi', 'sfls'].includes(item.kind) ? `${item.kind === 'sfls' ? 'SFLS' : '课堂任务'}${lesson ? `-${lesson}` : ''}-${platform}.zip` : item.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNotice(item.kind === 'sfls' ? '已开始下载。解压后运行 SFLS；用 /submit 提交，或把 /pack 生成的 ZIP 上传到这里。/submit 失败时，可先退出 SFLS，再压缩整个本人任务文件夹补交。首次使用请按老师说明安装。' : item.kind === 'pi' ? '已开始下载。解压后打开 Start；完成并退出 Pi 后，回来上传生成的 submission.zip。' : item.configuration.accept_submissions ? '已开始下载。按包里的任务说明完成，最后将作品压缩成 ZIP 上传。' : '资料已开始下载。');
  }
  async function submit(item: Material, file: File) {
    const maxSizeMiB = item.kind === 'sfls' ? 50 : 10;
    if (file.size > maxSizeMiB * 1024 * 1024 || !file.name.toLowerCase().endsWith('.zip')) throw new Error(`请选择不超过 ${maxSizeMiB} MiB 的 ZIP 作品包。不要放环境、依赖或密钥。`);
    if (!upload.current || upload.current.file !== file || upload.current.material !== item.id) upload.current = { material: item.id, file, id: crypto.randomUUID() };
    const endpoint = item.kind === 'sfls' ? 'manual-submit' : 'submit';
    const receipt = (await (await request(`/${item.id}/${endpoint}?request_id=${upload.current.id}`, { method: 'POST', body: file, ...(item.kind === 'sfls' ? { signal: AbortSignal.timeout(180000) } : {}) })).json()).data;
    ++sequence.current;
    setItems(previous => previous.map(row => row.id === item.id ? { ...row, submission: { count: (row.submission?.count || 0) + 1, last_submitted_at: receipt.created_at } } : row));
    const validation = receipt.detail?.task_validation;
    const messages = [item.kind === 'sfls' ? '服务器已收到作品，老师可以查看了。' : '作品已提交，老师可以查看了。'];
    if (item.kind === 'sfls') {
      const imported = receipt.detail?.manual_import;
      if (imported) {
        if (imported.redaction_count > 0) messages.push('已遮蔽误发的密钥，其余记录已保留。');
        const evidence = imported.evidence_presence;
        const missing = [!evidence?.code && '代码', !evidence?.events && '过程事件', !evidence?.sessions && '对话记录'].filter(Boolean);
        if (missing.length) messages.push(`这个包没有找到${missing.join('、')}，请联系老师补交对应文件。`);
      } else messages.push('代码和对话记录是否齐全尚未确认，请联系老师核对。');
    }
    if (validation && validation.status !== 'matched') messages.push(validation.message || '作品已保留，任务配置需要老师核对。');
    setNotice(messages.join(' ')); upload.current = null; setSelectedFile(null);
    // A failed status refresh must not turn an accepted upload into a retry.
    try { await load(); } catch { /* The confirmed receipt above remains visible. */ }
  }
  const activeId = items.some(item => item.id === selectedId) ? selectedId : items[0]?.id;
  const active = items.find(item => item.id === activeId);
  const showHandoff = !!active && !['requirements', 'board', 'guide', 'tools'].includes(view);
  useEffect(() => { mainPanel.current?.scrollTo({ top: 0 }); }, [activeId, view]);
  const switchView = (next: typeof view) => {
    setView(next);
    if ((next === 'requirements' || next === 'board') && active) { setDesignId(active.id); setDesignTool(next); }
  };
  useCompanionToolbox(embedded || open, () => { onToolboxOpen?.(); setView('tools'); if (!embedded) setOpen(true); });
  const content = <>
    <header className="studio-toolbar">
      <button className="studio-sidebar-toggle" aria-label={sidebarOpen ? '收起任务栏' : '展开任务栏'} aria-expanded={sidebarOpen} aria-controls={sidebarId} onClick={() => setSidebarOpen(value => !value)}><PanelLeft size={18} /></button>
      <nav aria-label="任务工具">
        <button aria-pressed={view === 'task'} onClick={() => switchView('task')}><BookOpen size={16} />任务</button>
        <button aria-pressed={view === 'record'} disabled={!active} onClick={() => switchView('record')}><FileText size={16} />作品记录</button>
        <button aria-pressed={view === 'requirements'} disabled={active?.kind !== 'sfls'} onClick={() => switchView('requirements')}><FileText size={16} />需求文档</button>
        <button aria-pressed={view === 'board'} disabled={active?.kind !== 'sfls'} onClick={() => switchView('board')}><PenTool size={16} />架构画板</button>
        <button aria-pressed={view === 'tools'} onClick={() => switchView('tools')}><Briefcase size={16} />工具包</button>
        <button aria-pressed={view === 'guide'} onClick={() => switchView('guide')}>使用指南</button>
        <StudentInstaller />
      </nav>
      {!embedded && <button disabled={busy || !!dirtyDesign} onClick={() => setOpen(false)} aria-label="关闭作业与资料">×</button>}
    </header>
    {error && <div className="studio-notice is-error" role="alert">{error}<button disabled={busy} onClick={() => void act(() => load())}>重试</button></div>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    <div className={`studio-body${showHandoff ? ' has-handoff' : ''}${sidebarOpen ? ' has-sidebar' : ''}`}>
      <aside id={sidebarId} hidden={!sidebarOpen} className="studio-lessons" aria-label="当前任务与资料">
        <h2>当前开放 <span>{items.length.toString().padStart(2, '0')}</span></h2>
        {loading ? <p role="status">读取中…</p> : items.map((item, index) => <button key={item.id} aria-pressed={activeId === item.id} disabled={busy || (!!dirtyDesign && activeId !== item.id)} onClick={() => { if (activeId === item.id) return; setSelectedId(item.id); setDesignId(''); setView('task'); setSelectedFile(null); setError(''); setNotice(''); }}>
          <span className="studio-lesson-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.submission?.count ? '已提交' : item.kind === 'file' && !item.configuration.accept_submissions ? '阅读资料' : '待完成'}</small></span>{item.submission?.count ? <Check size={15} /> : <ChevronRight size={15} />}
        </button>)}
        {!loading && !items.length && <p className="studio-muted">老师发布后会出现在这里。</p>}
        <div className="studio-lesson-footer">SFLS / 课堂创作</div>
      </aside>
      <div className="studio-main" ref={mainPanel}>
        {view === 'guide' ? <div className="studio-document"><span className="studio-eyebrow">GET STARTED</span><h2>从这里开始</h2><SflsGuide expanded /></div> : view === 'tools' ? <div className="studio-document">
          <span className="studio-eyebrow">贪贪的工具包</span><h2>把想法表达出来</h2><p className="studio-muted">按需要选一个，保存后可以下载给 SFLS。</p>
          <div className="studio-tool-list"><button disabled={active?.kind !== 'sfls'} onClick={() => switchView('requirements')}><FileText size={24} strokeWidth={1.5} /><span><strong>需求文档</strong><small>写下目标、规则与完成标准。</small></span><ChevronRight size={18} /></button>
          <button disabled={active?.kind !== 'sfls'} onClick={() => switchView('board')}><PenTool size={24} strokeWidth={1.5} /><span><strong>架构画板</strong><small>用 draw.io 画出模块和关系。</small></span><ChevronRight size={18} /></button>
          <button onClick={() => switchView('record')} disabled={!active}><FileText size={24} strokeWidth={1.5} /><span><strong>作品记录</strong><small>查看上传的 README，不再重复填写。</small></span><ChevronRight size={18} /></button>
          {onPython && <button onClick={onPython}><BookOpen size={24} strokeWidth={1.5} /><span><strong>Python 小实验</strong><small>试几行代码，或和贪贪讨论一个知识点。</small></span><ChevronRight size={18} /></button>}</div>
          {!active && <p className="studio-muted">老师发布任务后，就可以保存和下载自己的设计。</p>}
        </div> : !active ? <div className="studio-empty"><FolderOpen size={36} strokeWidth={1} /><h2>{loading ? '正在准备课堂…' : '今天的创作，即将开始'}</h2><p>任务发布后，先看要求，再下载到自己的电脑。</p></div> : <>
          <div hidden={view !== 'task'} className="studio-document">
            <span className="studio-eyebrow">{active.configuration.phase === 'practice' ? '课堂练习' : active.configuration.phase === 'pre' ? '前测任务' : active.configuration.phase === 'post' ? '后测任务' : '课堂资料'}</span>
            <h1>{active.title}</h1>
            <p className="studio-task-copy">{active.configuration.task || '下载这份资料，按老师的安排使用。'}</p>
            {active.configuration.worksheet && <details className="studio-plain-details"><summary>本课要求与验收</summary><ul>{[...active.configuration.worksheet.rules, ...active.configuration.worksheet.acceptance].map((line, i) => <li key={i}>{line}</li>)}</ul></details>}
            {active.kind === 'sfls' && <TaskInstructions practice={active.configuration.phase === 'practice'} hasWorksheet={!!active.configuration.worksheet} />}
            {active.configuration.curriculum && <details className="studio-plain-details"><summary>本课知识参考</summary><p className="studio-task-copy">{active.configuration.curriculum}</p></details>}
          </div>
          {view === 'record' && <div className="studio-document"><ReadmeRecord key={`${userId}:${active.id}`} materialId={active.id} revision={active.submission?.count || 0} /></div>}
        </>}
        {active && designId === active.id && <div hidden={view !== 'requirements' && view !== 'board'} className="studio-design-area"><TaskDesignBoundary key={`${userId}:${active.id}`}><Suspense fallback={<p role="status">正在打开{designTool === 'board' ? '架构画板' : '需求文档'}…</p>}><TaskDesign materialId={active.id} userId={userId} tool={designTool} onDirty={value => setDirtyDesign(previous => value ? active.id : previous === active.id ? '' : previous)} /></Suspense></TaskDesignBoundary></div>}
      </div>
      {active && showHandoff && <aside className="studio-handoff" aria-label="下载与提交">
        <section><span className="studio-step">01 / 开始创作</span><h3>带到你的电脑</h3><p>{active.configuration.inherit_previous ? '带上你上次提交的代码和已保存的设计。' : '从老师准备的起点开始。'}</p>
          <div className="studio-downloads">{['pi', 'sfls'].includes(active.kind) ? <><button className="prep-primary" disabled={busy || !!dirtyDesign} onClick={() => void act(() => download(active, 'windows'))}><Download size={16} />下载 Windows 包</button><button disabled={busy || !!dirtyDesign} onClick={() => void act(() => download(active, 'mac'))}><Download size={16} />下载 Mac 包</button></> : <button className="prep-primary" disabled={busy} onClick={() => void act(() => download(active, 'mac'))}><Download size={16} />下载{active.configuration.accept_submissions ? '作业包' : '资料'}</button>}</div>
          {!!dirtyDesign && <small>先保存画板，再下载最新设计。</small>}
        </section>
        {(['pi', 'sfls'].includes(active.kind) || active.configuration.accept_submissions) && <section>
          <span className="studio-step">02 / 提交作品</span><h3>{active.submission?.count ? '作品已收到' : '完成后交到这里'}</h3>
          <p>{active.kind === 'sfls' ? <>在 SFLS 输入 <code>/submit</code>。失败时，先退出 SFLS，再将整个本人任务文件夹压缩成 ZIP 上传；也可以上传 <code>/pack</code> 生成的 ZIP。</> : '将作品压缩成 ZIP 后上传。'}</p>
          <label className="studio-file-picker"><Upload size={18} /><span>{selectedFile?.material === active.id ? selectedFile.file.name : '选择作品 ZIP'}</span><input aria-label="选择作品 ZIP" key={`${active.id}:${active.submission?.count || 0}`} type="file" accept=".zip" disabled={busy || (active.submission?.count || 0) >= (active.max_submissions ?? 3)} onChange={event => { const file = event.target.files?.[0]; setSelectedFile(file ? { material: active.id, file } : null); upload.current = null; }} /></label>
          <button className="studio-upload-button" disabled={busy || selectedFile?.material !== active.id || (active.submission?.count || 0) >= (active.max_submissions ?? 3)} onClick={() => { if (selectedFile?.material === active.id) void act(() => submit(active, selectedFile.file)); }}>{busy && selectedFile?.material === active.id ? '正在上传…' : '上传作品'}</button>
          <small>{active.submission?.count ? `已提交 ${active.submission.count} / ${active.max_submissions ?? 3} 次` : `最多 ${active.kind === 'sfls' ? 50 : 10} MiB · 保留 ${active.max_submissions ?? 3} 次提交`}{(active.submission?.count || 0) >= (active.max_submissions ?? 3) ? '，如需修改请联系老师。' : ''}</small>
          {active.kind === 'sfls' && <small>上传时会移除环境、依赖和凭据文件，并遮蔽误发的密钥；不改动你电脑里的原文件。</small>}
          {active.submission?.last_submitted_at && <small>{new Date(active.submission.last_submitted_at).toLocaleString()}</small>}
        </section>}
        <small className="studio-privacy">作品包中不要放密钥或私人文件。</small>
      </aside>}
    </div>
  </>;
  if (embedded) return <section className="student-studio" aria-label="作业与资料">{content}</section>;
  return <><button ref={trigger} onClick={() => { setOpen(true); void act(() => load()); }}>作业与资料{items.length ? ` · ${items.length}` : ''}</button>
    {open && <dialog className="prep-material-dialog student-studio" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy && !dirtyDesign) setOpen(false); }} aria-label="作业与资料">{content}</dialog>}</>;
}
