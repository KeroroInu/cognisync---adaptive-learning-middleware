import { useEffect, useRef, useState, type RefObject } from 'react';
import { classroomAdmin } from '../lib/classroom';
import './LessonMaterials.css';
import { WorksheetConfig, worksheetTaskText, type WorksheetTemplate } from '../components/WorksheetTools';
import { receiptFilename } from '../lib/receiptFilename';
import { createRequestId } from '../lib/requestId';
import { Archive, BookOpen, ChevronDown, FileText, FolderDown, Send } from 'lucide-react';

type ParticipationStatus = 'all' | 'pending' | 'submitted' | 'not_downloaded';
type ParticipationSummary = { eligible_user_count: number; download_user_count: number; submission_user_count: number; pending_user_count: number; statistics_started_at: string | null; excluded_student_ids?: string[] };
export type Material = { id: string; title: string; kind: string; created_at?: string; closed_at: string | null; student_visible: boolean; submission_count?: number; download_count?: number; participation?: ParticipationSummary; configuration: { task?: string; phase?: string; support?: string; curriculum?: string; inherit_previous?: boolean; accept_submissions?: boolean; worksheet?: WorksheetTemplate; library?: { version: string; lesson_number: number; slides_path: string } } };
type Participant = { user_id: string; name: string; student_id: string; school_class: string | null; download_count: number; submission_count: number; downloaded: boolean; last_downloaded_at: string | null; submitted: boolean; last_submitted_at: string | null; latest_submission_id: string | null };
type ParticipationPage = { total: number; summary: ParticipationSummary; items: Participant[] };
type Receipt = { id: string; name: string; student_id: string; kind: string; created_at: string; size: number; detail?: { task_validation?: { status: string; message: string }; worksheet_context?: { matches_download?: boolean; worksheet_revision_id?: string | null; download_context?: { worksheet_revision_id: string | null }; web_at_receipt?: { worksheet_revision_id: string } | null } } };
type ReceiptPage = { total: number; submission_count?: number; download_count?: number; items: Receipt[] };
const participationLabels: Record<ParticipationStatus, string> = { all: '全部', pending: '未交', submitted: '已交', not_downloaded: '未下载' };
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function materialLesson(item: Material) { return item.configuration.library?.lesson_number ?? (item.configuration.worksheet ? Number(item.configuration.worksheet.lesson_id.slice(1)) : null); }
/** Used editions and alternatives to the active lesson stay out of the publish library. */
export function groupMaterials(items: Material[]) {
  const current = items.filter(item => item.student_visible);
  const activeLessons = new Set(current.map(materialLesson));
  const history: Material[] = [], candidates: Material[] = [];
  for (const item of items.filter(material => !material.student_visible)) {
    if ((item.download_count ?? 0) > 0 || (item.submission_count ?? 0) > 0 || !item.configuration.library || activeLessons.has(materialLesson(item))) history.push(item);
    else candidates.push(item);
  }
  const library: Material[] = [];
  const byNewest = (a: Material, b: Material) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || (b.configuration.library?.version ?? '').localeCompare(a.configuration.library?.version ?? '', undefined, { numeric: true }) || a.id.localeCompare(b.id);
  for (const item of candidates.sort(byNewest)) {
    if (library.some(other => materialLesson(other) === materialLesson(item))) history.push(item);
    else library.push(item);
  }
  library.sort((a, b) => (materialLesson(a) ?? 0) - (materialLesson(b) ?? 0));
  return { current, library, history: history.sort(byNewest) };
}
function useMaterialDialog(opened: boolean, ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!opened) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current; dialog?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [opened, ref]);
}
export function MaterialCard({ item, disabled, history = false, onToggle, onReceipts, onParticipation }: { item: Material; disabled: boolean; history?: boolean; onToggle: () => void; onReceipts: () => void; onParticipation?: (status: ParticipationStatus) => void }) {
  const slides = item.configuration.library?.slides_path;
  const counts = item.participation;
  return <li className={`lesson-material-card${item.student_visible ? ' is-published' : ''}${history ? ' is-history' : ''}`}>
    <div className="lesson-material-heading"><h3>{item.title}</h3><span className={`lesson-material-status${item.student_visible ? ' is-live' : ''}`}>{item.student_visible ? '学生正在看' : history ? '历史版本' : '待发布'}</span></div>
    <div className="lesson-material-meta">
      <span>{item.configuration.library ? (item.configuration.inherit_previous ? '继续本人上次作品' : '首次体验') : '已有资料'}</span>
      {history ? <><span>{item.configuration.library ? `版本 ${item.configuration.library.version}` : `记录 ${item.id.slice(0, 8)}`}{item.closed_at ? ` · ${formatTime(item.closed_at)} 收起` : item.created_at ? ` · ${formatTime(item.created_at)} 创建` : ''}</span><span className="lesson-material-counts">共收 <strong>{item.submission_count ?? 0}</strong> 份 · 下载 <strong>{item.download_count ?? 0}</strong> 次</span></> : counts ? <div className="lesson-material-people" aria-label="按学生人数统计"><button type="button" onClick={() => onParticipation?.('all')} aria-label={`查看下载与提交名单，已下载 ${counts.download_user_count} 人`}>下载 <strong>{counts.download_user_count}</strong> 人</button><span aria-hidden="true">·</span><button type="button" onClick={() => onParticipation?.('submitted')}>已交 <strong>{counts.submission_user_count}</strong> 人</button><span aria-hidden="true">·</span><button type="button" className="is-pending" onClick={() => onParticipation?.('pending')}>未交 <strong>{counts.pending_user_count}</strong> 人</button></div> : <span>人数统计暂不可用</span>}
    </div>
    {!history && counts && <small className="lesson-count-baseline">{counts.statistics_started_at ? `从 ${formatTime(counts.statistics_started_at)} 起统计；` : ''}重复下载与多次提交按 1 人计。{!!counts.excluded_student_ids?.length && '演示账号不计入统计。'}</small>}
    <div className="classroom-actions lesson-material-actions">
      {!item.student_visible && <button type="button" className={`lesson-action${history ? '' : ' classroom-primary'}`} disabled={disabled} onClick={onToggle}><Send size={15} aria-hidden="true" />{history ? '重新开放' : '发布给本班'}</button>}
      {item.student_visible && <button type="button" className="lesson-action is-emphasized" onClick={() => onParticipation?.('all')}>查看学生名单</button>}
      <button type="button" className="lesson-action" onClick={onReceipts}><FolderDown size={15} aria-hidden="true" />全部版本记录</button>
      {slides?.startsWith('/slides/') && <a className="lesson-action" href={slides} target="_blank" rel="noreferrer"><BookOpen size={15} aria-hidden="true" />打开课件</a>}
      {item.student_visible && <button type="button" className="lesson-action is-quiet" disabled={disabled} onClick={onToggle}><Archive size={15} aria-hidden="true" />收起任务</button>}
    </div>
    {item.configuration.task && <details className="lesson-material-details"><summary><FileText size={15} aria-hidden="true" /><span>发布内容</span><ChevronDown className="lesson-details-chevron" size={15} aria-hidden="true" /></summary><pre>{item.configuration.task}{'\n\n'}{item.configuration.curriculum || item.configuration.support}</pre></details>}
  </li>;
}
async function fileRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/admin/classroom${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(typeof data?.detail === 'string' ? data.detail : '文件操作没有完成'); }
  return response;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function WorksheetReceipt({ receipt }: { receipt: Receipt }) {
  const context = receipt.detail?.worksheet_context;
  if (!context) return null;
  const packaged = context.download_context?.worksheet_revision_id ?? context.worksheet_revision_id;
  return <details><summary>任务单版本来源</summary><p>下载包版本：{packaged || '未保存'}</p>{receipt.kind === 'submission' && <><p>收件时网页版本：{context.web_at_receipt?.worksheet_revision_id || '未保存'}</p><p>{context.matches_download ? '交回的任务单文件与下载时一致' : '交回的任务单文件已变化或缺失，原件保留供核对'}</p></>}<small>网页后续修改不会改写这个收件快照；历史任务单可在课堂研究包中导出。</small></details>;
}
export function LessonMaterials({ sessionId, open, className }: { sessionId: string; open: boolean; className?: string }) {
  const [items, setItems] = useState<Material[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''), [task, setTask] = useState(''), [curriculum, setCurriculum] = useState(''), [phase, setPhase] = useState('practice');
  const [projectId, setProjectId] = useState('snake-course'), [inheritPrevious, setInheritPrevious] = useState(true);
  const [requestId, setRequestId] = useState(createRequestId);
  const [worksheet, setWorksheet] = useState<WorksheetTemplate | null>(null);
  const [composing, setComposing] = useState(false), [composeKind, setComposeKind] = useState<'task' | 'file'>('task');
  const [file, setFile] = useState<File | null>(null), [fileId, setFileId] = useState(createRequestId);
  const [acceptSubmissions, setAcceptSubmissions] = useState(true);
  const filePicker = useRef<HTMLInputElement>(null);
  const acting = useRef(false);
  const [receiptId, setReceiptId] = useState(''), [page, setPage] = useState(0), [receipts, setReceipts] = useState<ReceiptPage | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false), [receiptError, setReceiptError] = useState(''), [receiptRevision, setReceiptRevision] = useState(0);
  const [downloadingReceipt, setDownloadingReceipt] = useState('');
  const receiptDialog = useRef<HTMLDivElement>(null);
  const [participationId, setParticipationId] = useState(''), [participationStatus, setParticipationStatus] = useState<ParticipationStatus>('all'), [participationPage, setParticipationPage] = useState(0);
  const [participation, setParticipation] = useState<ParticipationPage | null>(null), [participationLoading, setParticipationLoading] = useState(false), [participationError, setParticipationError] = useState(''), [participationRevision, setParticipationRevision] = useState(0);
  const participationDialog = useRef<HTMLDivElement>(null);
  async function load() { setItems(await classroomAdmin<Material[]>(`/sessions/${sessionId}/materials`)); }
  useEffect(() => { const controller = new AbortController(); void classroomAdmin<Material[]>(`/sessions/${sessionId}/materials`, undefined, controller.signal).then(setItems).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }); return () => controller.abort(); }, [sessionId]);
  useEffect(() => {
    if (!receiptId) return;
    const controller = new AbortController(); setReceipts(null); setReceiptError(''); setReceiptLoading(true);
    void classroomAdmin<ReceiptPage>(`/materials/${receiptId}/receipts?offset=${page * 50}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setReceipts(result); })
      .catch(cause => { if (!controller.signal.aborted) setReceiptError(cause instanceof Error ? cause.message : '收取记录加载失败，请重试'); })
      .finally(() => { if (!controller.signal.aborted) setReceiptLoading(false); });
    return () => controller.abort();
  }, [receiptId, page, receiptRevision]);
  useEffect(() => {
    if (!participationId) return;
    const controller = new AbortController(); setParticipation(null); setParticipationError(''); setParticipationLoading(true);
    void classroomAdmin<ParticipationPage>(`/materials/${participationId}/participation?status=${participationStatus}&offset=${participationPage * 50}&limit=50`, undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        setParticipation(result);
        setItems(current => current.map(item => item.id === participationId ? { ...item, participation: result.summary } : item));
      })
      .catch(cause => { if (!controller.signal.aborted) setParticipationError(cause instanceof Error ? cause.message : '学生名单加载失败，请重试'); })
      .finally(() => { if (!controller.signal.aborted) setParticipationLoading(false); });
    return () => controller.abort();
  }, [participationId, participationStatus, participationPage, participationRevision]);
  useEffect(() => { setReceiptId(''); setParticipationId(''); setItems([]); }, [sessionId]);
  useMaterialDialog(!!receiptId, receiptDialog, () => setReceiptId(''));
  useMaterialDialog(!!participationId, participationDialog, () => setParticipationId(''));
  function openReceipts(id: string) { setReceipts(null); setReceiptError(''); setReceiptLoading(true); setReceiptId(id); setPage(0); setReceiptRevision(value => value + 1); }
  function openParticipation(id: string, status: ParticipationStatus) { setParticipation(null); setParticipationError(''); setParticipationLoading(true); setParticipationId(id); setParticipationStatus(status); setParticipationPage(0); setParticipationRevision(value => value + 1); }
  function changeParticipationPage(nextPage: number) { setParticipation(null); setParticipationLoading(true); setParticipationPage(nextPage); }
  function filterParticipation(status: ParticipationStatus) { if (status === participationStatus) return; setParticipation(null); setParticipationLoading(true); setParticipationStatus(status); setParticipationPage(0); }
  function changeReceiptPage(nextPage: number) { setReceipts(null); setReceiptLoading(true); setPage(nextPage); }
  async function downloadReceipt(receipt: Receipt) {
    if (downloadingReceipt) return;
    setDownloadingReceipt(receipt.id); setReceiptError('');
    try { saveBlob(await (await fileRequest(`/receipts/${receipt.id}/file`)).blob(), receiptFilename(receipt, items.find(item => item.id === receiptId)?.title)); }
    catch (cause) { setReceiptError(cause instanceof Error ? cause.message : '下载失败，请重试'); }
    finally { setDownloadingReceipt(''); }
  }
  async function downloadParticipant(participant: Participant) {
    if (!participant.latest_submission_id || downloadingReceipt) return;
    setDownloadingReceipt(participant.latest_submission_id); setParticipationError('');
    try {
      const receipt = { id: participant.latest_submission_id, name: participant.name, student_id: participant.student_id, kind: 'submission', created_at: participant.last_submitted_at ?? '', size: 0 };
      saveBlob(await (await fileRequest(`/receipts/${receipt.id}/file`)).blob(), receiptFilename(receipt, items.find(item => item.id === participationId)?.title));
    } catch (cause) { setParticipationError(cause instanceof Error ? cause.message : '下载失败，请重试'); }
    finally { setDownloadingReceipt(''); }
  }
  async function act(work: () => Promise<void>) { if (acting.current) return; acting.current = true; setBusy(true); setError(''); try { await work(); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); } finally { acting.current = false; setBusy(false); } }
  function edited() { setRequestId(createRequestId()); }
  const grouped = groupMaterials(items);
  const card = (item: Material, history = false) => <MaterialCard key={item.id} item={item} history={history} disabled={busy || !open} onToggle={() => void act(async () => { await classroomAdmin(`/materials/${item.id}/${item.student_visible ? 'close' : 'open'}`, {}); })} onReceipts={() => openReceipts(item.id)} onParticipation={status => openParticipation(item.id, status)} />;
  return <section className="classroom-panel lesson-materials" aria-label="作业与资料"><div className="classroom-toolbar"><div><h2>本课任务</h2><p>选择任务发布，学生下载自己的任务包。</p></div><div className="classroom-actions"><button type="button" className="lesson-action" disabled={busy} onClick={() => void act(async () => {})}>刷新人数</button><button type="button" className="lesson-action" disabled={!open || busy} aria-expanded={composing} onClick={() => setComposing(value => !value)}>{composing ? '收起编辑' : '自定义 / 上传资料'}</button></div></div>
    {error && <p role="alert" className="classroom-error">{error}</p>}
    <fieldset disabled={busy || !open} hidden={!composing}>
      <nav className="lesson-compose-tabs" aria-label="发布类型"><button aria-pressed={composeKind === 'task'} onClick={() => setComposeKind('task')}>SFLS 任务包</button><button aria-pressed={composeKind === 'file'} onClick={() => setComposeKind('file')}>上传现有资料</button></nav>
      <div className="classroom-actions" hidden={composeKind !== 'file'}><label>选择作业包或资料<input ref={filePicker} type="file" accept=".pdf,.md,.txt,.py,.zip,.png,.jpg,.pptx" onChange={event => { setFile(event.target.files?.[0] || null); setFileId(createRequestId()); }} /></label>
        {file?.name.toLowerCase().endsWith('.zip') && <label><input type="checkbox" checked={acceptSubmissions} onChange={event => { setAcceptSubmissions(event.target.checked); setFileId(createRequestId()); }} />学生需要交回作品</label>}
        <button disabled={!file} onClick={() => void act(async () => { if (!file) return; if (file.size > 10 * 1024 * 1024) throw new Error('文件最多 10 MiB'); await fileRequest(`/sessions/${sessionId}/files?request_id=${fileId}&filename=${encodeURIComponent(file.name)}&accept_submissions=${acceptSubmissions && file.name.toLowerCase().endsWith('.zip')}`, { method: 'POST', body: file }); setFile(null); if (filePicker.current) filePicker.current.value = ''; setFileId(createRequestId()); })}>发布给本班</button></div>
      <div hidden={composeKind !== 'task'}>
        <div className="lesson-publish-row">
        <label>名称<input value={title} maxLength={120} onChange={event => { setTitle(event.target.value); edited(); }} placeholder="例如：第一次独立创作" /></label>
        <label>用途<select aria-label="用途" value={phase} onChange={event => { setPhase(event.target.value); setInheritPrevious(event.target.value === 'practice'); if (event.target.value !== 'practice') setWorksheet(null); edited(); }}><option value="practice">课堂任务</option><option value="pre">前测</option><option value="post">后测 / 迁移</option></select></label>
        </div>
        {composing && phase === 'practice' && <details open><summary>选择本课任务（第 1–5 课）</summary><WorksheetConfig condition={className === '开发班' ? 'ai_pbl' : 'pdt'} value={worksheet} onChange={value => { setWorksheet(value); if (value) { setTask(worksheetTaskText(value)); if (value.lesson_id !== worksheet?.lesson_id || value.condition !== worksheet?.condition) { setTitle('第 ' + Number(value.lesson_id.slice(1)) + ' 课 · ' + value.title); setCurriculum(''); setInheritPrevious(value.lesson_id !== 'C01'); } } edited(); }} /><small>第1课自由体验；后续接着本人上次交回的工程。</small></details>}
        <label>任务要求<textarea rows={4} maxLength={16000} value={task} onChange={event => { setTask(event.target.value); edited(); }} placeholder="让学生做什么、交什么。前后测请使用统一评分要求。" /></label>
        <details><summary>给 SFLS 的知识参考（可选）</summary><label>教材与知识提示<textarea rows={3} maxLength={16000} value={curriculum} onChange={event => { setCurriculum(event.target.value); edited(); }} placeholder="关键概念、短例子和教材页码。两个班使用相同知识范围，不填密钥。" /></label></details>
        {phase === 'practice' && <label><span><input type="checkbox" checked={inheritPrevious} onChange={event => { setInheritPrevious(event.target.checked); edited(); }} /> 带上学生上次已交的代码</span></label>}
        <details><summary>课程归属</summary><label>课程标识<input value={projectId} maxLength={100} onChange={event => { setProjectId(event.target.value); edited(); }} /></label><small>同一项目的几节课保持不变，例如 snake-course。按学生分别继承，不会混用其他人的作品。</small></details>
        <p>{phase === 'practice' ? 'SFLS 根据对话整理 README，学生只补缺口；两班使用相同支架。' : '自由与 AI 协作，不安排教学问答，不继承课堂代码。'}</p>
        <button className="classroom-primary" disabled={!title.trim() || !task.trim() || !/^[A-Za-z0-9_-]{1,100}$/.test(projectId)} onClick={() => void act(async () => { await classroomAdmin(`/sessions/${sessionId}/packages`, { request_id: requestId, title, task, curriculum, phase, runtime: 'sfls', project_id: projectId, inherit_previous: phase === 'practice' && inheritPrevious, worksheet: phase === 'practice' ? worksheet : null }); setTitle(''); setTask(''); setCurriculum(''); setWorksheet(null); edited(); })}>发布给本班</button>
      </div>
    </fieldset>
    {!grouped.current.length && <p>当前没有向学生开放的任务。</p>}
    <ul className="lesson-material-list" aria-label="当前开放任务">{grouped.current.map(item => card(item))}</ul>
    {!!grouped.library.length && <details className="lesson-material-history"><summary>待发布任务库 · {grouped.library.length} 个</summary><ul className="lesson-material-list">{grouped.library.map(item => card(item))}</ul></details>}
    {!!grouped.history.length && <details className="lesson-material-history"><summary>历史任务与资料 · {grouped.history.length} 个</summary><p className="lesson-count-baseline">旧版本及全部下载、提交记录保留在这里，不影响当前任务。</p><ul className="lesson-material-list">{grouped.history.map(item => card(item, true))}</ul></details>}
    {participationId && <div className="lesson-receipts-backdrop"><div ref={participationDialog} className="lesson-receipts-dialog lesson-participation-dialog" role="dialog" aria-modal="true" aria-labelledby="lesson-participation-title" tabIndex={-1}>
      <header><div><h2 id="lesson-participation-title">学生下载与提交</h2><p>{items.find(item => item.id === participationId)?.title}</p></div><button type="button" onClick={() => setParticipationId('')} aria-label="关闭学生名单">关闭</button></header>
      <div className="lesson-receipts-toolbar"><span>本班启用的学生账号{participation ? ` · 共 ${participation.summary.eligible_user_count} 人` : ''}</span><button disabled={participationLoading} onClick={() => setParticipationRevision(value => value + 1)}>刷新名单</button></div>
      {participation?.summary.statistics_started_at && <p className="lesson-count-baseline">从 {formatTime(participation.summary.statistics_started_at)} 起统计，旧记录可在“全部版本记录”查看。{!!participation.summary.excluded_student_ids?.length && '演示账号不计入统计。'}</p>}
      <nav className="lesson-participation-filters" aria-label="学生提交状态">{(Object.keys(participationLabels) as ParticipationStatus[]).map(status => <button type="button" key={status} aria-pressed={participationStatus === status} onClick={() => filterParticipation(status)}>{participationLabels[status]}</button>)}</nav>
      {participationLoading && <p role="status">正在读取学生名单…</p>}
      {participationError && <div className="classroom-error" role="alert">{participationError}<button disabled={participationLoading} onClick={() => setParticipationRevision(value => value + 1)}>重试</button></div>}
      {participation && <><div className="lesson-receipts-list lesson-participation-list">{!participation.items.length ? <p>暂无{participationStatus === 'all' ? '' : participationLabels[participationStatus]}学生。</p> : <table><thead><tr><th scope="col">学生</th><th scope="col">下载</th><th scope="col">提交</th><th scope="col">作品</th></tr></thead><tbody>{participation.items.map(participant => <tr key={participant.user_id}><th scope="row"><strong>{participant.name}</strong><span>{participant.student_id}{participant.school_class ? ` · ${participant.school_class}` : ''}</span></th><td><strong className={participant.downloaded ? 'is-done' : ''}>{participant.downloaded ? '已下载' : '未下载'}</strong>{participant.last_downloaded_at && <span title={`下载 ${participant.download_count} 次`}>{formatTime(participant.last_downloaded_at)}</span>}</td><td><strong className={participant.submitted ? 'is-done' : 'is-pending'}>{participant.submitted ? '已交' : '未交'}</strong>{participant.last_submitted_at && <span title={`提交 ${participant.submission_count} 份`}>{formatTime(participant.last_submitted_at)}</span>}</td><td>{participant.latest_submission_id ? <button disabled={!!downloadingReceipt} onClick={() => void downloadParticipant(participant)}>{downloadingReceipt === participant.latest_submission_id ? '下载中…' : '下载最近作品'}</button> : <span>—</span>}</td></tr>)}</tbody></table>}</div><footer className="lesson-receipts-toolbar"><span>{participationLabels[participationStatus]} {participation.total} 人 · 第 {participationPage + 1} / {Math.max(1, Math.ceil(participation.total / 50))} 页</span><div><button disabled={!participationPage || participationLoading} onClick={() => changeParticipationPage(participationPage - 1)}>上一页</button><button disabled={participationLoading || (participationPage + 1) * 50 >= participation.total} onClick={() => changeParticipationPage(participationPage + 1)}>下一页</button></div></footer></>}
    </div></div>}
    {receiptId && <div className="lesson-receipts-backdrop"><div ref={receiptDialog} className="lesson-receipts-dialog" role="dialog" aria-modal="true" aria-labelledby="lesson-receipts-title" tabIndex={-1}>
      <header><div><h2 id="lesson-receipts-title">全部版本记录</h2><p>{items.find(item => item.id === receiptId)?.title} · 包含计数起点前的完整原始记录</p></div><button type="button" onClick={() => setReceiptId('')} aria-label="关闭全部版本记录">关闭</button></header>
      <div className="lesson-receipts-toolbar"><span>{receipts ? `已收 ${receipts.submission_count ?? items.find(item => item.id === receiptId)?.submission_count ?? 0} 份 · 下载 ${receipts.download_count ?? items.find(item => item.id === receiptId)?.download_count ?? 0} 次` : '读取收取记录'}</span><button disabled={receiptLoading} onClick={() => setReceiptRevision(value => value + 1)}>刷新记录</button></div>
      {receiptLoading && <p role="status">正在读取下载与提交…</p>}
      {receiptError && <p role="alert" className="classroom-error">{receiptError}</p>}
      {receipts && <><div className="lesson-receipts-list">{!receipts.items.length && <p>还没有下载或提交记录。</p>}{receipts.items.map(receipt => <div className="lesson-receipt" key={receipt.id}><div><strong>{receipt.name} · {receipt.student_id}</strong><span>{receipt.kind === 'submission' ? '提交作品' : '发起下载'} · {new Date(receipt.created_at).toLocaleString('zh-CN')}</span></div>{receipt.detail?.task_validation && <span title={receipt.detail.task_validation.message}>{receipt.detail.task_validation.status === 'matched' ? '任务配置一致（不代表功能通过）' : '任务配置待核对 · 原件已保留'}</span>}<WorksheetReceipt receipt={receipt} />{receipt.kind === 'submission' && <button disabled={!!downloadingReceipt} onClick={() => void downloadReceipt(receipt)}>{downloadingReceipt === receipt.id ? '正在下载…' : '下载原件'}</button>}</div>)}</div><footer className="lesson-receipts-toolbar"><span>共 {receipts.total} 条 · 第 {page + 1} / {Math.max(1, Math.ceil(receipts.total / 50))} 页</span><div><button disabled={!page || receiptLoading} onClick={() => changeReceiptPage(page - 1)}>上一页</button><button disabled={receiptLoading || (page + 1) * 50 >= receipts.total} onClick={() => changeReceiptPage(page + 1)}>下一页</button></div></footer></>}
    </div></div>}
  </section>;
}

type Evidence = { total: number; knowledge_points: string[]; limitation: string; items: { id: string; source?: string; kind?: string; user_id: string; name: string; student_id: string; at: string; parts: { role: string; kind: string; text: string; mentioned_targets: string[] }[]; payload: unknown }[] };
const processLabels: Record<string, string> = { design: '保存设计', user: '学生提问', assistant: 'AI 回复', chat: '准备区对话', save: '代码保存', run: '运行代码', module_test: '运行 / 测试', structure_change: '作品修改', stage_confirm: '环节确认', help_request: '发起求助', final_submit: '提交作品' };
export function LessonEvidence({ sessionId }: { sessionId: string }) {
  const [source, setSource] = useState('process'), [userId, setUserId] = useState(''), [page, setPage] = useState(0), [opened, setOpened] = useState(false), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Evidence | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return; const controller = new AbortController(); setData(null); setError('');
    void classroomAdmin<Evidence>(`/sessions/${sessionId}/evidence?source=${source}&offset=${page * 50}${userId ? `&user_id=${userId}` : ''}`, undefined, controller.signal).then(setData).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [sessionId, source, userId, page, opened, revision]);
  return <details className="classroom-panel lesson-materials" onToggle={event => setOpened(event.currentTarget.open)}><summary>学习记录 · 对话、修改与测试</summary>
    <div className="classroom-actions"><label>查看<select value={source} onChange={event => { setSource(event.target.value); setPage(0); }}><option value="process">完整过程（最近在前）</option><option value="preparation">准备区代码与对话</option><option value="chat">分组课堂对话</option><option value="event">分组课堂操作与版本</option></select></label><button onClick={() => setRevision(v => v + 1)}>刷新证据</button>{userId && <button onClick={() => { setUserId(''); setPage(0); }}>返回全班</button>}</div>
    {error && <p role="alert">{error}</p>}{data && <><p>本课知识点：{data.knowledge_points.join('、') || '尚未设置'}</p><p>{data.limitation}</p><p>共 {data.total} 条；完整原始数据及已上传作品可在“数据导出”下载。</p>
      {data.items.map(item => <details key={`${item.source || source}:${item.id}`}>
        <summary>{item.name} · {item.student_id} · {processLabels[item.kind || ''] || '记录'} · {new Date(item.at).toLocaleString()}</summary>
        <button onClick={() => { setUserId(item.user_id); setPage(0); }}>只看这位学生</button>
        {item.parts.map((part, index) => <section key={index}>
          <strong>{({ student: '学生原话', user: '学生原话', assistant: 'AI 提供', student_code: '学生编辑器快照', student_design: '学生需求与架构' } as Record<string, string>)[part.role] || part.role}</strong>
          <span> · {part.mentioned_targets.length ? `提及：${part.mentioned_targets.join('、')}` : '未检出同名知识点（不等于没学会）'}</span>
          <pre>{part.text || '无文本'}</pre>
        </section>)}
        <details><summary>原始记录</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>
      </details>)}
      <div className="classroom-actions"><button disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1}</span><button disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button><button onClick={() => saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `本课证据-${sessionId}-${source}-${page + 1}.json`)}>导出当前页</button></div>
    </>}
  </details>;
}
