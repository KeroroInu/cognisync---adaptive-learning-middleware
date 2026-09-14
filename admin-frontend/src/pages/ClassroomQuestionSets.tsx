import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Send, X } from 'lucide-react';
import { emptyQuestion, type AssessmentQuestion } from '../lib/assessments';
import { classroomAdmin, validateClassroomQuestion } from '../lib/classroom';

type QuestionSet = { id: string; title: string; questions: AssessmentQuestion[]; source: string };
type Draft = Omit<QuestionSet, 'id'>;
const blank = (): Draft => ({ title: '', questions: [emptyQuestion()], source: '' });

export function ClassroomQuestionSets({ sessionId, className, canSend, onSent }: {
  sessionId: string; className: string; canSend: boolean; onSent: () => Promise<void>;
}) {
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const selected = sets.find(item => item.id === selectedId);
  const load = useCallback(async (signal?: AbortSignal) => {
    const rows = await classroomAdmin<QuestionSet[]>('/question-sets', undefined, signal);
    if (signal?.aborted) return;
    setSets(rows); setSelectedId(id => rows.some(row => row.id === id) ? id : rows[0]?.id || '');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => { setMessage(''); setError(''); }, [sessionId]);
  function updateQuestion(index: number, change: Partial<AssessmentQuestion>) {
    setDraft(previous => ({ ...previous, questions: previous.questions.map((q, i) => i === index ? { ...q, ...change } : q) }));
  }
  async function run(kind: 'save' | 'send') {
    if (lock.current) return;
    if (kind === 'save') {
      const problem = !draft.title.trim() ? '给这组问答起个名字。' : draft.questions.map(validateClassroomQuestion).find(Boolean);
      if (problem) { setError(problem); return; }
    } else if (!canSend || !selected) return;
    const payload = kind === 'save' ? draft : { set_id: selected!.id };
    const key = JSON.stringify({ kind, sessionId: kind === 'send' ? sessionId : '', payload });
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      if (kind === 'save') {
        const result = await classroomAdmin<QuestionSet>('/question-sets', { ...payload, request_id: request.current.id });
        setSets(items => [result, ...items.filter(item => item.id !== result.id)]); setSelectedId(result.id); setEditing(false);
        setMessage('已保存。上课时选中它，发给本班即可。');
      } else {
        await classroomAdmin(`/sessions/${sessionId}/question-sets/send`, { ...payload, request_id: request.current.id });
        setMessage(`已发给${className}，学生会连续回答 ${selected!.questions.length} 道题。`);
        await onSent();
      }
      request.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="classroom-panel classroom-question-sets" aria-label="课堂小问答">
    <header><h2>课堂小问答</h2><button disabled={busy || editing} onClick={() => { setDraft(blank()); setEditing(true); setError(''); }}><Plus size={18} />准备一组题</button></header>
    <div className="classroom-set-send">
      <label>选择问答<select aria-label="选择问答" disabled={busy || editing} value={selectedId} onChange={event => { setSelectedId(event.target.value); setMessage(''); }}><option value="">{sets.length ? '请选择' : '还没准备题目'}</option>{sets.map(item => <option key={item.id} value={item.id}>{item.title} · {item.questions.length} 题</option>)}</select></label>
      <button className="classroom-primary" disabled={busy || editing || !selected || !canSend} onClick={() => void run('send')}><Send size={18} />发给{className}</button>
    </div>
    <p>{canSend ? '点一次，学生逐题回答。' : '课堂需开放，且上一组回答已结束，才能发送。'}</p>
    {message && <p className="classroom-message" role="status">{message}</p>}
    {error && <p className="classroom-error" role="alert">{error}<button disabled={busy} onClick={() => void load().catch(cause => setError(cause.message))}>刷新列表</button></p>}
    {selected && !editing && <details><summary>预览 / 修改题目</summary><ol>{selected.questions.map(q => <li key={q.id}><p>{q.text}</p>{q.type === 'choice' && <small>{q.options.map(o => o.label).join(' / ')}</small>}</li>)}</ol><button onClick={() => { setDraft({ title: selected.title, questions: structuredClone(selected.questions), source: selected.source }); setEditing(true); }}>修改并另存一份</button></details>}
    {editing && <form className="classroom-set-editor" onSubmit={event => { event.preventDefault(); void run('save'); }}><fieldset disabled={busy}>
      <label>问答名称<input required maxLength={120} placeholder="例如：今天遇到困难时" value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} /></label>
      {draft.questions.map((q, index) => <section key={q.id} className="classroom-set-item">
        <header><strong>第 {index + 1} 题</strong><button type="button" disabled={draft.questions.length === 1} aria-label={`删除第 ${index + 1} 题`} onClick={() => setDraft(previous => ({ ...previous, questions: previous.questions.filter((_, i) => i !== index) }))}><X size={16} /></button></header>
        <label>问题<textarea aria-label={`第 ${index + 1} 题问题`} required rows={2} maxLength={2000} value={q.text} onChange={event => updateQuestion(index, { text: event.target.value })} /></label>
        <div className="classroom-question-settings"><label>回答方式<select aria-label={`第 ${index + 1} 题回答方式`} value={q.type} onChange={event => updateQuestion(index, { type: event.target.value as AssessmentQuestion['type'], options: event.target.value === 'choice' ? emptyQuestion().options : [] })}><option value="choice">点选答案</option><option value="text">写一句话</option></select></label><label className="classroom-checkbox"><input type="checkbox" checked={q.required} onChange={event => updateQuestion(index, { required: event.target.checked })} />必答</label></div>
        {q.type === 'choice' && <label>选项（每行一个，2–12 个）<textarea rows={3} maxLength={3611} value={q.options.map(o => o.label).join('\n')} onChange={event => updateQuestion(index, { options: event.target.value.split('\n').map((label, i) => ({ value: String(i + 1), label })) })} /></label>}
      </section>)}
      <button type="button" disabled={draft.questions.length >= 20} onClick={() => setDraft(previous => ({ ...previous, questions: [...previous.questions, emptyQuestion()] }))}><Plus size={16} />加一道题</button>
      <details><summary>来源备注（仅教师可见）</summary><textarea aria-label="问答来源" maxLength={2000} value={draft.source} onChange={event => setDraft(previous => ({ ...previous, source: event.target.value }))} /></details>
      <div className="classroom-actions"><button type="button" onClick={() => setEditing(false)}>收起</button><button className="classroom-primary" type="submit">{busy ? '保存中…' : '保存问答'}</button></div>
    </fieldset></form>}
  </section>;
}
