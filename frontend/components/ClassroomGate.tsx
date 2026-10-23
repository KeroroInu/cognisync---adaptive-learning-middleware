import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, MessageCircle, X } from 'lucide-react';
import {
  answerClassroomPrompt, CLASSROOM_OPEN_EVENT,
  classroomDraftKey, createClassroomPoller, getClassroomState, readClassroomDraft,
  type ClassroomPrompt, type ClassroomState,
} from '../services/classroom';
import './ClassroomGate.css';
import { CompanionAvailability } from './CompanionTools';
import { ClassroomPoll } from './ClassroomPoll';
import { ClassroomNotice } from './ClassroomNotice';

export const ClassroomQuestion: React.FC<{
  prompt: ClassroomPrompt; userId: string; onAnswered: () => void; onDismiss: () => void;
}> = ({ prompt, userId, onAnswered, onDismiss }) => {
  const [answer, setAnswer] = useState(() => readClassroomDraft(userId, prompt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const saving = useRef(false);
  const { question } = prompt;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const update = (value: string) => {
    setAnswer(value); setError('');
    try { localStorage.setItem(classroomDraftKey(userId, prompt.id), JSON.stringify(value)); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || (question.required && !answer.trim())) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await answerClassroomPrompt(prompt.id, answer.trim() ? answer : null);
      try { localStorage.removeItem(classroomDraftKey(userId, prompt.id)); } catch { /* Already saved remotely. */ }
      onAnswered();
    } catch (e) { setError(e instanceof Error ? e.message : '没有提交成功，请重试。'); }
    finally { saving.current = false; setBusy(false); }
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !saving.current) { event.stopPropagation(); onDismiss(); }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? []) as HTMLElement[];
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return <div className="classroom-shade">
    <section ref={dialog} className="classroom-question" role="dialog" aria-modal="true" aria-labelledby="classroom-question-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header><span><MessageCircle size={19} />老师想听听你的想法</span><button type="button" aria-label="稍后回答" disabled={busy} onClick={onDismiss}><X size={20} /></button></header>
      <form onSubmit={submit}>
        <h1 id="classroom-question-title">{question.text}</h1>
        {question.type === 'choice' ? <fieldset className="classroom-options" disabled={busy}><legend className="sr-only">选择你的回答</legend>
          {question.options.map(option => <label key={option.value} className={answer === option.value ? 'is-selected' : ''}>
            <input type="radio" name={`classroom-${prompt.id}`} checked={answer === option.value} onChange={() => update(option.value)} />
            <span>{option.label}</span>{answer === option.value ? <Check size={20} /> : null}
          </label>)}
        </fieldset> : <textarea aria-label="你的回答" placeholder="简单说说就好…" value={answer} maxLength={4000} disabled={busy} onChange={e => update(e.target.value)} />}
        {storageWarning ? <p role="status">本机草稿未能保存，请先提交再离开页面。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>{!question.required ? <button type="button" disabled={busy} onClick={() => update('')}>清空回答</button> : <span />}
          <button className="classroom-primary" disabled={busy || (question.required && !answer.trim())}>{busy ? '正在提交…' : question.required || answer.trim() ? '提交回答' : '跳过这题'}<Check size={18} /></button></footer>
        <small>回答发给老师，不会显示给同学。</small>
      </form>
    </section>
  </div>;
}


/** Kept as the polling host, no longer a start/end classroom gate. */
export const ClassroomGate: React.FC<{ userId: string; onLogout: () => void; children: React.ReactNode; preparation?: boolean; onState?: (state: ClassroomState) => void; onReturn?: () => void }> = ({ userId, children, onState }) => {
  const [state, setState] = useState<ClassroomState | null>(null);
  const [error, setError] = useState('');
  const [dismissedPoll, setDismissedPoll] = useState('');
  const [answeredPoll, setAnsweredPoll] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const active = useRef(true);
  const epoch = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const reload = useCallback(async () => {
    const requestEpoch = epoch.current;
    try {
      const next = await getClassroomState();
      if (!active.current || epoch.current !== requestEpoch) return;
      setState(next); setError(''); onState?.(next);
    } catch (e) {
      if (active.current && epoch.current === requestEpoch) {
        setError(e instanceof Error ? e.message : '连接暂时断开，正在重试。');
        // Sensitive notifications must not linger when auth or connectivity is lost.
        setState(previous => previous ? { ...previous, notice: null, notices: [] } : previous);
      }
    }
  }, [onState]);
  useEffect(() => {
    active.current = true; epoch.current++;
    setState(null); setDismissedPoll(''); setAnsweredPoll('');
    const poller = createClassroomPoller(reload, () => document.visibilityState !== 'hidden');
    refresh.current = poller.refresh;
    const onVisible = () => { void poller.refresh(); };
    void poller.refresh();
    window.dispatchEvent(new Event(CLASSROOM_OPEN_EVENT));
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active.current = false; epoch.current++; poller.stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reload, userId]);
  const poll = state?.prompt?.kind === 'poll' && state.prompt.id !== answeredPoll ? state.prompt : null;
  return <>
    <CompanionAvailability.Provider value={true}>{children}</CompanionAvailability.Provider>
    {error && <div className="classroom-connection" role="status">{error}</div>}
    <ClassroomNotice key={userId} notice={state?.notice ?? null} notices={state?.notices} userId={userId} onOpenChange={setNoticeOpen} />
    {poll && !noticeOpen && dismissedPoll !== poll.id ? <ClassroomPoll key={poll.id} prompt={poll} onDismiss={() => setDismissedPoll(poll.id)} onDone={() => { setAnsweredPoll(poll.id); void refresh.current(); }} /> : null}
    {poll && dismissedPoll === poll.id ? <button className="classroom-question-reminder" onClick={() => setDismissedPoll('')}>参与投票</button> : null}
  </>;
};
