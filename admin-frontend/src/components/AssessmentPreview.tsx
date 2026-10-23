import { useState } from 'react';
import { X } from 'lucide-react';
import type { AssessmentRound } from '../lib/assessments';
import { cleanVisibleAnswers, toggleMultiple, visibleQuestions, type AssessmentAnswers } from '../../../frontend/services/assessments';

/** In-memory rehearsal only: no answer API, localStorage, or student identity. */
export function AssessmentPreview({ round, close }: { round: AssessmentRound; close: () => void }) {
  const [answers, setAnswers] = useState<AssessmentAnswers>({});
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const all = visibleQuestions(round.questions, answers);
  const pages = all.filter(q => !q.parent_id);
  const current = Math.min(index, pages.length - 1);
  const question = pages[current];
  const update = (id: string, value: string | string[] | null) => setAnswers(previous => cleanVisibleAnswers(round.questions, { ...previous, [id]: value }));
  return <div className="assessment-overlay"><section className="assessment-editor assessment-preview" role="dialog" aria-modal="true" aria-labelledby="preview-title">
    <header><div><h2 id="preview-title">试填预览</h2><p>{round.name} · 不保存答案，不开放给学生</p></div><button aria-label="关闭预览" onClick={close}><X size={18} /></button></header>
    <div className="assessment-editor-body" key={current}>
      {finished ? <p role="status">预览完成，没有产生答卷。可以关闭，或重新试填。</p> : <>
        <p>{current + 1} / {pages.length} · 按选择跳题，补充项与原题一起填写</p>
        <h3>{question.text}</h3>
        {all.filter(q => q.id === question.id || q.parent_id === question.id).map(q => {
          const value = answers[q.id];
          const values = Array.isArray(value) ? value : [];
          return <section key={q.id} className="assessment-preview-field">
            {q.parent_id && <h4>{q.text}</h4>}
            {q.code && <pre><code>{q.code}</code></pre>}
            {q.hint && <p className="assessment-preserve-text">{q.hint}</p>}
            {q.type === 'text' ? <>
              <textarea aria-label={q.text} disabled={value === '__skip__'} maxLength={4000} value={typeof value === 'string' && value !== '__skip__' ? value : ''} onChange={e => update(q.id, e.target.value)} />
              {q.skip_label && <label><input type="checkbox" checked={value === '__skip__'} onChange={e => update(q.id, e.target.checked ? '__skip__' : null)} />{q.skip_label}</label>}
            </> : <fieldset><legend>{q.type === 'multiple' ? `可多选${q.max_selections ? `，最多${q.max_selections}项` : ''}` : '选一项'}{!q.required && '，也可留空'}</legend>{q.options.map(o => {
              const checked = q.type === 'multiple' ? values.includes(o.value) : value === o.value;
              const limited = q.type === 'multiple' && !checked && !o.exclusive && values.length >= (q.max_selections || q.options.length) && !values.some(v => q.options.find(opt => opt.value === v)?.exclusive);
              return <label key={o.value} className={checked ? 'is-selected' : ''}><input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={checked} disabled={limited} onChange={() => update(q.id, q.type === 'multiple' ? toggleMultiple(q, values, o.value) : o.value)} />{o.label}</label>;
            })}</fieldset>}
            {value != null && <button onClick={() => update(q.id, null)}>清空{q.parent_id ? '补充' : '这题'}</button>}
          </section>;
        })}
      </>}
    </div>
    <footer><button onClick={() => { setAnswers({}); setIndex(0); setFinished(false); }}>重新试填</button><div className="assessment-actions"><button disabled={current === 0 || finished} onClick={() => setIndex(current - 1)}>上一题</button><button className="assessment-primary" onClick={() => finished ? close() : current === pages.length - 1 ? setFinished(true) : setIndex(current + 1)}>{finished ? '关闭预览' : current === pages.length - 1 ? '完成预览' : '下一题'}</button></div></footer>
  </section></div>;
}
