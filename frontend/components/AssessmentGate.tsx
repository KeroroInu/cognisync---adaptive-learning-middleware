import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { assessmentRequest, getPendingAssessment, visibleQuestions, cleanVisibleAnswers, toggleMultiple, validDraftAnswer, type AssessmentAnswers, type PendingAssessment } from '../services/assessments';
import './AssessmentGate.css';
import { Companion } from './Companion';

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
  const visible = visibleQuestions(round.questions, answers);
  const currentIndex = Math.min(index, visible.length - 1);
  const question = visible[currentIndex];
  const hasAnswer = (value: string | string[] | null | undefined) => Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  const answered = !question.required || hasAnswer(answers[question.id]);
  const updateAnswer = (value: string | string[] | null) => setAnswers(previous => cleanVisibleAnswers(round.questions, { ...previous, [question.id]: value }));
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ answers, started_at: draft.started_at })); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, [answers, draft.started_at, key]);
  useEffect(() => { heading.current?.focus(); }, [index]);
  async function submit() {
    if (submitting.current) return;
    const missing = visible.findIndex(q => q.required && !hasAnswer(answers[q.id]));
    if (missing >= 0) { setIndex(missing); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const submitted = Object.fromEntries(visible.map(q => [q.id, answers[q.id] ?? null]));
      if (classroomSubmit) await classroomSubmit(submitted, draft.started_at);
      else await assessmentRequest(`/${round.id}/responses`, { answers: submitted, started_at: draft.started_at });
      try { localStorage.removeItem(key); } catch { /* server already saved */ }
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '没有保存成功，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main className="question-room">
    <header><span>{classroomSubmit ? '课堂小问答' : 'CogniSync'}</span><button onClick={onLogout} disabled={busy}>{classroomSubmit ? '稍后回答' : '退出登录'}</button></header>
    <section className="question-dialog" aria-label="课堂问卷">
      <Companion busy={busy} />
      <p className="question-greeting">我有几个问题想问你。</p>
      <p className="question-caption">按你的真实想法回答就好。题目由老师提供。</p>
      <div className="question-progress"><span>{currentIndex + 1} / {visible.length}</span><progress value={currentIndex + 1} max={visible.length} aria-label="答题进度" /></div>
      {round.questions.some(q => q.show_if?.length) && <p className="question-caption">会按你的选择跳过不适用的问题。</p>}
      <h1 ref={heading} tabIndex={-1}>{question.text}</h1>
      {question.hint && <p className="question-caption">{question.hint}</p>}
      {!question.required && <p className="question-caption">这题可以留空。</p>}
      {question.type !== 'text' ? <fieldset disabled={busy} className="question-options"><legend className="question-caption">{question.type === 'multiple' ? `可以多选${question.max_selections ? `，最多 ${question.max_selections} 项` : ''}` : '选一项'}</legend>
        {question.options.map(option => {
          const values = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
          const checked = question.type === 'multiple' ? values.includes(option.value) : answers[question.id] === option.value;
          const limited = question.type === 'multiple' && !checked && !option.exclusive && values.length >= (question.max_selections || question.options.length) && !values.some(v => question.options.find(o => o.value === v)?.exclusive);
          return <label key={option.value} className={checked ? 'is-selected' : ''}>
            <input type={question.type === 'multiple' ? 'checkbox' : 'radio'} name={question.id} disabled={limited} checked={checked} onChange={() => updateAnswer(question.type === 'multiple' ? toggleMultiple(question, values, option.value) : option.value)} />
            <span>{option.label}</span>{checked && <Check size={18} />}
          </label>;
        })}
      </fieldset> : <textarea aria-label="你的回答" placeholder="简单说说就好，也可以留空。" maxLength={4000} disabled={busy} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} onChange={e => updateAnswer(e.target.value)} />}
      {!question.required && hasAnswer(answers[question.id]) && <button disabled={busy} onClick={() => updateAnswer(null)}>清空这题</button>}
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
  const [notified, setNotified] = useState(false);
  const [enter, setEnter] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async (initial = false, reportFailure = false) => {
    const request = ++generation.current;
    try {
      const next = await getPendingAssessment();
      if (request !== generation.current) return;
      setPending(next); setError(''); setLoaded(true);
      if (initial) setEnter(Boolean(next));
      else setNotified(Boolean(next));
      if (!next) setEnter(false);
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : '问卷安排读取失败');
      if (reportFailure) throw e;
    }
  }, []);
  useEffect(() => {
    void reload(true);
    const onFocus = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(onFocus, 60000);
    return () => { generation.current++; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [reload]);
  if (!loaded) return <main className="question-room question-loading"><Companion busy /><p role="status">{error || '正在读取老师的安排…'}</p>{error && <button onClick={() => void reload(true)}><RefreshCw size={16} />重试</button>}<button onClick={onLogout}>退出登录</button></main>;
  if (pending && enter) return <AssessmentConversation key={`${userId}:${pending.id}`} round={pending} userId={userId} onDone={() => reload(true, true)} onLogout={onLogout} />;
  return <>{children}{pending && notified && <div className="question-notice" role="status"><span>老师开放了一份问卷。</span><button onClick={() => setEnter(true)}>先去回答</button><button onClick={() => setNotified(false)}>稍后提醒</button></div>}</>;
}
