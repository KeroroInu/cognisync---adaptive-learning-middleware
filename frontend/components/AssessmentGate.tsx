import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { assessmentRequest, getPendingAssessment, getAssessmentStatus, visibleQuestions, cleanVisibleAnswers, toggleMultiple, validDraftAnswer, type AssessmentQuestion, type AssessmentAnswers, type PendingAssessment } from '../services/assessments';
import './AssessmentGate.css';
import { Companion } from './Companion';
import { AssessmentAccess, AssessmentStatus } from './AssessmentEntry';

export const AssessmentConversation: React.FC<{
  round: Pick<PendingAssessment, 'id' | 'questions' | 'served_at'>; userId: string; onDone: () => Promise<void>; onLogout: () => void;
  classroomSubmit?: (answers: AssessmentAnswers, startedAt: string) => Promise<unknown>;
}> = ({ round, userId, onDone, onLogout, classroomSubmit }) => {
  const key = `cognisync:${classroomSubmit ? 'classroom-set' : 'assessment'}:v1:${userId}:${round.id}`;
  const [draft] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (value?.answers && typeof value.answers === 'object' && !Array.isArray(value.answers)
        && Number.isFinite(Date.parse(value.started_at)) && Date.parse(value.started_at) <= Date.parse(round.served_at)) {
        const clean: AssessmentAnswers = {};
        for (const q of round.questions) {
          const answer = value.answers[q.id];
          if (validDraftAnswer(q, answer)) clean[q.id] = answer;
        }
        return { answers: cleanVisibleAnswers(round.questions, clean), started_at: value.started_at };
      }
    } catch { /* unreadable draft is not imported */ }
    return { answers: {}, started_at: round.served_at };
  });
  const [answers, setAnswers] = useState<AssessmentAnswers>(draft.answers);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const allVisible = visibleQuestions(round.questions, answers);
  const visible = allVisible.filter(q => !q.parent_id);
  const currentIndex = Math.min(index, visible.length - 1);
  const question = visible[currentIndex];
  const isCodeTest = round.questions.some(q => q.code);
  const hasAnswer = (value: string | string[] | null | undefined) => Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  const pageQuestions = allVisible.filter(q => q.id === question.id || q.parent_id === question.id);
  const answered = pageQuestions.every(q => !q.required || hasAnswer(answers[q.id]));
  const updateAnswer = (value: string | string[] | null, id = question.id) => setAnswers(previous => cleanVisibleAnswers(round.questions, { ...previous, [id]: value }));
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ answers, started_at: draft.started_at })); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, [answers, draft.started_at, key]);
  useEffect(() => { heading.current?.focus(); }, [index]);
  async function submit() {
    if (submitting.current) return;
    const missing = allVisible.find(q => q.required && !hasAnswer(answers[q.id]));
    if (missing) { setIndex(visible.findIndex(q => q.id === (missing.parent_id || missing.id))); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const submitted = Object.fromEntries(allVisible.map(q => [q.id, answers[q.id] ?? null]));
      if (classroomSubmit) await classroomSubmit(submitted, draft.started_at);
      else await assessmentRequest(`/${round.id}/responses`, { answers: submitted, started_at: draft.started_at });
      try { localStorage.removeItem(key); } catch { /* server already saved */ }
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '没有保存成功，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function field(q: AssessmentQuestion) {
    const value = answers[q.id];
    return <React.Fragment key={q.id}>
      {q.parent_id && <h2 className="question-subheading">{q.text}</h2>}
      {q.code && <pre className="question-code"><code>{q.code}</code></pre>}
      {q.hint && <p className="question-caption question-hint">{q.hint}</p>}
      {q.type !== 'text' ? <fieldset disabled={busy} className="question-options"><legend className="question-caption">{q.type === 'multiple' ? `可以多选${q.max_selections ? `，最多 ${q.max_selections} 项` : ''}` : '选一项'}</legend>
        {q.options.map(option => {
          const values = Array.isArray(value) ? value : [];
          const checked = q.type === 'multiple' ? values.includes(option.value) : value === option.value;
          const limited = q.type === 'multiple' && !checked && !option.exclusive && values.length >= (q.max_selections || q.options.length) && !values.some(v => q.options.find(o => o.value === v)?.exclusive);
          return <label key={option.value} className={checked ? 'is-selected' : ''}>
            <input type={q.type === 'multiple' ? 'checkbox' : 'radio'} name={q.id} disabled={limited} checked={checked} onChange={() => updateAnswer(q.type === 'multiple' ? toggleMultiple(q, values, option.value) : option.value, q.id)} />
            <span>{option.label}</span>{checked && <Check size={18} />}
          </label>;
        })}
      </fieldset> : <>
        <textarea aria-label={q.parent_id ? q.text : '你的回答'} placeholder={q.code ? '按题目中的空格顺序填写，可以分行。' : '简单说说就好，也可以留空。'} maxLength={4000} disabled={busy || value === '__skip__'} value={typeof value === 'string' && value !== '__skip__' ? value : ''} onChange={e => updateAnswer(e.target.value, q.id)} />
        {q.skip_label && <label className="question-skip"><input type="checkbox" disabled={busy} checked={value === '__skip__'} onChange={e => updateAnswer(e.target.checked ? '__skip__' : null, q.id)} />{q.skip_label}</label>}
      </>}
      {!q.required && hasAnswer(value) && <button className="question-clear" disabled={busy} onClick={() => updateAnswer(null, q.id)}>清空{q.parent_id ? '补充' : '这题'}</button>}
    </React.Fragment>;
  }
  return <main className={`question-room${isCodeTest ? ' is-code-test' : ''}`}>
    <header><span>{classroomSubmit ? '课堂小问答' : 'SFLS'}</span><button onClick={onLogout} disabled={busy}>{classroomSubmit ? '稍后回答' : '退出登录'}</button></header>
    <section className="question-dialog" aria-label="课堂问卷">
      {!isCodeTest && <Companion busy={busy} />}
      <p className="question-greeting">{isCodeTest ? '请独立完成这份测试。' : '我有几个问题想问你。'}</p>
      <p className="question-caption">{isCodeTest ? '按题目要求作答，不使用 AI 或运行工具。不会的题可以留空。' : '按你的真实想法回答就好。题目由老师提供。'}</p>
      <div className="question-progress"><span>{currentIndex + 1} / {visible.length}</span><progress value={currentIndex + 1} max={visible.length} aria-label="答题进度" /></div>
      {round.questions.some(q => q.show_if?.length) && <p className="question-caption">会按你的选择跳过不适用的问题。</p>}
      <h1 ref={heading} tabIndex={-1}>{question.text}</h1>
      {!question.required && <p className="question-caption">这题可以留空。</p>}
      {pageQuestions.map(field)}
      {storageWarning && <p role="status">浏览器未能保存草稿，请先完成本次填写再关闭页面。</p>}
      {error && <div role="alert"><p>{error}</p>{!classroomSubmit && <button disabled={busy} onClick={() => void onDone().catch(e => setError(e instanceof Error ? e.message : '读取失败，请重试'))}>重新读取安排</button>}</div>}
      <footer><button disabled={currentIndex === 0 || busy} onClick={() => setIndex(currentIndex - 1)}><ArrowLeft size={18} />上一题</button>
        {currentIndex < visible.length - 1 ? <button className="question-primary" disabled={!answered || busy} onClick={() => setIndex(currentIndex + 1)}>下一题<ArrowRight size={18} /></button>
          : <button className="question-primary" disabled={!answered || busy} onClick={() => void submit()}>{busy ? '正在保存…' : '提交回答'}<Check size={18} /></button>}
      </footer>
      <small>回答仅供老师和研究使用，不会在同学之间展示。</small>
    </section>
  </main>;
}

export const AssessmentGate: React.FC<{ userId: string; onLogout: () => void; children: React.ReactNode }> = ({ userId, onLogout, children }) => {
  const [pending, setPending] = useState<PendingAssessment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const current = useRef<PendingAssessment | null>(null);
  const initialized = useRef(false);
  const active = useRef<Promise<PendingAssessment | null | undefined> | null>(null);
  const generation = useRef(0);
  const failures = useRef(0);
  const reload = useCallback(async (force = false, reportFailure = false): Promise<PendingAssessment | null | undefined> => {
    // Polls share one request; explicit refreshes wait rather than overlap it.
    const epoch = generation.current;
    if (active.current) {
      if (!force) return active.current.catch(() => undefined);
      await active.current.catch(() => undefined);
      if (epoch !== generation.current) return;
      return reload(force, reportFailure);
    }
    const work = (async () => {
      try {
        let next = current.current;
        if (force || !initialized.current) next = await getPendingAssessment();
        else {
          const status = await getAssessmentStatus();
          if (!status) next = null;
          else if (status.id !== next?.id || status.revision !== next.revision) next = await getPendingAssessment();
        }
        if (epoch !== generation.current) return;
        current.current = next; initialized.current = true; failures.current = 0;
        setPending(next); setLoaded(true); setError('');
        if (next) setAccessOpen(false);
        return next;
      } catch (e) {
        if (epoch === generation.current) {
          failures.current++;
          setError(e instanceof Error ? e.message : '问卷安排读取失败');
        }
        if (reportFailure) throw e;
      }
    })();
    active.current = work;
    try { return await work; } finally { if (active.current === work) active.current = null; }
  }, []);
  const openAssessments = async () => {
    setAccessOpen(true);
    if (checking) return;
    setChecking(true);
    try { await reload(true, true); } catch { /* Keep a visible retry instead of a false empty state. */ }
    finally { setChecking(false); }
  };
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (!disposed && document.visibilityState === 'visible') {
        const delay = Math.min(60000, 6000 * 2 ** Math.min(failures.current, 3)) + Math.random() * 3000;
        timer = window.setTimeout(tick, delay);
      }
    };
    const tick = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      await reload();
      schedule();
    };
    const wake = () => {
      window.clearTimeout(timer);
      // Small jitter prevents the whole class returning to the tab in lockstep.
      if (document.visibilityState === 'visible') timer = window.setTimeout(tick, 250 + Math.random() * 750);
    };
    void reload(true).then(schedule);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true; generation.current++;
      window.clearTimeout(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [reload]);
  if (!loaded) return <main className="question-room question-loading"><Companion busy /><p role="status">{error || '正在读取老师的安排…'}</p>{error && <button onClick={() => void reload(true)}><RefreshCw size={16} />重试</button>}<button onClick={onLogout}>退出登录</button></main>;
  if (pending) return <AssessmentConversation key={`${userId}:${pending.id}`} round={pending} userId={userId} onDone={async () => { await reload(true, true); }} onLogout={onLogout} />;
  return <AssessmentAccess.Provider value={{ pending: false, open: () => void openAssessments() }}>
    {children}
    {accessOpen && <AssessmentStatus checking={checking} error={error} onRetry={() => void openAssessments()} onClose={() => setAccessOpen(false)} />}
  </AssessmentAccess.Provider>;
}
