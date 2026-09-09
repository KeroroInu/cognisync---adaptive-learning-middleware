import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { assessmentRequest, getPendingAssessment, type PendingAssessment } from '../services/assessments';
import './AssessmentGate.css';

export function Companion({ busy = false }: { busy?: boolean }) {
  // Original CSS character, no microphone, network animation, or third-party runtime.
  return <div className={`question-companion ${busy ? 'is-busy' : ''}`} aria-hidden="true"><i /><i /><span /></div>;
}

export const AssessmentConversation: React.FC<{
  round: PendingAssessment; userId: string; onDone: () => Promise<void>; onLogout: () => void;
}> = ({ round, userId, onDone, onLogout }) => {
  const key = `cognisync:assessment:v1:${userId}:${round.id}`;
  const [draft] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (value?.answers && typeof value.answers === 'object' && !Array.isArray(value.answers)
        && Number.isFinite(Date.parse(value.started_at)) && Date.parse(value.started_at) <= Date.parse(round.served_at)) {
        const clean: Record<string, string | null> = {};
        for (const q of round.questions) {
          const answer = value.answers[q.id];
          if (typeof answer === 'string' && answer.length <= 4000 && (q.type === 'text' || q.options.some(o => o.value === answer))) clean[q.id] = answer;
        }
        return { answers: clean, started_at: value.started_at };
      }
    } catch { /* unreadable draft is not imported */ }
    return { answers: {}, started_at: round.served_at };
  });
  const [answers, setAnswers] = useState<Record<string, string | null>>(draft.answers);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = round.questions[index];
  const answered = !question.required || Boolean(answers[question.id]?.trim());
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ answers, started_at: draft.started_at })); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, [answers, draft.started_at, key]);
  useEffect(() => { heading.current?.focus(); }, [index]);
  async function submit() {
    if (busy) return;
    const missing = round.questions.findIndex(q => q.required && !answers[q.id]?.trim());
    if (missing >= 0) { setIndex(missing); return; }
    setBusy(true); setError('');
    try {
      await assessmentRequest(`/${round.id}/responses`, { answers, started_at: draft.started_at });
      try { localStorage.removeItem(key); } catch { /* server already saved */ }
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : '没有保存成功，请重试。'); }
    finally { setBusy(false); }
  }
  return <main className="question-room">
    <header><span>CogniSync</span><button onClick={onLogout} disabled={busy}>退出登录</button></header>
    <section className="question-dialog" aria-label="课堂问卷">
      <Companion busy={busy} />
      <p className="question-greeting">我有几个问题想问你。</p>
      <p className="question-caption">按你的真实想法回答就好。题目由老师提供。</p>
      <div className="question-progress"><span>{index + 1} / {round.questions.length}</span><progress value={index + 1} max={round.questions.length} aria-label="答题进度" /></div>
      <h1 ref={heading} tabIndex={-1}>{question.text}</h1>
      {!question.required && <p className="question-caption">这题可以留空。</p>}
      {question.type === 'choice' ? <fieldset disabled={busy} className="question-options"><legend className="sr-only">选择你的回答</legend>
        {question.options.map(option => <label key={option.value} className={answers[question.id] === option.value ? 'is-selected' : ''}>
          <input type="radio" name={question.id} checked={answers[question.id] === option.value} onChange={() => setAnswers(a => ({ ...a, [question.id]: option.value }))} />
          <span>{option.label}</span>{answers[question.id] === option.value && <Check size={18} />}
        </label>)}
      </fieldset> : <textarea aria-label="你的回答" placeholder="写下你的想法…" maxLength={4000} disabled={busy} value={answers[question.id] || ''} onChange={e => setAnswers(a => ({ ...a, [question.id]: e.target.value }))} />}
      {storageWarning && <p role="status">浏览器未能保存草稿，请先完成本次填写再关闭页面。</p>}
      {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => void onDone().catch(e => setError(e instanceof Error ? e.message : '读取失败，请重试'))}>重新读取安排</button></div>}
      <footer><button disabled={index === 0 || busy} onClick={() => setIndex(i => i - 1)}><ArrowLeft size={18} />上一题</button>
        {index < round.questions.length - 1 ? <button className="question-primary" disabled={!answered || busy} onClick={() => setIndex(i => i + 1)}>下一题<ArrowRight size={18} /></button>
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
