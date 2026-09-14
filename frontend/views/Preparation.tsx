import React, { Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Code2, LogOut, Play, Send } from 'lucide-react';
import type { ClassroomState } from '../services/classroom';
import { preparationDraftKey, preparationRequest, type PreparationRecord } from '../services/preparation';
import './Preparation.css';
import { ClassroomMaterials } from '../components/ClassroomMaterials';

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

export function Preparation({ userId, name, classroom, onEnter, onLogout }: {
  userId: string; name: string; classroom: ClassroomState | null; onEnter: () => void; onLogout: () => void;
}) {
  const [code, setCode] = useState(() => readDraft(userId)?.code ?? STARTER);
  const [message, setMessage] = useState(() => readDraft(userId)?.message ?? '');
  const [records, setRecords] = useState<PreparationRecord[]>([]);
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
  const alive = useRef(true);
  const busyRun = useRef(false);
  const busyChat = useRef(false);
  const latest = useRef({ code, message });
  const savedCode = useRef<string | null>(null);
  const saveChain = useRef(Promise.resolve());
  const entry = classroom?.lesson_entry;
  const aiOpen = !classroom?.session || classroom.session.state === 'open';
  latest.current = { code, message };

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
    if (!ready) return;
    if (code === savedCode.current) return;
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
  }, [code, ready, userId]);

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

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || !message.trim() || busyChat.current || !aiOpen) return;
    busyChat.current = true; setSending(true); setError('');
    const question = message;
    try {
      const record = await preparationRequest<PreparationRecord>({ request_id: crypto.randomUUID(), kind: 'chat', code, last_run_code: runCode, message: question, output, error: runError });
      if (alive.current) {
        setRecords(previous => [...previous, record]);
        if (latest.current.message === question) setMessage('');
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '没有发送成功'); }
    finally { busyChat.current = false; if (alive.current) setSending(false); }
  }

  return <main className="preparation">
    <header className="preparation-header"><div><strong>准备区</strong><span>{name}，先试一试。</span></div>
      <div><ClassroomMaterials sessionId={classroom?.session?.id} />{entry ? <button className="prep-primary" disabled={running || sending} onClick={onEnter}>进入本课：{entry.title}<ArrowRight size={18} /></button>
        : <span role="status">{classroom ? '等待老师开始本课' : '正在连接课堂…'}</span>}<button aria-label="退出登录" onClick={onLogout}><LogOut size={18} /></button></div>
    </header>
    {error ? <div className="preparation-error" role="alert">{error} {!ready && <button onClick={() => setLoadAttempt(value => value + 1)}>重新读取</button>}</div> : null}
    <div className="preparation-grid">
      <section className="preparation-code" aria-label="Python 小实验">
        <header><span><Code2 size={18} />Python 小实验</span><small role="status">{saveLabel}</small></header>
        <div className="preparation-editor">{ready ? <Suspense fallback={<p>正在打开编辑器…</p>}><Editor value={code} language="python" theme="dark" onChange={value => { if (value.length <= 50000) setCode(value); }} /></Suspense> : <p className="preparation-loading">先恢复你的草稿，再开始。</p>}</div>
        <div className="preparation-output"><button aria-expanded={showOutput} onClick={() => setShowOutput(value => !value)}>输出 {showOutput ? '⌄' : '›'}</button>
          {runCode !== null && runCode !== code ? <small>代码已修改，下面是上次运行的结果。</small> : null}
          {showOutput ? <pre aria-label="运行输出">{output.join('\n') || '运行后在这里看结果。'}{runError ? `\n${runError}` : ''}</pre> : null}</div>
        <footer><details><summary>能做什么？</summary>基础 Python、print、math、random。暂不支持 input、文件和桌面窗口。</details><button className="prep-primary" disabled={running || !ready} onClick={() => void run()}><Play size={17} />{running ? '运行中…' : '运行'}</button></footer>
      </section>
      <section className="preparation-chat" aria-label="AI 对话"><header><strong>一起试试</strong><span>AI 能看到左边的代码和运行输出</span></header>
        <div className="preparation-messages" aria-live="polite">
          {!records.some(item => item.kind === 'chat') ? <p className="preparation-welcome">想试什么？写几行，或者问我一句。</p> : records.filter(item => item.kind === 'chat').map(item => <article key={item.id}><p className="preparation-question">{item.payload.request.message}</p><div><Reply text={item.payload.reply || '这条提问已保存，尚未收到回复。'} /></div></article>)}
          {sending ? <p role="status">AI 正在回复…</p> : null}
        </div>
        <form onSubmit={event => void send(event)}><textarea aria-label="向 AI 提问" placeholder={aiOpen ? '哪里不明白？Enter 发送，Shift+Enter 换行' : '老师已关闭 AI，仍可测试 Python'} value={message} maxLength={4000} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="prep-primary" aria-label="发送问题" disabled={sending || !ready || !aiOpen || !message.trim()}><Send size={20} /></button></form>
      </section>
    </div>
  </main>;
}
