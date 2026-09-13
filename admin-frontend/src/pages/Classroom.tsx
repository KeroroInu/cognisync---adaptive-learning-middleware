import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, DoorClosed, DoorOpen, MessageSquare, Plus, RefreshCw, Send, X } from 'lucide-react';
import { emptyQuestion, type AssessmentQuestion } from '../lib/assessments';
import { classroomAdmin, classroomAnswerLabel, validateClassroomQuestion, type ClassroomResponses, type ClassroomSession } from '../lib/classroom';
import './Classroom.css';

const PAGE_SIZE = 50;
const stateLabel = { open: '上课中', closing: '正在下课', closed: '已下课' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Classroom() {
  const [sessions, setSessions] = useState<ClassroomSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [className, setClassName] = useState('');
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState<AssessmentQuestion>(emptyQuestion);
  const [source, setSource] = useState('');
  const [responseData, setResponseData] = useState<ClassroomResponses | null>(null);
  const [responseError, setResponseError] = useState('');
  const [page, setPage] = useState(0);
  const requestLock = useRef(false);
  const listSequence = useRef(0);
  const createRequest = useRef<{ key: string; id: string } | null>(null);
  const publishRequest = useRef<{ key: string; id: string } | null>(null);
  const selected = sessions.find(session => session.id === selectedId);
  const promptId = selected?.prompt?.id;

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++listSequence.current;
    try {
      const result = await classroomAdmin<ClassroomSession[]>('/sessions', undefined, signal);
      if (signal?.aborted || sequence !== listSequence.current) return;
      setSessions(result);
      setSelectedId(previous => result.some(item => item.id === previous) ? previous : result[0]?.id || '');
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
    if (!promptId) return;
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
  }, [promptId, page]);

  async function act(operation: () => Promise<void>) {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true); setError(''); setMessage('');
    try { await operation(); await load(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { requestLock.current = false; setBusy(false); }
  }

  async function create() {
    if (!className.trim()) { setError('填写学生账号所属的班级，避免发到其他班。'); return; }
    if (!title.trim()) { setError('给这节课起一个名字，方便以后查找。'); return; }
    if (!window.confirm(`为“${className.trim()}”开始“${title.trim()}”？\n同一班级的旧课次会保留记录，并切换到本课。`)) return;
    const payload = { class_name: className.trim(), title: title.trim() };
    const key = JSON.stringify(payload);
    if (createRequest.current?.key !== key) createRequest.current = { key, id: crypto.randomUUID() };
    await act(async () => {
      const session = await classroomAdmin<ClassroomSession>('/sessions', { ...payload, request_id: createRequest.current!.id });
      setSelectedId(session.id); setCreating(false); setTitle(''); createRequest.current = null;
      setMessage('课堂已开始。学生可继续学习，下面可以发一道互动题。');
    });
  }

  async function changeState(action: 'open' | 'end') {
    if (!selected?.is_current) return;
    const label = selected.class_name || '所有班级';
    if (!window.confirm(action === 'end' ? `结束“${label}”的课堂？\n学生有 10 秒保存时间，之后不能继续学习或调用 AI。教师端不受影响。` : `重新开放“${label}”的课堂？`)) return;
    await act(async () => {
      await classroomAdmin(`/sessions/${selected.id}/state`, { action });
      setMessage(action === 'end' ? '已通知下课。保存时间结束后关闭学习入口；现有数据保留。' : '课堂已重新开放。');
    });
  }

  async function publish() {
    if (!selected?.is_current || selected.state !== 'open') return;
    const validation = validateClassroomQuestion(question);
    if (validation) { setError(validation); return; }
    if (!window.confirm(`向“${selected.class_name || '所有班级'}”发布这道题？\n学生会收到弹窗。题目发布后冻结，上一题的回答会保留。`)) return;
    const payload = { question: { ...question, text: question.text.trim(), options: question.type === 'choice' ? question.options.map(option => ({ value: option.value.trim(), label: option.label.trim() })) : [] }, source: source.trim() };
    const key = JSON.stringify({ session: selected.id, ...payload });
    if (publishRequest.current?.key !== key) publishRequest.current = { key, id: crypto.randomUUID() };
    await act(async () => {
      await classroomAdmin(`/sessions/${selected.id}/prompts`, { ...payload, request_id: publishRequest.current!.id });
      setQuestion(emptyQuestion()); setSource(''); publishRequest.current = null;
      setMessage('题目已发布。回答会自动更新，学生不需要离开当前代码。');
    });
  }

  function selectSession(id: string) {
    setSelectedId(id); setPage(0); setResponseData(null); setResponseError(''); setError(''); setMessage('');
  }

  return <div className="classroom-admin">
    <div className="classroom-toolbar"><p>开课、发题、收回答。下课后可关闭学生的学习入口。</p><div className="classroom-actions">
      <button disabled={busy} aria-label="刷新课堂" onClick={() => void load()}><RefreshCw size={18} />刷新</button>
      <button disabled={busy} className="classroom-primary" aria-expanded={creating} onClick={() => setCreating(value => !value)}><Plus size={18} />新课次</button>
    </div></div>
    {loadError && <p className="classroom-error" role="alert">{loadError}</p>}
    {error && <p className="classroom-error" role="alert">{error}</p>}
    {message && <p className="classroom-message" role="status">{message}</p>}
    {creating && <form className="classroom-panel classroom-create" onSubmit={event => { event.preventDefault(); void create(); }}>
      <h2>开始一节课</h2><fieldset disabled={busy}>
        <div className="classroom-fields"><label>班级<input required maxLength={100} placeholder="与学生管理中的班级一致" value={className} onChange={event => setClassName(event.target.value)} /></label>
          <label>课次名称<input required maxLength={120} placeholder="例如：第 2 课 · 让蛇动起来" value={title} onChange={event => setTitle(event.target.value)} /></label></div>
        <div className="classroom-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button className="classroom-primary" type="submit">开始上课</button></div>
      </fieldset>
    </form>}
    {loading ? <p role="status">正在读取课堂…</p> : sessions.length === 0 ? <section className="classroom-empty"><DoorOpen size={32} /><h2>还没有课次</h2><p>点击“新课次”开始。没有设置过开关的班级仍可正常学习。</p></section> : <>
      <label className="classroom-picker">选择课次<select disabled={busy} value={selectedId} onChange={event => selectSession(event.target.value)}>{sessions.map(session => <option key={session.id} value={session.id}>{session.class_name || '所有班级'} · {session.title} · {dateLabel(session.created_at)}{session.is_current ? '' : '（历史）'}</option>)}</select></label>
      {selected && <>
        <section className="classroom-panel classroom-session"><div><span className={`classroom-state is-${selected.state}`}>{selected.is_current ? stateLabel[selected.state] : '历史课次'}</span><h2>{selected.title}</h2><p>{selected.class_name || '所有班级'}{selected.state === 'closing' && selected.closes_at ? ` · 将于 ${dateLabel(selected.closes_at)} 关闭` : ''}</p></div>
          {selected.is_current && <button disabled={busy || selected.state === 'closing'} className={selected.state === 'open' ? 'classroom-end' : 'classroom-primary'} onClick={() => void changeState(selected.state === 'open' ? 'end' : 'open')}>{selected.state === 'open' ? <DoorClosed size={19} /> : <DoorOpen size={19} />}{selected.state === 'open' ? '下课 · 关闭学习入口' : selected.state === 'closing' ? '正在保存后关闭…' : '重新开放课堂'}</button>}
        </section>
        <div className="classroom-workspace">
          <section className="classroom-panel classroom-compose"><h2><MessageSquare size={21} />发一道题</h2>
            <form onSubmit={event => { event.preventDefault(); void publish(); }}><fieldset disabled={busy || !selected.is_current || selected.state !== 'open'}>
              <label>想问什么？<textarea required maxLength={2000} rows={3} placeholder="写下这一次想了解的问题。" value={question.text} onChange={event => setQuestion({ ...question, text: event.target.value })} /></label>
              <div className="classroom-question-settings"><label>回答方式<select value={question.type} onChange={event => setQuestion({ ...question, type: event.target.value as AssessmentQuestion['type'], options: event.target.value === 'text' ? [] : emptyQuestion().options })}><option value="choice">点选一个答案</option><option value="text">写一句话</option></select></label>
                <label className="classroom-checkbox"><input type="checkbox" checked={question.required} onChange={event => setQuestion({ ...question, required: event.target.checked })} />需要回答</label></div>
              {question.type === 'choice' && <div className="classroom-options">{question.options.map((option, index) => <div key={index}><span>{index + 1}</span><input required maxLength={300} aria-label={`选项 ${index + 1}`} placeholder="选项文字" value={option.label} onChange={event => setQuestion({ ...question, options: question.options.map((item, current) => current === index ? { ...item, label: event.target.value } : item) })} /><button type="button" disabled={question.options.length <= 2} aria-label={`删除选项 ${index + 1}`} onClick={() => setQuestion({ ...question, options: question.options.filter((_, current) => current !== index).map((item, current) => ({ ...item, value: String(current + 1) })) })}><X size={17} /></button></div>)}<button type="button" disabled={question.options.length >= 12} onClick={() => setQuestion({ ...question, options: [...question.options, { value: String(question.options.length + 1), label: '' }] })}><Plus size={16} />添加选项</button></div>}
              <details><summary>来源备注（仅教师可见）</summary><textarea aria-label="题目来源备注" maxLength={2000} rows={2} placeholder="如使用正式量表，填写来源与原始题号。" value={source} onChange={event => setSource(event.target.value)} /><p>这里是课堂提问，不会自动评分或改动画像。</p></details>
              <button type="submit" className="classroom-primary classroom-publish"><Send size={18} />发布到学生页面</button>
            </fieldset></form>
            {(!selected.is_current || selected.state !== 'open') && <p>重新开放当前课堂后才能发题；历史记录不会被覆盖。</p>}
          </section>
          <section className="classroom-panel classroom-results"><header><h2>本题回答</h2>{selected.prompt && !selected.prompt.closed_at && selected.is_current && <button disabled={busy} onClick={() => { if (window.confirm('结束这道题的回答？已提交的答案会保留。')) void act(async () => { await classroomAdmin(`/prompts/${selected.prompt!.id}/close`, {}); setMessage('本题已结束，答案保留。'); }); }}>结束回答</button>}</header>
            {!selected.prompt ? <p className="classroom-empty">还未发题。发布后在这里查看回答。</p> : <>
              <p className="classroom-published-question">{selected.prompt.question.text}</p>
              <p className="classroom-response-count"><strong>{responseData?.total ?? selected.response_count}</strong> 份回答{responseData ? ` / 班级当前 ${responseData.total_students} 人` : ''}<span>{selected.prompt.closed_at ? '本题已结束' : '收集中'}</span></p>
              {responseError && <p className="classroom-error" role="alert">{responseError} 将自动重试。</p>}
              {!responseData ? <p role="status">正在读取回答…</p> : responseData.responses.length === 0 ? <p className="classroom-empty">还没有回答，给学生一点时间。</p> : <>
                <div className="classroom-answer-table"><table><thead><tr><th scope="col">学生</th><th scope="col">回答</th></tr></thead><tbody>{responseData.responses.map(response => <tr key={response.id}><td><strong>{response.name}</strong><span>{response.student_id}</span></td><td>{classroomAnswerLabel(responseData.prompt, response.answer)}</td></tr>)}</tbody></table></div>
                {responseData.total > PAGE_SIZE && <div className="classroom-pagination"><button aria-label="上一页回答" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>第 {page + 1} / {Math.ceil(responseData.total / PAGE_SIZE)} 页</span><button aria-label="下一页回答" disabled={(page + 1) * PAGE_SIZE >= responseData.total} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div>}
              </>}
            </>}
          </section>
        </div>
      </>}
    </>}
    <footer className="classroom-footnote">历史题目、逐人答案和课次记录保存在数据库中，可到 <Link to="/exports">数据导出 → 课堂研究包</Link> 一并下载。下课开关不会删除数据，也不能关闭学生本地的 Pi。</footer>
  </div>;
}
