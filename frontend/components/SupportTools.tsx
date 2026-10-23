import React, { useEffect, useRef, useState } from 'react';
import './SupportTools.css';

export type SupportAction = 'message' | 'rephrase' | 'understood' | 'more' | 'complete' | 'try_self' | 'restore' | 'practice' | 'answer' | 'show_answer' | 'return_project' | 'idea_hint' | 'organize';
export type SupportChoice = { action: SupportAction; text: string; practiceId?: string; answer?: string };
export type SupportHistory = { id: string; question: string; reply: string; status: string }[];
export type SupportState = { level: number; paused: boolean; practice_available?: boolean; turn_id?: string;
  practice?: { instance_id: string; question: string; code: string; options: string[]; answered?: boolean } | null };

/** Shared shortcuts: no research labels, inferred mastery or automatic requests. */
type Props = { taskId?: string; stage?: string; focus?: string; entry?: string; busy: boolean;
  response?: SupportState | null; onAction: (choice: SupportChoice) => void; onRestore?: (history: SupportHistory) => void };
export const SupportTools: React.FC<Props> = ({ taskId, stage = 'build', focus = 'workspace', entry = 'classroom', busy, response,
  onAction, onRestore }) => {
  const [saved, setSaved] = useState<SupportState | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const restore = useRef(onRestore);
  const latestResponse = useRef(response);
  latestResponse.current = response;
  restore.current = onRestore;
  useEffect(() => {
    const controller = new AbortController();
    setSaved(null); setError(''); setConfirm(false);
    const params = new URLSearchParams({ stage, focus: focus || 'workspace', entry });
    if (taskId) params.set('task_id', taskId);
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/learning-support/state?${params}`, {
      signal: controller.signal, headers: { Authorization: `Bearer ${localStorage.getItem('cognisync-token') || ''}` },
    }).then(async res => {
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error('未能恢复帮助记录');
      if (!controller.signal.aborted) { setSaved(result.data); if (!latestResponse.current) restore.current?.(result.data.history); }
    }).catch(() => { if (!controller.signal.aborted) setError('帮助记录未恢复，稍后再试。'); });
    return () => controller.abort();
  }, [taskId, stage, focus, entry, attempt]);
  const state = response ?? saved;
  const choose = (action: SupportAction, text: string, answer?: string) => {
    setConfirm(false);
    onAction({ action, text, answer, practiceId: state?.practice?.instance_id });
  };
  return <div className="support-tools">
    {error && !response ? <p role="alert">{error}<button type="button" onClick={() => setAttempt(n => n + 1)}>重试</button></p> : null}
    {state?.practice ? <section aria-label="试一道" className="support-practice">
      <small>理解小检查 · 老师已审核 · 随时可退出</small>
      <p>{state.practice.question}</p><pre>{state.practice.code}</pre>
      {!state.practice.answered && <div>{state.practice.options.map(option => <button key={option} type="button" disabled={busy} onClick={() => choose('answer', `我的答案：${option}`, option)}>{option}</button>)}</div>}
      <div><button type="button" disabled={busy} onClick={() => choose('return_project', '回到项目')}>回到项目</button>
      {!state.practice.answered && <button type="button" disabled={busy} onClick={() => choose('show_answer', '我想看解释')}>看解释</button>}</div>
    </section> : state ? <>
      <div className="support-primary-actions">
        <button type="button" disabled={busy} onClick={() => choose('rephrase', '没理解，换个例子解释一下。')}>没理解</button>
        <button type="button" disabled={busy} onClick={() => choose('understood', '理解了。')}>理解了</button>
        <button type="button" disabled={busy} onClick={() => choose(state.paused ? 'restore' : 'try_self', state.paused ? '继续帮我。' : '我先试试。')}>{state.paused ? '继续帮我' : '我先试试'}</button>
      </div>
      <details><summary>需要更多帮助？</summary><div>
        {state.level < 2 ? <button type="button" disabled={busy} onClick={() => choose('more', '请把当前问题说得再具体一点。')}>再具体一点</button>
          : <button type="button" disabled={busy} onClick={() => setConfirm(true)}>看看完整示例</button>}
        {state.practice_available && <button type="button" disabled={busy} onClick={() => choose('practice', '我想试一道相关的小题。')}>试一道</button>}
      </div></details>
      {confirm && <section role="alertdialog" aria-label="查看完整示例" className="support-confirm">
        <p>查看当前问题的完整示例？已有对话会保留。</p>
        <button type="button" disabled={busy} onClick={() => choose('complete', '确认，请给当前功能的完整示例。')}>确认查看</button>
        <button type="button" onClick={() => setConfirm(false)}>先不用</button>
      </section>}
    </> : !error ? <small>正在恢复帮助记录…</small> : null}
  </div>;
};
