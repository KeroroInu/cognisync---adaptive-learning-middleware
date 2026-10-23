import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Copy, X, Trash2, ArrowUp, ArrowDown, Save, Search, RefreshCw, Send, Eye, Download, ChevronDown, ClipboardList, CheckCircle2 } from 'lucide-react';
import { assessmentAdmin, emptyQuestion, type AssessmentDraft, type AssessmentQuestion, type AssessmentRound } from '../lib/assessments';
import './Assessments.css';
import { AssessmentPreview } from '../components/AssessmentPreview';
import { TEACHING_CLASSES } from '../lib/teachingClasses';
import { createRequestId } from '../lib/requestId';
import { ASSESSMENT_KINDS, assessmentKind, assessmentTime, filterAssessmentLibrary, requiresAssessmentReview, type AssessmentKind } from '../lib/assessmentLibrary';

export function Assessments() {
  const [rounds, setRounds] = useState<AssessmentRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<{ id?: string; draft: AssessmentDraft } | null>(null);
  const [confirmation, setConfirmation] = useState<{ round: AssessmentRound; className: string; action: 'distribute' | 'end' } | null>(null);
  const [preview, setPreview] = useState<AssessmentRound | null>(null);
  const [className, setClassName] = useState('解构班');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssessmentKind>('全部');
  const library = rounds.filter(item => !item.published_at).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const ready = library.filter(item => !requiresAssessmentReview(item));
  const reviewedLater = library.filter(requiresAssessmentReview);
  const visibleLibrary = filterAssessmentLibrary(library, kind, query);
  const history = rounds.filter(item => item.published_at && item.class_name === className)
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  const active = history.filter(item => item.enabled), closed = history.filter(item => !item.enabled);
  const sending = useRef(false);
  const deliveryRequest = useRef<{ key: string; id: string } | null>(null);
  const editorInitial = useRef('');
  const dismissDialog = useRef(() => {});
  const load = useCallback(async () => {
    setRefreshing(true);
    try { setRounds(await assessmentAdmin<AssessmentRound[]>()); setError(''); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = () => {
    const draft: AssessmentDraft = { phase: 'pre', name: '课堂问卷', class_name: className, source: '', questions: [emptyQuestion()] };
    editorInitial.current = JSON.stringify(draft); setEditing({ draft });
    setError(''); setMessage('');
  };
  function edit(item: AssessmentRound, copy: boolean) {
    const draft: AssessmentDraft = {
      phase: item.phase, name: item.name, class_name: item.class_name, source: item.source,
      questions: structuredClone(item.questions),
    };
    editorInitial.current = JSON.stringify(draft);
    setEditing({ id: copy || item.published_at ? undefined : item.id, draft });
    setError(''); setMessage('');
  }
  function closeEditor() {
    if (busy || !editing) return;
    if (JSON.stringify(editing.draft) !== editorInitial.current && !window.confirm('放弃未保存的修改？已保存的题目和答卷不会受影响。')) return;
    setEditing(null); setError('');
  }
  const dialogOpen = !!(editing || confirmation || preview);
  dismissDialog.current = () => { if (!busy) { if (editing) closeEditor(); else { setConfirmation(null); setPreview(null); setError(''); } } };
  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.assessment-admin [role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || []).filter(node => node.getClientRects().length > 0);
    focusable()[0]?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); dismissDialog.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, [dialogOpen]);
  function confirm(item: AssessmentRound, action: 'distribute' | 'end' = 'distribute') {
    setError(''); setMessage(''); setConfirmation({ round: item, className, action });
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
  async function endRound(item: AssessmentRound) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await assessmentAdmin(`/${item.id}/availability`, { enabled: false });
      setConfirmation(null); setMessage('已结束填写，已提交的答案保留，可导出查看。'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); }
    finally { setBusy(false); }
  }
  async function distribute(item: AssessmentRound, targetClass: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    const key = `${item.id}:${targetClass}`;
    if (deliveryRequest.current?.key !== key) deliveryRequest.current = { key, id: createRequestId() };
    try {
      const delivered = await assessmentAdmin<AssessmentRound>(`/${item.id}/distribute`, { class_name: targetClass, request_id: deliveryRequest.current.id });
      setConfirmation(null); deliveryRequest.current = null;
      setMessage(delivered.enabled ? `已发给${targetClass}。学生可在“问卷与测试”填写。` : '这次发放已经结束，没有重新开启。需要再做一次时请重新发放。');
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
  function moreActions(item: AssessmentRound) {
    return <details className="assessment-more"><summary>更多<ChevronDown size={14} aria-hidden="true" /></summary>
      <div className="assessment-more-body"><div className="assessment-actions">
        <button disabled={busy} onClick={() => edit(item, false)}>{item.published_at ? '修改为新版' : '编辑题目'}</button>
        <button disabled={busy} onClick={() => edit(item, true)}><Copy size={15} aria-hidden="true" />复制</button>
        <button disabled={busy} onClick={() => void exportRound(item, true)}><Download size={15} aria-hidden="true" />下载题本</button>
      </div><p className="assessment-source">{item.source || '未填写来源与计分说明。'}</p></div>
    </details>;
  }
  return <div className="assessment-admin">
    <header className="assessment-page-header"><div><h1>题本库</h1><p>选好班级，找到题本，直接发放。</p></div><div className="assessment-actions">
      <button disabled={busy || refreshing} onClick={() => void load()} aria-label="刷新题本与记录"><RefreshCw size={16} aria-hidden="true" />{refreshing ? '刷新中…' : '刷新'}</button>
      <button disabled={busy} onClick={create}><Plus size={16} aria-hidden="true" />自定义题本</button>
    </div></header>
    <div className="assessment-delivery-toolbar"><nav aria-label="发放班级">{TEACHING_CLASSES.map(c => <button key={c.name} disabled={busy || dialogOpen} aria-pressed={className === c.name} onClick={() => { setClassName(c.name); setMessage(''); setError(''); }}>{c.name}</button>)}</nav><span>当前接收班级：<strong>{className}</strong></span></div>
    {error && !dialogOpen && <p className="assessment-error assessment-feedback" role="alert">{error}<button disabled={busy || refreshing} onClick={() => void load()}>重新读取</button></p>}
    {message && <p role="status" className="assessment-message"><CheckCircle2 size={18} aria-hidden="true" />{message}</p>}
    <div className="assessment-workbench">
      <section className="assessment-library-panel" aria-label="可发放题本" aria-busy={loading}>
        <header className="assessment-section-header"><div><h2>选择题本</h2><span>{ready.length} 份可用</span></div><label className="assessment-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="搜索题本" placeholder="搜索题本名称" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
        <nav className="assessment-filters" aria-label="题本分类">{ASSESSMENT_KINDS.map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value}</button>)}</nav>
        {loading ? <div className="assessment-empty" role="status">正在读取题本…</div> : <>
          <div className="assessment-library-list">
            {visibleLibrary.map(item => <article key={item.id} className="assessment-library-row" aria-label={item.name}>
              <div className="assessment-library-row-main"><div className="assessment-book-label"><ClipboardList size={20} aria-hidden="true" /><div><h3>{item.name}</h3><p>{assessmentKind(item)}<span>·</span>{item.questions.filter(q => !q.parent_id).length} 题</p></div></div>
                <div className="assessment-actions"><button disabled={busy} onClick={() => setPreview(item)}><Eye size={16} aria-hidden="true" />预览题目</button><button className="assessment-primary" disabled={busy} onClick={() => confirm(item)}><Send size={16} aria-hidden="true" />发给{className}</button></div>
              </div>{moreActions(item)}
            </article>)}
          </div>
          {!visibleLibrary.length && <div className="assessment-empty"><ClipboardList size={28} aria-hidden="true" /><strong>{query || kind !== '全部' ? '没有找到符合条件的题本' : '还没有可发放的题本'}</strong><p>{query || kind !== '全部' ? '换个名称，或查看全部题本。' : '可以新建一份自定义题本。'}</p><button onClick={() => { if (query || kind !== '全部') { setQuery(''); setKind('全部'); } else create(); }}>{query || kind !== '全部' ? '清除筛选' : '自定义题本'}</button></div>}
          {!!reviewedLater.length && <details className="assessment-review"><summary>待审阅材料 · {reviewedLater.length} 份<ChevronDown size={15} aria-hidden="true" /></summary><p>尚未审定，仅供预览和编辑，不直接发放。</p>{reviewedLater.map(item => <article key={item.id}><h3>{item.name}</h3><div className="assessment-actions"><button disabled={busy} onClick={() => setPreview(item)}>预览题目</button><button disabled={busy} onClick={() => edit(item, false)}>编辑草稿</button></div></article>)}</details>}
        </>}
      </section>
      <aside className="assessment-delivery-panel" aria-label="本班发放记录" aria-busy={loading}>
        <header className="assessment-section-header"><div><h2>本班发放</h2><span>{className}</span></div><button className="assessment-icon-button" aria-label="刷新本班答卷数" title="刷新答卷数" disabled={busy || refreshing} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /></button></header>
        {loading ? <p role="status">正在读取记录…</p> : <>
          {!active.length && <div className="assessment-no-active"><ClipboardList size={25} aria-hidden="true" /><p>当前没有开放的题本</p><span>从题本库选一份发给本班。</span></div>}
          {active.map(item => <article key={item.id} className="assessment-active-round" aria-label={`${item.name} · 开放中`}>
            <span className="assessment-status is-open">开放中</span><h3>{item.name}</h3><p className="assessment-published-at">{assessmentTime(item.published_at)} 发放</p>
            <p className="assessment-response-count">已收 <strong>{item.response_count}</strong> 份答卷</p>
            <div className="assessment-current-actions"><button className="assessment-export" disabled={busy} onClick={() => void exportRound(item)}><Download size={16} aria-hidden="true" />导出答卷 CSV</button><button className="assessment-end" disabled={busy} onClick={() => confirm(item, 'end')}>结束填写</button></div>
            <div className="assessment-actions"><button className="assessment-text-button" disabled={busy} onClick={() => setPreview(item)}>试填预览</button></div>{moreActions(item)}
          </article>)}
          <details key={className} className="assessment-history"><summary>已结束 · {closed.length} 次<ChevronDown size={15} aria-hidden="true" /></summary>
            {!closed.length && <p>暂无已结束的发放记录。</p>}
            {closed.map(item => <article key={item.id} className="assessment-history-row"><h3>{item.name}</h3><p>{assessmentTime(item.published_at)} · {item.response_count} 份答卷 · 第 {item.revision} 版</p><div className="assessment-actions"><button disabled={busy} onClick={() => void exportRound(item)}><Download size={15} aria-hidden="true" />导出答卷 CSV</button><button disabled={busy} onClick={() => confirm(item)}>再次发放</button><button disabled={busy} onClick={() => setPreview(item)}>试填预览</button></div>{moreActions(item)}</article>)}
          </details>
        </>}
        <p className="assessment-delivery-note">每班同时开放一份。历史题本与答卷始终保留。</p>
      </aside>
    </div>
    <p className="assessment-help">全部答卷和题本版本也可从“数据导出 → 课堂研究包”统一导出。</p>
    {preview && <AssessmentPreview round={preview} close={() => setPreview(null)} />}
    {confirmation && <div className="assessment-overlay"><section role="dialog" aria-modal="true" aria-labelledby="publish-title" className="assessment-confirm">
      <header><h2 id="publish-title">{confirmation.action === 'end' ? '结束填写？' : `发给${confirmation.className}？`}</h2><button disabled={busy} aria-label="关闭确认" onClick={() => setConfirmation(null)}><X size={18} /></button></header>
      <div className="assessment-confirm-book"><span>{confirmation.className} · {confirmation.round.questions.filter(q => !q.parent_id).length} 题</span><h3>{confirmation.round.name}</h3></div>
      {confirmation.action === 'end' ? <p>结束后，本班学生不能继续填写本轮题本。已提交的 {confirmation.round.response_count} 份答卷保留，仍可导出。</p> : <><p>本班正在填写的旧题本会结束，已交答卷保留。此次会新开一轮，做过的学生也需重新填写；其他班不受影响。</p><details><summary>来源与评分说明</summary><p className="assessment-source">{confirmation.round.source || '未填写'}</p></details></>}
      {error && <p role="alert" className="assessment-error">{error}</p>}
      <footer className="assessment-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button disabled={busy} className={confirmation.action === 'end' ? 'assessment-end' : 'assessment-primary'} onClick={() => void (confirmation.action === 'end' ? endRound(confirmation.round) : distribute(confirmation.round, confirmation.className))}>{busy ? '处理中…' : confirmation.action === 'end' ? '确认结束' : '确认发放'}</button></footer>
    </section></div>}
    {editing && <div className="assessment-overlay"><section className="assessment-editor" role="dialog" aria-modal="true" aria-labelledby="assessment-editor-title">
      <header><h2 id="assessment-editor-title">{editing.id ? '编辑题目' : '新题本'}</h2><button disabled={busy} aria-label="关闭编辑" onClick={closeEditor}><X size={18} /></button></header>
      <div className="assessment-editor-body">
        <div className="assessment-meta"><label>教师看到的名称<input maxLength={200} value={editing.draft.name} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} /></label>
        <p>保存题目即可，发放时再选接收班级。</p></div>
        <details className="assessment-data-marker"><summary>数据标记</summary><label>测量阶段<select aria-label="测量阶段" value={editing.draft.phase} disabled={!!editing.id} onChange={e => setEditing({ ...editing, draft: { ...editing.draft, phase: e.target.value as AssessmentDraft['phase'] } })}><option value="pre">前测</option><option value="post">后测</option></select></label><p>仅用于后台记录。需改阶段时先复制为新题本，原答卷不变。</p></details>
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
