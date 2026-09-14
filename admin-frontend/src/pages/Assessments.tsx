import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, X, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { assessmentAdmin, emptyQuestion, type AssessmentDraft, type AssessmentQuestion, type AssessmentRound } from '../lib/assessments';
import './Assessments.css';

export function Assessments() {
  const [rounds, setRounds] = useState<AssessmentRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ id?: string; draft: AssessmentDraft } | null>(null);
  const [confirmation, setConfirmation] = useState<AssessmentRound | null>(null);
  const load = useCallback(async () => {
    try { setRounds(await assessmentAdmin<AssessmentRound[]>()); setError(''); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = (phase: 'pre' | 'post') => {
    setEditing({ draft: { phase, name: phase === 'pre' ? '课前问卷' : '课后问卷', class_name: '', source: '', questions: [emptyQuestion()] } });
    setError(''); setMessage('');
  };
  function edit(item: AssessmentRound, copy: boolean) {
    setEditing({ id: copy || item.published_at ? undefined : item.id, draft: {
      phase: item.phase, name: item.name, class_name: item.class_name, source: item.source,
      questions: structuredClone(item.questions),
    } });
    setError(''); setMessage('');
  }
  async function save() {
    if (!editing || busy) return;
    setBusy(true); setError('');
    try {
      await assessmentAdmin(editing.id ? `/${editing.id}` : '', editing.draft, editing.id ? 'PUT' : 'POST');
      setEditing(null); setMessage('草稿已保存。点击“开放”后，学生才能看到。'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function toggle(item: AssessmentRound) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await assessmentAdmin(`/${item.id}/availability`, { enabled: !item.enabled });
      setConfirmation(null); setMessage(item.enabled ? '已关闭，已提交的答案保留。' : '已开放。已登录的学生会收到提醒；重新进入时先回答问卷。'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); }
    finally { setBusy(false); }
  }
  function patchQuestion(index: number, patch: Partial<AssessmentQuestion>) {
    setEditing(prev => prev && ({ ...prev, draft: { ...prev.draft, questions: prev.draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) } }));
  }
  return <div className="assessment-admin">
    <header><div><h1>问卷与量表</h1><p>首次题本可包含学情问卷和量表。开放后先填写再入课，同一版本已交过的不再重复。</p></div></header>
    {error && <p className="assessment-error" role="alert">{error}<button onClick={() => void load()}>重新读取</button></p>}
    {message && <p role="status" className="assessment-message">{message}</p>}
    {loading ? <p role="status">正在读取…</p> : <div className="assessment-phases">{(['pre', 'post'] as const).map(phase => <section key={phase}>
      <header><h2>{phase === 'pre' ? '首次填写' : '课后填写'}</h2><button disabled={busy} onClick={() => create(phase)}><Plus size={16} />新建题本</button></header>
      <p>{phase === 'pre' ? '账号注册完成后，先回答已开放的问卷，再进入课堂。' : '课堂结束后由老师开放，不需要学生重新注册。'}</p>
      {rounds.filter(r => r.phase === phase).length === 0 && <div className="assessment-empty">尚未安排 · 不会拦住学生入课</div>}
      {rounds.filter(r => r.phase === phase).map(item => <article key={item.id}>
        <div className="assessment-round-title"><strong>{item.name}</strong><span className={item.enabled ? 'is-open' : ''}>{item.enabled ? '开放中' : '已关闭'}</span></div>
        <p>{item.class_name || '所有班级'} · 第 {item.revision} 版 · {item.questions.length} 题 · {item.response_count} 份答卷</p>
        <div className="assessment-actions">
          <button disabled={busy} className={item.enabled ? '' : 'assessment-primary'} onClick={() => item.enabled ? void toggle(item) : setConfirmation(item)}>{item.enabled ? '关闭' : '开放'}</button>
          <button disabled={busy} onClick={() => edit(item, false)}>{item.published_at ? '修改为新版' : '编辑题目'}</button>
          <button disabled={busy} onClick={() => edit(item, true)} title="复制题本"><Copy size={16} />复制</button>
        </div>
      </article>)}
    </section>)}</div>}
    <p className="assessment-help">答卷与题本版本会进入“数据导出 → 课堂研究包”。本页不自动评分，也不更改学生画像。旧量表库和历史答案保持原状。</p>
    {confirmation && <div className="assessment-overlay"><section role="dialog" aria-modal="true" aria-labelledby="publish-title" className="assessment-confirm">
      <h2 id="publish-title">开放这份问卷？</h2><p>{confirmation.name} · {confirmation.class_name || '所有班级'}</p>
      <p>请确认题目、选项和来源已核对。同一范围的旧版会关闭；已完成旧版的学生也需要回答新版本。关闭后再开放同一版本，不要求重复作答。</p>
      <div className="assessment-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>再检查一下</button><button disabled={busy} className="assessment-primary" onClick={() => void toggle(confirmation)}>确认开放</button></div>
    </section></div>}
    {editing && <div className="assessment-overlay"><section className="assessment-editor" role="dialog" aria-modal="true" aria-labelledby="assessment-editor-title">
      <header><h2 id="assessment-editor-title">{editing.id ? '编辑题目' : '新题本'} · {editing.draft.phase === 'pre' ? '前测' : '后测'}</h2><button disabled={busy} aria-label="关闭编辑" onClick={() => setEditing(null)}><X size={18} /></button></header>
      <div className="assessment-editor-body">
        <div className="assessment-meta"><label>教师看到的名称<input maxLength={200} value={editing.draft.name} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} /></label>
        <label>班级（留空为所有班级）<input disabled={Boolean(editing.id)} maxLength={100} value={editing.draft.class_name} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, class_name: e.target.value } })} /></label></div>
        <label>来源与计分说明（教师备查，不展示给学生）<textarea maxLength={2000} rows={2} placeholder="填写量表来源、版本及计分说明；不要把示例题当作正式量表。" value={editing.draft.source} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, source: e.target.value } })} /></label>
        {editing.draft.questions.map((q, index) => <fieldset key={q.id} className="assessment-question"><legend>第 {index + 1} 题</legend>
          <div className="assessment-actions"><select aria-label={`第${index + 1}题类型`} value={q.type} onChange={e => patchQuestion(index, { type: e.target.value as AssessmentQuestion['type'], options: e.target.value === 'text' ? [] : emptyQuestion().options })}><option value="choice">单选 / 量表题</option><option value="text">简答题</option></select>
            <label className="assessment-checkbox"><input type="checkbox" checked={q.required} onChange={e => patchQuestion(index, { required: e.target.checked })} />必答</label>
            <button aria-label={`上移第${index + 1}题`} disabled={index === 0} onClick={() => { const questions = [...editing.draft.questions]; [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; setEditing({ ...editing, draft: { ...editing.draft, questions } }); }}><ArrowUp size={15} /></button>
            <button aria-label={`下移第${index + 1}题`} disabled={index === editing.draft.questions.length - 1} onClick={() => { const questions = [...editing.draft.questions]; [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]]; setEditing({ ...editing, draft: { ...editing.draft, questions } }); }}><ArrowDown size={15} /></button>
            <button aria-label={`删除第${index + 1}题`} disabled={editing.draft.questions.length === 1} onClick={() => setEditing({ ...editing, draft: { ...editing.draft, questions: editing.draft.questions.filter((_, i) => i !== index) } })}><Trash2 size={15} /></button>
          </div>
          <textarea aria-label={`第${index + 1}题题目`} maxLength={2000} rows={2} placeholder="粘贴题目原文，不需要改成聊天口吻。" value={q.text} onChange={e => patchQuestion(index, { text: e.target.value })} />
          {q.type === 'choice' && <div className="assessment-option-list">{q.options.map((option, j) => <div key={j}>
            <input aria-label={`第${index + 1}题选项${j + 1}值`} maxLength={100} value={option.value} onChange={e => patchQuestion(index, { options: q.options.map((o, k) => k === j ? { ...o, value: e.target.value } : o) })} />
            <input aria-label={`第${index + 1}题选项${j + 1}文字`} maxLength={300} placeholder="选项原文" value={option.label} onChange={e => patchQuestion(index, { options: q.options.map((o, k) => k === j ? { ...o, label: e.target.value } : o) })} />
            <button aria-label={`删除选项${j + 1}`} disabled={q.options.length <= 2} onClick={() => patchQuestion(index, { options: q.options.filter((_, k) => k !== j) })}><X size={15} /></button>
          </div>)}<button disabled={q.options.length >= 12} onClick={() => patchQuestion(index, { options: [...q.options, { value: String(q.options.length + 1), label: '' }] })}><Plus size={15} />添加选项</button></div>}
        </fieldset>)}
        <button disabled={editing.draft.questions.length >= 100} onClick={() => setEditing({ ...editing, draft: { ...editing.draft, questions: [...editing.draft.questions, emptyQuestion()] } })}><Plus size={16} />添加题目</button>
      </div>
      <footer>{error && <p role="alert" className="assessment-error">{error}</p>}<p>首次开放后，题目冻结；后续修改另存新版，保留原始答卷。</p><button disabled={busy} className="assessment-primary" onClick={() => void save()}><Save size={16} />{busy ? '正在保存…' : '保存草稿'}</button></footer>
    </section></div>}
  </div>;
}
