import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Copy, X, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { assessmentAdmin, emptyQuestion, type AssessmentDraft, type AssessmentQuestion, type AssessmentRound } from '../lib/assessments';
import './Assessments.css';
import { AssessmentPreview } from '../components/AssessmentPreview';
import { TEACHING_CLASSES } from '../lib/teachingClasses';

export function Assessments() {
  const [rounds, setRounds] = useState<AssessmentRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ id?: string; draft: AssessmentDraft } | null>(null);
  const [confirmation, setConfirmation] = useState<AssessmentRound | null>(null);
  const [preview, setPreview] = useState<AssessmentRound | null>(null);
  const [className, setClassName] = useState('解构班');
  const library = rounds.filter(item => !item.published_at).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const needsReview = (item: AssessmentRound) => item.source.includes('题本代码：cps_');
  const history = rounds.filter(item => item.published_at && item.class_name === className);
  const sending = useRef(false);
  const deliveryRequest = useRef<{ key: string; id: string } | null>(null);
  const load = useCallback(async () => {
    try { setRounds(await assessmentAdmin<AssessmentRound[]>()); setError(''); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = () => {
    setEditing({ draft: { phase: 'pre', name: '课堂问卷', class_name: className, source: '', questions: [emptyQuestion()] } });
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
      setEditing(null); setMessage('草稿已保存。选好班级，再点击“发给该班”。'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function toggle(item: AssessmentRound) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await assessmentAdmin(`/${item.id}/availability`, { enabled: !item.enabled });
      setConfirmation(null); setMessage(item.enabled ? '已结束填写，已提交的答案保留。' : '已开放。学生可在“问卷与测试”中填写。'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); }
    finally { setBusy(false); }
  }
  async function distribute(item: AssessmentRound) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    const key = `${item.id}:${className}`;
    if (deliveryRequest.current?.key !== key) deliveryRequest.current = { key, id: crypto.randomUUID() };
    try {
      const delivered = await assessmentAdmin<AssessmentRound>(`/${item.id}/distribute`, { class_name: className, request_id: deliveryRequest.current.id });
      setConfirmation(null); deliveryRequest.current = null;
      setMessage(delivered.enabled ? `已发给${className}。学生点击顶部“问卷与测试”即可填写；其他班不会收到。` : '这次发放已经结束，没有重新开启。需要再做一次时请重新发放。');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '发放未确认，请重试'); }
    finally { sending.current = false; setBusy(false); }
  }
  function patchQuestion(index: number, patch: Partial<AssessmentQuestion>) {
    setEditing(prev => prev && ({ ...prev, draft: { ...prev.draft, questions: prev.draft.questions.map((q, i) => i === index ? { ...q, ...patch } : q) } }));
  }
  async function exportRound(item: AssessmentRound, definition = false) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/assessments/${item.id}/${definition ? 'definition' : 'export'}`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` } });
      if (!response.ok) { const error = await response.json(); throw new Error(typeof error.detail === 'string' ? error.detail : '导出失败'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `${definition ? '题本' : '问卷答卷'}-${item.id}.${definition ? 'json' : 'csv'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败，请重试'); }
    finally { setBusy(false); }
  }
  return <div className="assessment-admin">
    <header><div><h1>题本库</h1><p>选好班级，直接发放已有试卷、问卷或量表。</p></div></header>
    <div className="assessment-delivery-toolbar"><nav aria-label="发放班级">{TEACHING_CLASSES.map(c => <button key={c.name} disabled={busy} aria-pressed={className === c.name} onClick={() => setClassName(c.name)}>{c.name}</button>)}</nav><button disabled={busy} onClick={create}><Plus size={16} />自定义题本</button></div>
    {error && <p className="assessment-error" role="alert">{error}<button onClick={() => void load()}>重新读取</button></p>}
    {message && <p role="status" className="assessment-message">{message}</p>}
    {loading ? <p role="status">正在读取…</p> : <div className="assessment-phases"><section>
      <header><h2>选择题本</h2><span>当前发放给：{className}</span></header>
      {library.length === 0 && <div className="assessment-empty">题本库暂无内容。</div>}
      {library.filter(item => !needsReview(item)).map(item => <article key={item.id}>
        <div className="assessment-round-title"><strong>{item.name}</strong><span>{item.questions.filter(q => !q.parent_id).length} 题</span></div>
        <div className="assessment-actions"><button className="assessment-primary" disabled={busy} onClick={() => setConfirmation(item)}>发给{className}</button><button disabled={busy} onClick={() => setPreview(item)}>预览题目</button></div>
        <details><summary>来源、评分与编辑</summary><p>{item.source}</p><div className="assessment-actions"><button disabled={busy} onClick={() => edit(item, false)}>编辑题目</button><button disabled={busy} onClick={() => edit(item, true)}><Copy size={16} />复制</button><button disabled={busy} onClick={() => void exportRound(item, true)}>下载题本</button></div></details>
      </article>)}
      {library.some(needsReview) && <details><summary>待审阅材料</summary><p>以下自编量表尚未完成审定，暂不提供快捷发放。</p>{library.filter(needsReview).map(item => <article key={item.id}><strong>{item.name}</strong><p>{item.source}</p><button onClick={() => setPreview(item)}>预览题目</button><button onClick={() => edit(item, false)}>编辑草稿</button></article>)}</details>}
      <details open={history.some(item => item.enabled)}><summary>{className}的发放记录 · {history.length} 次</summary>
      {[...history].sort((a, b) => Number(b.enabled) - Number(a.enabled)).map(item => <article key={item.id}>
        <div className="assessment-round-title"><strong>{item.name}</strong><span className={item.enabled ? 'is-open' : ''}>{item.enabled ? '开放中' : item.published_at ? '已关闭' : '未开放草稿'}</span></div>
        <p>{item.class_name || '所有班级'} · 第 {item.revision} 版 · {item.questions.filter(q => !q.parent_id).length} 个主问题 · {item.response_count} 份答卷</p>
        <details><summary>来源、用途与计分说明</summary><p>{item.source || '尚未填写'}</p></details>
        <div className="assessment-actions">
          <button disabled={busy} onClick={() => setPreview(item)}>试填预览</button>
          <button disabled={busy || (item.enabled && item.class_name === className)} className="assessment-primary" onClick={() => setConfirmation(item)}>{item.enabled && item.class_name === className ? `${className}填写中` : `发给${className}`}</button>
          {item.enabled && <button disabled={busy} onClick={() => void toggle(item)}>结束填写</button>}
          <button disabled={busy} onClick={() => edit(item, false)}>{item.published_at ? '修改为新版' : '编辑题目'}</button>
          <button disabled={busy} onClick={() => edit(item, true)} title="复制题本"><Copy size={16} />复制</button>
          <button disabled={busy} onClick={() => void exportRound(item)}>导出答卷 CSV</button>
          <button disabled={busy} onClick={() => void exportRound(item, true)}>下载题本</button>
        </div>
      </article>)}
      </details>
    </section></div>}
    <p className="assessment-help">答卷与题本版本会进入“数据导出 → 课堂研究包”。本页不自动评分，也不更改学生画像。旧量表库和历史答案保持原状。</p>
    {preview && <AssessmentPreview round={preview} close={() => setPreview(null)} />}
    {confirmation && <div className="assessment-overlay"><section role="dialog" aria-modal="true" aria-labelledby="publish-title" className="assessment-confirm">
      <h2 id="publish-title">发给{className}？</h2><p>{confirmation.name}</p>
      <p><strong>接收班级：{className}</strong></p>
      <details><summary>查看来源与评分说明</summary><p>{confirmation.source}</p></details>
      <p>本班一次填写一份，正在填写的旧安排会结束，已交答卷保留。本次单独记录，做过这份题的学生也会收到新一轮；其他班不受影响。</p>
      {error && <p role="alert" className="assessment-error">{error}</p>}
      <div className="assessment-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button disabled={busy} className="assessment-primary" onClick={() => void distribute(confirmation)}>{busy ? '正在发放…' : '确认发放'}</button></div>
    </section></div>}
    {editing && <div className="assessment-overlay"><section className="assessment-editor" role="dialog" aria-modal="true" aria-labelledby="assessment-editor-title">
      <header><h2 id="assessment-editor-title">{editing.id ? '编辑题目' : '新题本'}</h2><button disabled={busy} aria-label="关闭编辑" onClick={() => setEditing(null)}><X size={18} /></button></header>
      <div className="assessment-editor-body">
        <div className="assessment-meta"><label>教师看到的名称<input maxLength={200} value={editing.draft.name} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} /></label>
        <p>保存题目即可，发放时再选接收班级。</p></div>
        <label>来源与计分说明（教师备查，不展示给学生）<textarea maxLength={2000} rows={2} placeholder="填写量表来源、版本及计分说明；不要把示例题当作正式量表。" value={editing.draft.source} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, source: e.target.value } })} /></label>
        {editing.draft.questions.map((q, index) => <fieldset key={q.id} className="assessment-question"><legend>第 {index + 1} 题</legend>
          <div className="assessment-actions"><select aria-label={`第${index + 1}题类型`} value={q.type} onChange={e => patchQuestion(index, { type: e.target.value as AssessmentQuestion['type'], skip_label: '', max_selections: null, options: e.target.value === 'text' ? [] : q.options.length ? q.options : emptyQuestion().options })}><option value="choice">单选 / 量表题</option><option value="multiple">多选题</option><option value="text">简答题</option></select>
            <label className="assessment-checkbox"><input type="checkbox" checked={q.required} onChange={e => patchQuestion(index, { required: e.target.checked })} />必答</label>
            <button aria-label={`上移第${index + 1}题`} disabled={index === 0} onClick={() => { const questions = [...editing.draft.questions]; [questions[index - 1], questions[index]] = [questions[index], questions[index - 1]]; setEditing({ ...editing, draft: { ...editing.draft, questions } }); }}><ArrowUp size={15} /></button>
            <button aria-label={`下移第${index + 1}题`} disabled={index === editing.draft.questions.length - 1} onClick={() => { const questions = [...editing.draft.questions]; [questions[index + 1], questions[index]] = [questions[index], questions[index + 1]]; setEditing({ ...editing, draft: { ...editing.draft, questions } }); }}><ArrowDown size={15} /></button>
            <button aria-label={`删除第${index + 1}题`} disabled={editing.draft.questions.length === 1} onClick={() => setEditing({ ...editing, draft: { ...editing.draft, questions: editing.draft.questions.filter((_, i) => i !== index) } })}><Trash2 size={15} /></button>
          </div>
          <textarea aria-label={`第${index + 1}题题目`} maxLength={2000} rows={2} placeholder="粘贴题目原文，不需要改成聊天口吻。" value={q.text} onChange={e => patchQuestion(index, { text: e.target.value })} />
          <label>作答说明<textarea maxLength={1000} rows={2} value={q.hint || ''} onChange={e => patchQuestion(index, { hint: e.target.value })} /></label>
          {q.parent_id && <p>补充字段：{q.id}，与主问题 {q.parent_id} 同页显示。</p>}
          {(q.code || editing.draft.questions.some(other => other.code)) && <label>题目代码（保留缩进，不执行）<textarea maxLength={6000} rows={5} value={q.code || ''} onChange={e => patchQuestion(index, { code: e.target.value })} /></label>}
          {q.skip_label && <label>简答题的勾选项<input maxLength={100} value={q.skip_label} onChange={e => patchQuestion(index, { skip_label: e.target.value })} /></label>}
          {q.show_if?.length ? <p>显示条件：{q.show_if.map(c => { const source = editing.draft.questions.find(other => other.id === c.question_id); return `“${source?.text || c.question_id}”选择${c.values.map(v => source?.options.find(o => o.value === v)?.label || v).join('或')}`; }).join('，并且')}。修改引用的选项后需同步题本规则。</p> : null}
          {q.type === 'multiple' && <label>最多选几项（留空不限）<input type="number" min={1} max={q.options.length} value={q.max_selections ?? ''} onChange={e => patchQuestion(index, { max_selections: e.target.value ? Number(e.target.value) : null })} /></label>}
          {q.type !== 'text' && <div className={`assessment-option-list${q.type === 'multiple' ? ' is-multiple' : ''}`}>{q.options.map((option, j) => <div key={j}>
            <input aria-label={`第${index + 1}题选项${j + 1}值`} maxLength={100} value={option.value} onChange={e => patchQuestion(index, { options: q.options.map((o, k) => k === j ? { ...o, value: e.target.value } : o) })} />
            <input aria-label={`第${index + 1}题选项${j + 1}文字`} maxLength={300} placeholder="选项原文" value={option.label} onChange={e => patchQuestion(index, { options: q.options.map((o, k) => k === j ? { ...o, label: e.target.value } : o) })} />
            {q.type === 'multiple' && <label><input type="checkbox" checked={Boolean(option.exclusive)} onChange={e => patchQuestion(index, { options: q.options.map((o, k) => k === j ? { ...o, exclusive: e.target.checked } : o) })} />单独选择</label>}
            <button aria-label={`删除选项${j + 1}`} disabled={q.options.length <= 2} onClick={() => patchQuestion(index, { options: q.options.filter((_, k) => k !== j) })}><X size={15} /></button>
          </div>)}<button disabled={q.options.length >= 12} onClick={() => patchQuestion(index, { options: [...q.options, { value: String(q.options.length + 1), label: '' }] })}><Plus size={15} />添加选项</button></div>}
        </fieldset>)}
        <button disabled={editing.draft.questions.length >= 100} onClick={() => setEditing({ ...editing, draft: { ...editing.draft, questions: [...editing.draft.questions, emptyQuestion()] } })}><Plus size={16} />添加题目</button>
      </div>
      <footer>{error && <p role="alert" className="assessment-error">{error}</p>}<p>首次开放后，题目冻结；后续修改另存新版，保留原始答卷。</p><button disabled={busy} className="assessment-primary" onClick={() => void save()}><Save size={16} />{busy ? '正在保存…' : '保存草稿'}</button></footer>
    </section></div>}
  </div>;
}
