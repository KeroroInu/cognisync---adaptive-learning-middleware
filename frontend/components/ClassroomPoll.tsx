import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { answerClassroomPrompt, type ClassroomPrompt } from '../services/classroom';
import './ClassroomPoll.css';

/** Click once to cast a vote; uncertain retries keep the same choice. */
export function ClassroomPoll({ prompt, onDone, onDismiss }: {
  prompt: ClassroomPrompt; onDone: () => void; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  async function vote(value: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setAttempt(value); setError('');
    try { await answerClassroomPrompt(prompt.id, value); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : '投票未确认，请重试。'); }
    finally { sending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="student-poll" aria-labelledby="student-poll-title" onCancel={e => { e.preventDefault(); if (!busy) onDismiss(); }}>
    <header><span>课堂投票</span><button aria-label="稍后投票" disabled={busy} onClick={onDismiss}><X size={20} /></button></header>
    <h2 id="student-poll-title">{prompt.question.text}</h2>
    <p>点一个选项就好，每人一票。</p>
    <div className="student-poll-options">{prompt.question.options.map(o => <button key={o.value} disabled={busy || (attempt !== null && attempt !== o.value)} onClick={() => void vote(o.value)}>
      <span>{o.value.toUpperCase()}</span>{o.label}{busy && attempt === o.value ? ' · 正在提交…' : ''}
    </button>)}</div>
    {error && <p role="alert">{error}<br />如未结束，可点击刚才的选项重试。</p>}
    <small>只作课堂互动，不计分。选择会保存给老师。</small>
  </dialog>;
}
