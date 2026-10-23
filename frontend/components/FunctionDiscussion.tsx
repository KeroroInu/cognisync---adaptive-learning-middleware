import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { Language, UserProfile } from '../types';
import { sendChatMessage } from '../services/api';
import { createRequestId } from '../services/stageEvents';
import { captureCurrentSession } from '../data/workspaceScope';
import { functionDiscussionSummary, hasFunctionIdea, parseFunctionDiscussion, type FunctionDiscussionDraft } from '../data/functionDiscussion';
import { Companion } from './Companion';
import { AssistantMessage } from './AssistantMessage';

interface Props {
  language: Language;
  taskId: string;
  userId: string;
  allowAI: boolean;
  observation: string;
  draft: FunctionDiscussionDraft;
  onChange: (draft: FunctionDiscussionDraft) => void;
  onProfileUpdate: (profile: UserProfile) => void;
  onBusyChange: (busy: boolean) => void;
}

export const FunctionDiscussion: React.FC<Props> = ({ language, taskId, userId, allowAI, observation, draft, onChange, onProfileUpdate, onBusyChange }) => {
  const isZh = language === 'zh';
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [writeSteps, setWriteSteps] = useState(Boolean(draft.implementation));
  const alive = useRef(true);
  const inFlight = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const stream = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { stream.current?.scrollTo({ top: stream.current.scrollHeight }); }, [draft.messages.length, busy]);

  const send = async (choice?: {action:'idea_hint'|'organize';text:string}) => {
    const message = choice?.text ?? input.trim();
    if (!message || !draft.responsibility.trim() || !allowAI || inFlight.current) return;
    const sessionIsCurrent = captureCurrentSession();
    if (!sessionIsCurrent()) { setError(isZh ? '请重新登录后继续。' : 'Please sign in again.'); return; }
    inFlight.current = true;
    setBusy(true); onBusyChange(true); setError('');
    const requestId = createRequestId();
    const next: FunctionDiscussionDraft = { ...latest.current, messages: [...latest.current.messages,
      { requestId, role: 'user', action: choice?.action ?? 'message', text: message, createdAt: new Date().toISOString() }] };
    latest.current = next; onChange(next); if (!choice) setInput('');
    try {
      const response = await sendChatMessage({
        supportRequestId: requestId, supportAction: choice?.action ?? 'message',
        userId, message, language, isResearchMode: true,
        scaffoldContext: {
          requestId, taskId, stage: 'decompose', level: 0, trigger: 'student_message',
          interaction: 'function_discussion', currentModule: `function-discussion:${draft.id}`,
          artifactSummary: functionDiscussionSummary(observation, next),
        },
      });
      if (!alive.current || !sessionIsCurrent() || latest.current.id !== draft.id) return;
      const parsed = parseFunctionDiscussion(response.message);
      const updated: FunctionDiscussionDraft = { ...latest.current, messages: [...latest.current.messages,
        { requestId, role: 'assistant', text: response.message, steps: parsed.steps, createdAt: new Date().toISOString() }] };
      latest.current = updated; onChange(updated);
      if (response.updatedProfile) onProfileUpdate(response.updatedProfile);
    } catch (cause) {
      if (alive.current && sessionIsCurrent()) {
        if (!choice) setInput(message);
        setError(cause instanceof Error ? cause.message : (isZh ? '暂时没连上，你也可以先自己写步骤。' : 'Could not connect. You can write steps yourself.'));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) { setBusy(false); onBusyChange(false); }
    }
  };

  return <section className="function-discussion" aria-label={isZh ? '功能讨论' : 'Function discussion'}>
    <header><div className="function-discussion-pet"><Companion busy={busy} /></div><strong>{writeSteps ? (isZh ? '看看步骤，改一改' : 'Review your steps') : (isZh ? '和小家伙聊聊怎么做' : 'Talk through your idea')}</strong>
      {allowAI && (writeSteps || draft.implementation) && <button type="button" onClick={() => setWriteSteps(!writeSteps)}>{writeSteps ? (isZh ? '继续讨论' : 'Discuss') : (isZh ? '看我的步骤' : 'My steps')}</button>}
    </header>
    <div className="function-discussion-stream" ref={stream} role="log" aria-live="polite" hidden={writeSteps || !allowAI}>
      {!draft.messages.length && <p className="function-discussion-empty">{!allowAI
        ? (isZh ? '本次未开启 AI，可以直接写下步骤。' : 'AI is off. You can write your own steps.')
        : (isZh ? '什么时候发生？接着要做什么？先说一点想法，不用写代码。' : 'When does it happen, and what should happen next? Start with an idea, not code.')}</p>}
      {draft.messages.map((message, index) => {
        const parsed = message.role === 'assistant' ? parseFunctionDiscussion(message.text) : { text: message.text, steps: undefined };
        return <article key={`${message.requestId}-${index}`} className={`function-discussion-message is-${message.role}`}>
          <small>{message.role === 'user' ? (isZh ? '我' : 'Me') : (isZh ? '小家伙' : 'Companion')}</small>
          {message.role === 'user' ? <p>{message.text}</p> : <AssistantMessage text={parsed.text} language={language} />}
          {parsed.steps && <div className="function-discussion-suggestion"><pre>{parsed.steps}</pre>
            <button type="button" disabled={busy} onClick={() => {
              onChange({ ...draft, implementation: parsed.steps!, acceptedDraftRequestId: message.requestId });
              setWriteSteps(true);
            }}>{isZh ? '用这份草稿，再改一改' : 'Use and edit these steps'}</button>
          </div>}
        </article>;
      })}
      {busy && <p>{isZh ? '正在看你的想法…' : 'Thinking about your idea…'}</p>}
    </div>
    {error && <p className="function-discussion-error" role="alert">{error}</p>}
    {allowAI && !writeSteps && <div className="function-idea-tools">
      <button type="button" disabled={busy || !draft.responsibility.trim()} onClick={()=>void send({action:'idea_hint',text:isZh?'给我一点提示：用一个具体情境帮我想想这个功能怎么做。':'Give me one concrete situation to help me think.'})}>{isZh?'给我一点提示':'Give me a hint'}</button>
      <button type="button" disabled={busy || !draft.responsibility.trim() || !hasFunctionIdea(draft)} onClick={()=>void send({action:'organize',text:isZh?'帮我整理刚才的想法，形成简短的功能步骤。':'Organize my ideas into short steps.'})}>{isZh?'帮我整理思路':'Organize my ideas'}</button>
    </div>}
    {allowAI && !writeSteps && <form className="function-discussion-input" onSubmit={event => { event.preventDefault(); void send(); }}>
      <textarea aria-label={isZh ? '说说功能怎么做' : 'Describe your idea'} value={input} maxLength={1500} rows={2}
        placeholder={isZh ? '说说你的想法…（Enter 发送）' : 'Your idea… (Enter to send)'}
        disabled={busy} onChange={event => setInput(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); } }} />
      <button type="submit" aria-label={isZh ? '发送' : 'Send'} disabled={busy || !input.trim() || !draft.responsibility.trim()}><Send size={18} /></button>
    </form>}
    {!writeSteps && allowAI
      ? <button className="function-write-steps" type="button" onClick={() => setWriteSteps(true)}>{isZh ? '我想自己写步骤' : 'Write my own steps'}</button>
      : <label className="function-field is-implementation"><span>{isZh ? '我的步骤（可以改）' : 'My steps (editable)'}<small>{draft.implementation.length}/800</small></span>
        <textarea aria-label={isZh ? '我的步骤' : 'My steps'} value={draft.implementation} rows={4} maxLength={800}
          onChange={event => onChange({ ...draft, implementation: event.target.value })}
          placeholder={isZh ? '用短句写清楚先做什么、什么情况下做什么。' : 'Describe the steps and conditions in short sentences.'} /></label>}
  </section>;
};
