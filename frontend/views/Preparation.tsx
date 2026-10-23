import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Code2, LogOut, Play, Send, X } from 'lucide-react';
import type { ClassroomState } from '../services/classroom';
import { preparationDraftKey, preparationRequest, type PreparationRecord } from '../services/preparation';
import './Preparation.css';
import { ClassroomMaterials } from '../components/ClassroomMaterials';
import { AssessmentEntry } from '../components/AssessmentEntry';
import { useCompanionAssistant } from '../components/CompanionTools';
import { SupportTools, type SupportChoice, type SupportState } from '../components/SupportTools';

const Editor = React.lazy(() => import('../components/ResearchCodeEditor'));
const STARTER = '# 在这里试一小段 Python\nprint("你好，Python！")\n';
function readDraft(userId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(preparationDraftKey(userId)) || 'null');
    return value && typeof value.code === 'string' && value.code.length <= 50000
      ? { code: value.code as string, message: typeof value.message === 'string' ? value.message.slice(0, 4000) : '' } : null;
  } catch { return null; }
}
function Reply({ text }: { text: string }) {
  return <>{text.split(/```(?:python)?\n([\s\S]*?)```/g).map((part, index) => index % 2
    ? <pre key={index}><code>{part}</code></pre> : <p key={index}>{part}</p>)}</>;
}

export function Preparation({ userId, name, classroom, onEnter, onLogout, theme }: {
  userId: string; name: string; classroom: ClassroomState | null; onEnter: () => void; onLogout: () => void; theme: 'light' | 'dark';
}) {
  const [code, setCode] = useState(() => readDraft(userId)?.code ?? STARTER);
  const [message, setMessage] = useState(() => readDraft(userId)?.message ?? '');
  const [records, setRecords] = useState<PreparationRecord[]>([]);
  const [support, setSupport] = useState<SupportState | null>(null);
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [output, setOutput] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const [runCode, setRunCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saveLabel, setSaveLabel] = useState('正在读取…');
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [workspace, setWorkspace] = useState<'tasks' | 'python'>('tasks');
  const chatPanel = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const followConversation = useRef(true);
  const alive = useRef(true);
  const busyRun = useRef(false);
  const busyChat = useRef(false);
  const latest = useRef({ code, message });
  const savedCode = useRef<string | null>(null);
  const saveChain = useRef(Promise.resolve());
  const aiOpen = true;
  latest.current = { code, message };

  useEffect(() => { setSupport(null); }, [userId, classroom?.session?.id]);
  useEffect(() => {
    if (chatOpen && followConversation.current && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [records, chatOpen]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setError(''); setSaveLabel('正在读取…');
    void preparationRequest<PreparationRecord[]>().then(items => {
      if (cancelled) return;
      setRecords(items);
      const remote = items.filter(item => item.kind === 'save').at(-1)?.payload.request.code;
      savedCode.current = remote ?? null;
      if (!readDraft(userId) && remote !== undefined) setCode(remote);
      setReady(true); setSaveLabel('已恢复');
    }).catch(cause => { if (!cancelled) { setError(cause.message); setSaveLabel('尚未读取，不会覆盖云端'); } });
    return () => { cancelled = true; alive.current = false; };
  }, [userId, loadAttempt]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(preparationDraftKey(userId), JSON.stringify({ code, message })); }
    catch { setError('本机草稿保存失败，请先保存到服务器再离开。'); }
  }, [code, message, ready, userId]);

  useEffect(() => {
    if (!ready || workspace !== 'python') return;
    if (code === (savedCode.current ?? STARTER)) return;
    setSaveLabel('待同步');
    const timer = setTimeout(() => {
      const snapshot = code;
      saveChain.current = saveChain.current.catch(() => {}).then(async () => {
        if (alive.current) setSaveLabel('正在保存…');
        try {
          await preparationRequest({ request_id: crypto.randomUUID(), kind: 'save', code: snapshot });
          savedCode.current = snapshot;
          if (alive.current && latest.current.code === snapshot) setSaveLabel('已保存');
        } catch (cause) { if (alive.current) { setSaveLabel('仅存本机'); setError(cause instanceof Error ? cause.message : '保存失败'); } }
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [code, ready, userId, workspace]);

  async function run() {
    if (busyRun.current) return;
    busyRun.current = true; setRunning(true); setRunError(''); setShowOutput(true);
    const snapshot = code;
    let lines: string[] = []; let problem = '';
    try {
      const { runPythonProgram } = await import('../services/pythonModuleRunner');
      const result = await runPythonProgram(snapshot);
      lines = result.output; problem = result.error;
    } catch (cause) { problem = cause instanceof Error ? cause.message : '运行失败'; }
    if (alive.current) { setOutput(lines); setRunError(problem); setRunCode(snapshot); }
    try { await preparationRequest({ request_id: crypto.randomUUID(), kind: 'run', code: snapshot, last_run_code: snapshot, output: lines, error: problem }); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '运行记录未同步'); }
    finally { busyRun.current = false; if (alive.current) setRunning(false); }
  }

  async function send(choice?: SupportChoice) {
    if (!ready || (!message.trim() && !choice) || busyChat.current || !aiOpen) return;
    busyChat.current = true; setSending(true); setError('');
    const question = choice?.text ?? message.trim();
    const requestId = crypto.randomUUID();
    followConversation.current = true;
    if (!choice) { setMessage(''); composer.current?.focus(); }
    // Show the student's turn before waiting for the model; replace it in place
    // with the server record so history has no duplicate question.
    setRecords(previous => [...previous, { id: requestId, kind: 'chat', created_at: new Date().toISOString(), session_id: classroom?.session?.id ?? null,
      payload: { request: { code, message: question, output, error: runError }, status: 'client_sending' } }]);
    try {
      const record = await preparationRequest<PreparationRecord>({ request_id: requestId, kind: 'chat', code, last_run_code: runCode, message: question, output, error: runError,
        support_action: choice?.action ?? 'message', support_practice_id: choice?.practiceId, support_answer: choice?.answer });
      if (alive.current) {
        setRecords(previous => previous.map(item => item.id === requestId ? record : item));
        if (record.payload.support) setSupport(record.payload.support);
      }
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : '没有发送成功');
        setRecords(previous => previous.map(item => item.id === requestId ? { ...item, payload: { ...item.payload, status: 'client_error' } } : item));
        if (!choice) setMessage(draft => draft || question);
      }
    }
    finally { busyChat.current = false; if (alive.current) setSending(false); }
  }

  useCompanionAssistant(aiOpen, chatOpen && workspace === 'python', sending, () => {
    setWorkspace('python');
    setChatOpen(true);
    requestAnimationFrame(() => { const input = chatPanel.current?.querySelector('textarea'); input?.focus(); input?.scrollIntoView({ block: 'nearest' }); });
  });

  return <main className="preparation">
    <header className="preparation-header"><div className="preparation-brand"><span className="studio-brand-mark" aria-hidden="true">S</span><strong>SFLS<span>课堂工作台</span></strong></div>
      <nav aria-label="课堂导航"><button aria-pressed={workspace === 'tasks'} onClick={() => setWorkspace('tasks')}>我的课堂</button><button aria-pressed={workspace === 'python'} onClick={() => setWorkspace('python')}><Code2 size={15} />Python 小实验</button><AssessmentEntry /></nav>
      <div className="preparation-identity"><span>{name} · {classroom?.session?.class_name || '我的课堂'}</span><button aria-label="退出登录" title="退出登录" onClick={onLogout}><LogOut size={17} /></button></div>
    </header>
    {error ? <div className="preparation-error" role="alert">{error} {!ready && <button onClick={() => setLoadAttempt(value => value + 1)}>重新读取</button>}</div> : null}
    <div hidden={workspace !== 'tasks'} className="preparation-task-area"><ClassroomMaterials sessionId={classroom?.session?.id} userId={userId} embedded onToolboxOpen={() => setWorkspace('tasks')} onPython={() => setWorkspace('python')} /></div>
    {workspace === 'python' && <div className={`preparation-grid${chatOpen ? '' : ' chat-collapsed'}`}>
      <section className="preparation-code" aria-label="Python 小实验">
        <header><span><Code2 size={18} />Python 小实验</span><small role="status">{saveLabel}</small></header>
        <div className="preparation-editor">{ready ? <Suspense fallback={<p>正在打开编辑器…</p>}><Editor value={code} language="python" theme={theme} onChange={value => { if (value.length <= 50000) setCode(value); }} /></Suspense> : <p className="preparation-loading">先恢复你的草稿，再开始。</p>}</div>
        <div className="preparation-output"><button aria-expanded={showOutput} onClick={() => setShowOutput(value => !value)}>输出 {showOutput ? '⌄' : '›'}</button>
          {runCode !== null && runCode !== code ? <small>代码已修改，下面是上次运行的结果。</small> : null}
          {showOutput ? <pre aria-label="运行输出">{output.join('\n') || '运行后在这里看结果。'}{runError ? `\n${runError}` : ''}</pre> : null}</div>
        <footer><details><summary>能做什么？</summary>基础 Python、print、math、random。暂不支持 input、文件和桌面窗口。</details><button className="prep-primary" disabled={running || !ready} onClick={() => void run()}><Play size={17} />{running ? '运行中…' : '运行'}</button></footer>
      </section>
      <section ref={chatPanel} className="preparation-chat" aria-label="AI 对话" hidden={!chatOpen}><header><strong>一起试试</strong><span>只看到这里的小实验，不会读取电脑里的 SFLS 工程</span>{aiOpen && <button aria-label="收起 AI 助手" onClick={() => setChatOpen(false)}><X size={17} /></button>}</header>
        <div ref={conversation} className="preparation-messages" role="log" aria-label="训练区对话" aria-live="polite" aria-relevant="additions text" onScroll={event => {
          const element = event.currentTarget;
          followConversation.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}>
          {!records.some(item => item.kind === 'chat') ? <p className="preparation-welcome">想试什么？写几行，或者问我一句。</p> : records.filter(item => item.kind === 'chat').map(item => <div className="preparation-turn" key={item.id}>
            <article className="preparation-question" aria-label="我的消息"><small>我</small><p>{item.payload.request.message}</p>{item.payload.status === 'client_error' && <small>暂未确认回复，问题已保留</small>}</article>
            {item.payload.status !== 'client_error' && <article className="preparation-answer" aria-label="AI 的回复"><small>贪贪 · AI</small>{item.payload.status === 'client_sending' ? <p role="status">正在回复…</p> : <Reply text={item.payload.reply || '这条提问已保存，尚未收到回复。'} />}</article>}
          </div>)}
        </div>
        <details className="preparation-help" open={support?.practice ? true : undefined}><summary>需要一点提示？</summary>
          <SupportTools key={classroom?.session?.id || 'preparation'} entry="preparation" busy={sending || !ready || !aiOpen}
            response={support} onAction={choice => void send(choice)} />
        </details>
        <form className="preparation-composer" onSubmit={event => { event.preventDefault(); if (!composing.current) void send(); }}>
          <textarea ref={composer} aria-label="向 AI 提问" aria-describedby="preparation-chat-hint" placeholder={aiOpen ? '输入你的问题…' : '老师已关闭 AI，仍可测试 Python'} value={message} rows={2} maxLength={4000} onChange={event => setMessage(event.target.value)}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) void send(); } }} />
          <div className="preparation-composer-footer"><small id="preparation-chat-hint">{sending ? '等回复时也可以先写下一句' : 'Enter 发送 · Shift + Enter 换行'}</small><button type="submit" className="prep-primary" aria-label="发送问题" disabled={sending || !ready || !aiOpen || !message.trim()}><Send size={16} />{sending ? '回复中' : '发送'}</button></div>
        </form>
      </section>
    </div>}
  </main>;
}
