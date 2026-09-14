import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, DoorClosed, MessageCircle, RefreshCw, X } from 'lucide-react';
import {
  answerClassroomPrompt, answerClassroomSet, CLASSROOM_ACCESS_EVENT, CLASSROOM_CLOSING_EVENT, CLASSROOM_OPEN_EVENT,
  classroomDraftKey, createClassroomPoller, getClassroomState, readClassroomDraft,
  type ClassroomPrompt, type ClassroomState,
} from '../services/classroom';
import './ClassroomGate.css';
import { AssessmentConversation } from './AssessmentGate';

function ClassroomQuestionSet({ prompt, userId, onAnswered, onDismiss }: {
  prompt: ClassroomPrompt; userId: string; onAnswered: () => void; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="classroom-set-dialog" aria-label="课堂小问答" onCancel={event => event.preventDefault()}>
    <AssessmentConversation round={{ id: prompt.id, questions: prompt.questions!, served_at: prompt.served_at }} userId={userId}
      onLogout={onDismiss} onDone={async () => onAnswered()}
      classroomSubmit={(answers, startedAt) => answerClassroomSet(prompt.id, answers, startedAt)} />
  </dialog>;
}

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

export const ClassroomGate: React.FC<{ userId: string; onLogout: () => void; children: React.ReactNode; preparation?: boolean; onState?: (state: ClassroomState) => void; onReturn?: () => void }> = ({ userId, onLogout, children, preparation = false, onState, onReturn }) => {
  const [state, setState] = useState<ClassroomState | null>(null);
  const [activated, setActivated] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState<'closing' | 'closed' | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const active = useRef(true);
  const epoch = useRef(0);
  const statusRef = useRef<string | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const frame = useRef<HTMLDivElement>(null);
  const reload = useCallback(async () => {
    const requestEpoch = epoch.current;
    try {
      const next = await getClassroomState();
      if (!active.current || epoch.current !== requestEpoch) return;
      setState(next); setError(''); setDenied(null);
      onState?.(next);
      if (!next.session || next.session.state !== 'closed') setActivated(true);
    } catch (e) { if (active.current && epoch.current === requestEpoch) setError(e instanceof Error ? e.message : '课堂连接暂时断开，正在重试。'); }
  }, [onState]);
  useEffect(() => {
    active.current = true;
    epoch.current++;
    const poller = createClassroomPoller(reload, () => document.visibilityState !== 'hidden');
    refresh.current = poller.refresh;
    const onVisible = () => { void poller.refresh(); };
    const onDenied = (event: Event) => {
      const code = (event as CustomEvent).detail?.code;
      setDenied(code === 'CLASSROOM_CLOSED' ? 'closed' : 'closing');
      void poller.refresh();
    };
    void poller.refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(CLASSROOM_ACCESS_EVENT, onDenied);
    return () => { active.current = false; epoch.current++; poller.stop(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.removeEventListener(CLASSROOM_ACCESS_EVENT, onDenied); };
  }, [reload]);
  const status = denied || state?.session?.state || (state ? 'open' : 'loading');
  const prompt = state?.prompt && state.prompt.id !== answeredId ? state.prompt : null;
  const promptVisible = Boolean(prompt && prompt.id !== dismissedId && status === 'open');
  useEffect(() => {
    // Only transitions trigger a flush; regular 3-second polling never writes code.
    if (status === statusRef.current || status === 'loading') return;
    const previous = statusRef.current;
    statusRef.current = status;
    if (status === 'closing' || status === 'closed') window.dispatchEvent(new CustomEvent(CLASSROOM_CLOSING_EVENT, { detail: { state: status } }));
    if (status === 'open' && previous !== 'open') window.dispatchEvent(new Event(CLASSROOM_OPEN_EVENT));
  }, [status]);
  const locked = !preparation && status !== 'open';
  useEffect(() => { if (frame.current) frame.current.inert = locked || promptVisible; }, [locked, promptVisible, activated]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  return <>
    {/* Never conditionally replace a previously mounted editor with the modal/closed screen. */}
    <div ref={frame} aria-hidden={locked || promptVisible ? true : undefined}>{activated || preparation ? children : null}</div>
    {locked ? <div className="classroom-shade classroom-lock" role="dialog" aria-modal="true" aria-labelledby="classroom-lock-title">
      <section className="classroom-question"><DoorClosed size={34} /><h1 id="classroom-lock-title">{status === 'loading' ? '正在连接课堂…' : status === 'closing' ? '这节课先到这里' : '课堂暂时关闭'}</h1>
        <p>{status === 'loading' ? '稍等一下，正在读取老师的安排。' : status === 'closing' ? '正在同步你的最后修改，请先不要关闭页面。' : '老师开课后，这里会自动恢复。'}</p>
        {status !== 'loading' ? <p className="classroom-muted">未同步的内容请保留在此浏览器，下次开课再继续。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>{onReturn ? <button type="button" disabled={status === 'closing'} onClick={onReturn}>回到准备区</button> : <button type="button" onClick={onLogout}>退出登录</button>}<button type="button" className="classroom-primary" onClick={() => void refresh.current()}><RefreshCw size={18} />重新检查</button></footer>
      </section>
    </div> : null}
    {status === 'open' && error ? <div className="classroom-connection" role="status">{error}</div> : null}
    {promptVisible && prompt ? React.createElement(prompt.questions?.length ? ClassroomQuestionSet : ClassroomQuestion, { key: `${userId}:${prompt.id}`, prompt, userId, onDismiss: () => setDismissedId(prompt.id), onAnswered: () => { setAnsweredId(prompt.id); setNotice('回答已交给老师'); void refresh.current(); } }) : null}
    {status === 'open' && prompt && !promptVisible ? <button type="button" className="classroom-question-reminder" onClick={() => setDismissedId(null)}><MessageCircle size={20} />课堂提问</button> : null}
    {notice ? <div className="classroom-toast" role="status"><Check size={18} />{notice}</div> : null}
  </>;
};
