import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, DoorClosed, DoorOpen, Plus, RefreshCw } from 'lucide-react';
import { classroomAdmin, classroomAnswerLabel, type ClassroomResponses, type ClassroomSession } from '../lib/classroom';
import './Classroom.css';
import { TEACHING_CLASSES, isTeachingClass } from '../lib/teachingClasses';
import { LessonSetup } from './LessonSetup';
import { LessonMaterials, LessonEvidence } from './LessonMaterials';

const PAGE_SIZE = 50;
const stateLabel = { open: '上课中', closing: '正在下课', closed: '已下课' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Confirmation {
  title: string;
  scope: string;
  description: string;
  confirmLabel: string;
  preview?: string;
  danger?: boolean;
  operation: () => Promise<void>;
}

/** Native HTML dialog keeps keyboard focus inside the application confirmation. */
export function ClassroomConfirmation({ title, scope, description, confirmLabel, preview, danger, busy, error, onConfirm, onCancel }: Omit<Confirmation, 'operation'> & {
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus();
      else document.querySelector<HTMLButtonElement>('[aria-label="刷新课堂"]')?.focus();
    };
  }, []);
  return <dialog ref={dialogRef} className="classroom-confirm" aria-labelledby="classroom-confirm-title" aria-describedby="classroom-confirm-description" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="classroom-confirm-content">
      <p className="classroom-confirm-scope">{scope}</p>
      <h2 id="classroom-confirm-title">{title}</h2>
      <p id="classroom-confirm-description">{description}</p>
      {preview && <blockquote>{preview}</blockquote>}
      {error && <p className="classroom-error" role="alert">{error}</p>}
      <div className="classroom-actions">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" disabled={busy} className={danger ? 'classroom-end' : 'classroom-primary'} onClick={onConfirm}>{busy ? '正在处理…' : confirmLabel}</button>
      </div>
    </div>
  </dialog>;
}

export function Classroom() {
  const [sessions, setSessions] = useState<ClassroomSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [className, setClassName] = useState('解构班');
  const [title, setTitle] = useState(new Date().toLocaleDateString('zh-CN') + ' 课堂');
  const [responseData, setResponseData] = useState<ClassroomResponses | null>(null);
  const [responseError, setResponseError] = useState('');
  const [page, setPage] = useState(0);
  const [showOldAnswers, setShowOldAnswers] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const requestLock = useRef(false);
  const listSequence = useRef(0);
  const requestedClass = useRef<string | null>(null);
  const createRequest = useRef<{ key: string; id: string } | null>(null);
  const selected = sessions.find(session => session.id === selectedId);
  const promptId = selected?.prompt?.id;

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++listSequence.current;
    try {
      const result = await classroomAdmin<ClassroomSession[]>('/sessions', undefined, signal);
      if (signal?.aborted || sequence !== listSequence.current) return;
      setSessions(result);
      setSelectedId(previous => result.some(item => item.id === previous) ? previous : result.find(item => item.is_current && isTeachingClass(item.class_name) && (!requestedClass.current || item.class_name === requestedClass.current))?.id || '');
      setLoadError('');
    } catch (cause) {
      if (!signal?.aborted && sequence === listSequence.current) setLoadError(errorMessage(cause));
    } finally { if (!signal?.aborted && sequence === listSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== 'hidden') await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 8000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);

  useEffect(() => { setPage(0); setResponseData(null); setResponseError(''); }, [promptId]);
  useEffect(() => {
    if (!promptId || !showOldAnswers) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResponseData(null);
    const poll = async () => {
      try {
        if (document.visibilityState !== 'hidden') {
          const data = await classroomAdmin<ClassroomResponses>(`/prompts/${encodeURIComponent(promptId)}/responses?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, undefined, controller.signal);
          if (!controller.signal.aborted) { setResponseData(data); setResponseError(''); }
        }
      } catch (cause) { if (!controller.signal.aborted) setResponseError(errorMessage(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 8000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [promptId, page, showOldAnswers]);

  async function act(operation: () => Promise<void>) {
    if (requestLock.current) return false;
    requestLock.current = true;
    setBusy(true); setError(''); setMessage('');
    try { await operation(); await load(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { requestLock.current = false; setBusy(false); }
  }

  function askToConfirm(next: Confirmation) {
    if (requestLock.current) return;
    setError('');
    setConfirmation(next);
  }

  async function confirmAction() {
    if (confirmation && await act(confirmation.operation)) setConfirmation(null);
  }

  function create() {
    if (!isTeachingClass(className)) { setError('请选择解构班或开发班。'); return; }
    if (!title.trim()) { setError('给这节课起一个名字，方便以后查找。'); return; }
    const payload = { class_name: className.trim(), title: title.trim() };
    const key = JSON.stringify(payload);
    if (createRequest.current?.key !== key) createRequest.current = { key, id: crypto.randomUUID() };
    askToConfirm({ title: '开放准备区？', scope: payload.class_name, description: '先开放准备区和课堂问答，选好两组任务后再开始本课。之前的课次和回答会保留。', confirmLabel: '开放准备区', preview: payload.title, operation: async () => {
      const session = await classroomAdmin<ClassroomSession>('/sessions', { ...payload, request_id: createRequest.current!.id });
      requestedClass.current = payload.class_name;
      setSelectedId(session.id); setCreating(false); setTitle(new Date().toLocaleDateString('zh-CN') + ' 课堂'); createRequest.current = null;
      setMessage('准备区已开放，可以发题；保存本课安排后再启动分组课堂。');
    } });
  }

  function changeState(action: 'open' | 'end') {
    if (!selected?.is_current) return;
    const label = selected.class_name || '所有班级';
    askToConfirm({ title: action === 'end' ? '现在下课？' : '重新开放课堂？', scope: label,
      description: action === 'end' ? '给学生 10 秒保存，然后关闭本班的学习和 AI 入口。数据保留，教师端不受影响。' : '本班学生可以继续编辑代码和使用 AI。',
      confirmLabel: action === 'end' ? '确认下课' : '重新开放', danger: action === 'end', operation: async () => {
      await classroomAdmin(`/sessions/${selected.id}/state`, { action });
      setMessage(action === 'end' ? '已通知下课，10 秒后关闭学习入口。' : '课堂已重新开放。');
    } });
  }

  function closePrompt() {
    const prompt = selected?.prompt;
    if (!selected?.is_current || !prompt) return;
    askToConfirm({ title: '结束本次回答？', scope: selected.class_name || '所有班级', description: '学生不能再提交本次问答，已收到的答案会保留。', confirmLabel: '结束回答', preview: prompt.title || prompt.question.text, operation: async () => {
      await classroomAdmin(`/prompts/${prompt.id}/close`, {});
      setMessage('本题已结束，答案保留。');
    } });
  }

  function selectSession(id: string) {
    setSelectedId(id); setPage(0); setResponseData(null); setResponseError(''); setError(''); setMessage('');
  }

  function selectClass(name: string) {
    requestedClass.current = name;
    const session = sessions.find(item => item.is_current && item.class_name === name);
    setClassName(name); selectSession(session?.id || ''); setCreating(!session);
  }

  return <div className="classroom-admin">
    <div className="classroom-toolbar"><p>选班上课，发作业、收作品。</p><div className="classroom-actions">
      <button disabled={busy} aria-label="刷新课堂" onClick={() => void load()}><RefreshCw size={18} />刷新</button>
      <button disabled={busy} className="classroom-primary" aria-expanded={creating} onClick={() => { setClassName(selected && isTeachingClass(selected.class_name) ? selected.class_name : className); setCreating(value => !value); }}><Plus size={18} />新的一课</button>
    </div></div>
    {loadError && <p className="classroom-error" role="alert">{loadError}</p>}
    {error && !confirmation && <p className="classroom-error" role="alert">{error}</p>}
    {message && <p className="classroom-message" role="status">{message}</p>}
    <nav className="classroom-class-tabs" aria-label="切换班级">{TEACHING_CLASSES.map(item => <button key={item.name} aria-pressed={(selected?.class_name || (creating ? className : '')) === item.name} disabled={busy || loading} onClick={() => selectClass(item.name)}>{item.name}</button>)}</nav>
    {sessions.length > 0 && <details className="classroom-history"><summary>查看以前的课</summary><label>课次<select value={selectedId} disabled={busy} onChange={event => { selectSession(event.target.value); setCreating(false); }}><option value="">选择历史课次</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.class_name} · {session.title} · {dateLabel(session.created_at)}</option>)}</select></label></details>}
    {creating && <form className="classroom-panel classroom-create" onSubmit={event => { event.preventDefault(); void create(); }}>
      <h2>开始一节课</h2><fieldset disabled={busy}>
        <div className="classroom-fields"><label>班级<select value={className} onChange={event => setClassName(event.target.value)}>{TEACHING_CLASSES.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <label>课次名称<input required maxLength={120} placeholder="例如：第 2 课 · 让蛇动起来" value={title} onChange={event => setTitle(event.target.value)} /></label></div>
        <div className="classroom-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button className="classroom-primary" type="submit">开始上课</button></div>
      </fieldset>
    </form>}
    {loading ? <p role="status">正在读取课堂…</p> : sessions.length === 0 ? <section className="classroom-empty"><DoorOpen size={32} /><h2>还没有课次</h2><p>点击“新的一课”选择班级。学生先进入准备区。</p></section> : <>
      {!selected && !creating && <p className="classroom-empty">点上面的班级开始一节课。旧课次和回答仍在“查看以前的课”中。</p>}
      {selected && <>
        <section className="classroom-panel classroom-session" aria-label="当前课次">
          <div><strong>{selected.class_name}</strong><p>{selected.title}</p></div>
          <div className="classroom-session-actions"><span className={`classroom-state is-${selected.state}`}>{selected.is_current ? stateLabel[selected.state] : '历史课次'}</span>
          {selected.is_current && <button disabled={busy || selected.state === 'closing'} className={selected.state === 'open' ? 'classroom-end' : 'classroom-primary'} onClick={() => changeState(selected.state === 'open' ? 'end' : 'open')}>{selected.state === 'open' ? <DoorClosed size={19} /> : <DoorOpen size={19} />}{selected.state === 'open' ? '下课' : selected.state === 'closing' ? '正在保存…' : '重新开放'}</button>}</div>
          {selected.state === 'closing' && selected.closes_at && <p className="classroom-closing-note">学生正在保存，将于 {dateLabel(selected.closes_at)} 关闭学习入口。</p>}
        </section>
        {selected.is_current && <LessonSetup key={selected.id} sessionId={selected.id} open={selected.state === 'open'} />}
        <LessonMaterials key={`materials-${selected.id}`} sessionId={selected.id} open={selected.is_current && selected.state === 'open'} />
        {selected.prompt && <details className="classroom-history" onToggle={event => setShowOldAnswers(event.currentTarget.open)}><summary>以前的课堂问答记录</summary>
          <section className="classroom-panel classroom-results"><header><h2>本次回答</h2>{selected.prompt && !selected.prompt.closed_at && selected.is_current && <button disabled={busy} onClick={closePrompt}>结束回答</button>}</header>
            {!selected.prompt ? <p className="classroom-empty">还未发题。发布后在这里查看回答。</p> : <>
              <p className="classroom-published-question">{selected.prompt.title || selected.prompt.question.text}</p>
              <p className="classroom-response-count"><strong>{responseData?.total ?? selected.response_count}</strong> 份回答{responseData ? ` / 班级当前 ${responseData.total_students} 人` : ''}<span>{selected.prompt.closed_at ? '本题已结束' : '收集中'}</span></p>
              {responseError && <p className="classroom-error" role="alert">{responseError} 将自动重试。</p>}
              {!responseData ? <p role="status">正在读取回答…</p> : responseData.responses.length === 0 ? <p className="classroom-empty">还没有回答，给学生一点时间。</p> : <>
                <div className="classroom-answer-table"><table><thead><tr><th scope="col">学生</th><th scope="col">回答</th></tr></thead><tbody>{responseData.responses.map(response => <tr key={response.id}><td><strong>{response.name}</strong><span>{response.student_id}</span></td><td>{responseData.prompt.questions ? <ol>{responseData.prompt.questions.map(q => <li key={q.id}><span>{q.text}</span>{classroomAnswerLabel({ ...responseData.prompt, question: q }, response.answers?.[q.id] ?? null)}</li>)}</ol> : classroomAnswerLabel(responseData.prompt, response.answer)}</td></tr>)}</tbody></table></div>
                {responseData.total > PAGE_SIZE && <div className="classroom-pagination"><button aria-label="上一页回答" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>第 {page + 1} / {Math.ceil(responseData.total / PAGE_SIZE)} 页</span><button aria-label="下一页回答" disabled={(page + 1) * PAGE_SIZE >= responseData.total} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div>}
              </>}
            </>}
          </section>
        </details>}
        <LessonEvidence key={`evidence-${selected.id}`} sessionId={selected.id} />
      </>}
    </>}
    <footer className="classroom-footnote">问卷、对话和作品可在 <Link to="/exports">数据导出</Link> 下载。<details><summary>下课开关的范围</summary>只关闭本班在平台内的学习和 AI 入口，不删除数据，也不影响学生本地的 Pi。</details></footer>
    {confirmation && <ClassroomConfirmation {...confirmation} busy={busy} error={error} onConfirm={() => void confirmAction()} onCancel={() => { if (!requestLock.current) { setConfirmation(null); setError(''); } }} />}
  </div>;
}
