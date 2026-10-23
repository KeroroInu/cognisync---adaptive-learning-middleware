import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Pause, Play, RotateCcw, Send, X } from 'lucide-react';
import type { Language, ResearchTask } from '../types';
import { BASIC_SNAKE_CODE, BASIC_SNAKE_RUNTIME, basicSnakeSavedCode, snakeDirectionKey, type BasicSnakeState, type Cell, type SnakeKey } from '../data/basicSnake';
import { createSnakeLoop } from '../services/snakeLoop';
import { captureCurrentSession, createWorkspaceScope } from '../data/workspaceScope';
import { createCodePersistence, readCodeDraft } from '../services/codePersistence';
import { getActiveResearchTask, saveBasicSnake, sendChatMessage, type StageEventRequestBody } from '../services/api';
import { reportStageEvent } from '../services/stageEvents';
import { SupportTools, type SupportChoice, type SupportState } from '../components/SupportTools';
import { useCompanionAssistant } from '../components/CompanionTools';
import { CLASSROOM_CLOSING_EVENT } from '../services/classroom';
import { BasicSnakeBoard } from '../components/BasicSnakeBoard';
import './ClassroomSnakeWorkspace.css';

const Editor = React.lazy(() => import('../components/ResearchCodeEditor'));
type Message = { role: 'student' | 'assistant'; text: string };
const directions: { key: SnakeKey; label: string }[] = [{ key: 'w', label: '上' }, { key: 'a', label: '左' }, { key: 's', label: '下' }, { key: 'd', label: '右' }];
function Reply({ text }: { text: string }) {
  return <>{text.split(/```(?:python)?\n([\s\S]*?)```/g).map((part, index) => index % 2
    ? <pre key={index}><code>{part}</code></pre> : <p key={index}>{part}</p>)}</>;
}

/** Both classes enter this component. Group identity is not a UI/AI permission. */
export function ClassroomSnakeWorkspace({ userId, theme, language, onReturnToPreparation }: {
  userId: string; theme: 'light' | 'dark'; language: Language; onReturnToPreparation: () => void;
}) {
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [saveStatus, setSaveStatus] = useState('已恢复');
  const [saveError, setSaveError] = useState('');
  const [legacyCode, setLegacyCode] = useState('');
  const [state, setState] = useState<BasicSnakeState | null>(null);
  const [executedCode, setExecutedCode] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [runError, setRunError] = useState('');
  const [clickError, setClickError] = useState('');
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatError, setChatError] = useState('');
  const [support, setSupport] = useState<SupportState | null>(null);
  const [evidenceFailed, setEvidenceFailed] = useState(0);
  const [evidenceStorageError, setEvidenceStorageError] = useState(false);
  const active = useRef(false);
  const session = useRef(captureCurrentSession());
  const persistence = useRef<ReturnType<typeof createCodePersistence> | null>(null);
  const runLock = useRef(false);
  const chatLock = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const followConversation = useRef(true);
  const disposeRuntime = useRef<(() => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingEvidence = useRef(new Map<string, StageEventRequestBody>());
  const evidenceKey = useRef('');
  const recordSessionEnd = useRef<() => void>(() => {});
  const steps = useRef<SnakeKey[]>([]);
  const nextKey = useRef<SnakeKey | null>(null);
  const tick = useRef<() => Promise<boolean>>(async () => false);
  const [loop] = useState(() => createSnakeLoop(() => tick.current(), setPlaying));
  const current = useRef({ code, state, executedCode, runError, output });
  current.current = { code, state, executedCode, runError, output };
  const stale = executedCode !== null && executedCode !== code;
  const canMove = !!state && !state.game_over && !stale && !running && !runError;
  const allowAI = !!task && task.ai_enabled !== false;
  useCompanionAssistant(allowAI, chatOpen, sending, () => setChatOpen(true));

  useEffect(() => {
    if (chatOpen && followConversation.current && conversation.current) {
      conversation.current.scrollTop = conversation.current.scrollHeight;
    }
  }, [messages, sending, chatOpen]);

  useEffect(() => {
    let cancelled = false;
    active.current = true;
    session.current = captureCurrentSession();
    const sameSession = session.current;
    setLoaded(false); setLoadError('');
    void getActiveResearchTask().then(next => {
      if (cancelled || !sameSession()) return;
      setTask(next); setLoaded(true);
      if (!next) return;
      const scope = `${BASIC_SNAKE_RUNTIME}:${createWorkspaceScope(userId, next.id)}`;
      evidenceKey.current = `cognisync:evidence-outbox:${scope}`;
      const saved = basicSnakeSavedCode(next.workspace_data);
      const basic = next.workspace_data?.basicSnake as { revision?: number; legacy_code_submitted?: string } | undefined;
      let revision = basic?.revision ?? 0;
      const local = readCodeDraft(scope);
      const initial = local ?? saved ?? BASIC_SNAKE_CODE;
      setCode(initial);
      setLegacyCode(basic?.legacy_code_submitted ?? (saved === null ? next.code_submitted ?? '' : ''));
      const startedAt = new Date().toISOString();
      const queue = createCodePersistence({ scope, current: sameSession,
        onStatus: status => { if (active.current && sameSession()) setSaveStatus({ saved: '已保存', saving: '保存中…', unsaved: '待保存' }[status]); },
        onStorageError: () => { if (active.current) setSaveError('本机草稿未能保留，请手动复制代码。'); },
        save: async (value, keepalive) => {
          try {
            revision = await saveBasicSnake(next.id, value, revision, startedAt, keepalive);
            if (active.current && sameSession()) setSaveError('');
          } catch (error) {
            if (active.current && sameSession()) setSaveError(error instanceof Error ? error.message : '保存失败');
            throw error;
          }
        },
      });
      persistence.current = queue;
      // Reading a task never silently replaces its previous submitted code.
      if (local !== null) { queue.enqueue(local); void queue.flush(); }
    }).catch(error => { if (!cancelled && sameSession()) setLoadError(error.message || '读取失败'); });
    return () => {
      loop.stop();
      recordSessionEnd.current();
      cancelled = true; active.current = false; clearTimeout(saveTimer.current);
      void persistence.current?.flush(true);
      disposeRuntime.current?.();
    };
  }, [userId, attempt, loop]);

  useEffect(() => {
    const flush = () => { loop.stop(); recordSessionEnd.current(); clearTimeout(saveTimer.current); void persistence.current?.flush(true); };
    const hide = () => { if (document.hidden) { loop.stop(); recordSessionEnd.current(); } };
    const warn = (event: BeforeUnloadEvent) => { if (saveStatus === '待保存' || saveStatus === '保存中…' || evidenceFailed || evidenceStorageError) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warn);
    window.addEventListener(CLASSROOM_CLOSING_EVENT, flush);
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warn); window.removeEventListener(CLASSROOM_CLOSING_EVENT, flush); document.removeEventListener('visibilitychange', hide); };
  }, [saveStatus, evidenceFailed, evidenceStorageError, loop]);

  const changeCode = useCallback((value: string) => {
    loop.stop(); nextKey.current = null;
    setClickError('');
    current.current.code = value;
    setCode(value);
    persistence.current?.enqueue(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistence.current?.flush(), 1200);
  }, [loop]);

  const storeEvidence = (body: StageEventRequestBody, remove = false) => {
    if (!evidenceKey.current || !session.current()) return;
    try {
      const key = `${evidenceKey.current}:${body.request_id}`;
      // Per-event keys: late acknowledgements from an old tab cannot erase a
      // newer event written by another tab using the same student/task scope.
      if (remove) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(body));
      if (active.current) setEvidenceStorageError(false);
    } catch { if (active.current) setEvidenceStorageError(true); }
  };
  const sendEvidence = async (body: StageEventRequestBody) => {
    if (!task || !session.current()) return;
    pendingEvidence.current.set(body.request_id, body);
    storeEvidence(body);
    const result = await reportStageEvent(task.id, body);
    if (result.status === 'recorded' || result.status === 'replayed') { pendingEvidence.current.delete(body.request_id); storeEvidence(body, true); }
    if (active.current && session.current()) setEvidenceFailed(pendingEvidence.current.size);
  };
  useEffect(() => {
    if (!task || !evidenceKey.current) return;
    let cancelled = false;
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(`${evidenceKey.current}:`));
      for (const key of keys) {
        const item: StageEventRequestBody = JSON.parse(localStorage.getItem(key) || 'null');
        if (item?.detail?.runtime === BASIC_SNAKE_RUNTIME && typeof item.request_id === 'string' && item.event_type === 'module_test') pendingEvidence.current.set(item.request_id, item);
      }
    } catch { setEvidenceStorageError(true); }
    void (async () => {
      for (const item of [...pendingEvidence.current.values()]) {
        if (cancelled || !session.current()) break;
        await sendEvidence(item);
      }
    })();
    return () => { cancelled = true; };
    // Restore once for this task; code edits must not replay network requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);
  const record = (action: string, source: string, result: { state: BasicSnakeState | null; error: string; output: string[] }, input?: { clicked_cell: Cell }) => {
    void sendEvidence({ request_id: crypto.randomUUID(), stage: 'build', event_type: 'module_test',
      detail: { runtime: BASIC_SNAKE_RUNTIME, action, ...input, executed: !result.error, error: result.error,
        output: result.output, state: result.state, keys: [...steps.current], movement_mode: 'continuous', tick_interval_ms: 360,
        keys_meaning: 'direction_used_per_tick', evidence_source: 'browser_runtime', not_a_correctness_test: true },
      artifacts: [{ artifact_type: 'module_code', artifact_key: 'basic-snake:main.py',
        content: { code: source, runtime: BASIC_SNAKE_RUNTIME }, change_source: 'test_revision' }],
    });
  };
  recordSessionEnd.current = () => {
    const snapshot = current.current;
    if (snapshot.state && snapshot.executedCode && steps.current.length) {
      record('session_end', snapshot.executedCode, { state: snapshot.state, error: snapshot.runError, output: snapshot.output });
      steps.current = [];
    }
  };

  const execute = async (key?: SnakeKey): Promise<boolean> => {
    const before = { ...current.current };
    if (runLock.current || !session.current() || !task) return false;
    if (key && (!before.state || before.state.game_over || before.executedCode !== before.code || before.runError)) return false;
    if (!key) { loop.stop(); nextKey.current = null; }
    const generation = loop.generation;
    runLock.current = true;
    if (!key) setRunning(true);
    setRunError(''); setClickError('');
    if (!key) {
      if (before.state && steps.current.length) record('session_end', before.executedCode!, { state: before.state, error: before.runError, output: [] });
      steps.current = []; setState(null); setExecutedCode(null);
      persistence.current?.enqueue(before.code); void persistence.current?.flush();
    }
    try {
      const { runBasicSnake, disposeBasicSnake } = await import('../services/basicSnakeRunner');
      if (!active.current || !session.current()) return false;
      disposeRuntime.current = disposeBasicSnake;
      const result = await runBasicSnake(before.code, key ? before.state : null, key);
      if (!active.current || !session.current() || loop.generation !== generation || current.current.code !== before.code) return false;
      if (key) steps.current = [...steps.current.slice(-499), key];
      current.current = { ...current.current, executedCode: before.code, state: result.state, runError: result.error };
      setExecutedCode(before.code); setState(result.state); setRunError(result.error);
      setOutput(previous => (key ? [...previous, ...result.output] : result.output).join('\n').slice(-16000).split('\n').slice(-200));
      if (!key || result.error || result.state?.game_over) record(key ? 'step_end' : 'run_or_reset', before.code, result);
      const keepGoing = !!result.state && !result.error && !result.state.game_over;
      if (!key && keepGoing && !document.hidden) loop.start();
      return keepGoing;
    } catch (error) {
      if (!active.current || !session.current() || loop.generation !== generation) return false;
      const message = error instanceof Error ? error.message : '运行失败';
      setState(null); setExecutedCode(before.code); setRunError(message);
      record('runtime_error', before.code, { state: null, error: message, output: [] });
      return false;
    } finally { runLock.current = false; if (active.current && session.current()) setRunning(false); }
  };

  tick.current = () => {
    const snapshot = current.current;
    const key = nextKey.current ?? snakeDirectionKey[snapshot.state?.direction ?? 'right'];
    nextKey.current = null;
    return execute(key);
  };
  const restart = async () => {
    loop.stop(); setRunning(true);
    await loop.settled();
    if (active.current && session.current()) await execute();
  };
  const clickBoard = async (cell: Cell) => {
    loop.stop();
    await loop.settled();
    const before = current.current;
    if (runLock.current || !task || !session.current() || !before.state || before.state.game_over || before.executedCode !== before.code || before.runError) return;
    const generation = loop.generation;
    runLock.current = true; setRunning(true); setClickError('');
    if (steps.current.length) {
      record('session_end', before.executedCode!, { state: before.state, error: before.runError, output: before.output });
      steps.current = [];
    }
    try {
      const { runBasicSnake, disposeBasicSnake } = await import('../services/basicSnakeRunner');
      if (!active.current || !session.current()) return;
      disposeRuntime.current = disposeBasicSnake;
      const result = await runBasicSnake(before.code, before.state, undefined, cell);
      if (!active.current || !session.current() || loop.generation !== generation || current.current.code !== before.code) return;
      const nextState = result.state ?? before.state;
      current.current = { ...current.current, state: nextState };
      setState(nextState); setClickError(result.error);
      setOutput(previous => [...previous, ...result.output].join('\n').slice(-16000).split('\n').slice(-200));
      record('board_click', before.code, result, { clicked_cell: cell });
    } catch (error) {
      if (!active.current || !session.current() || loop.generation !== generation) return;
      const message = error instanceof Error ? error.message : '棋盘点击失败';
      setClickError(message);
      record('board_click', before.code, { state: null, error: message, output: [] }, { clicked_cell: cell });
    } finally { runLock.current = false; if (active.current && session.current()) setRunning(false); }
  };
  const turn = (key: SnakeKey) => { if (canMove) nextKey.current = key; };
  const move = useRef(turn); move.current = turn;
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target.closest('input,textarea,[contenteditable="true"],.cm-editor')) return;
      const key = event.key.toLowerCase() as SnakeKey;
      if (directions.some(item => item.key === key)) { event.preventDefault(); move.current(key); }
    };
    window.addEventListener('keydown', press); return () => window.removeEventListener('keydown', press);
  }, []);

  const ask = async (choice?: SupportChoice) => {
    const message = choice?.text ?? question.trim();
    if (!message || !task || !allowAI || chatLock.current || !session.current()) return;
    chatLock.current = true; setSending(true); setChatError('');
    followConversation.current = true;
    // Send now, not after the reply. The next draft belongs to the student.
    if (!choice) { setQuestion(''); composer.current?.focus(); }
    setMessages(previous => [...previous, { role: 'student', text: message }]);
    const requestId = crypto.randomUUID();
    const snapshot = current.current;
    try {
      const reply = await sendChatMessage({ userId, message, language, isResearchMode: true,
        supportRequestId: requestId, supportAction: choice?.action ?? 'message', supportPracticeId: choice?.practiceId, supportAnswer: choice?.answer,
        currentCode: snapshot.code,
        scaffoldContext: { requestId, taskId: task.id, stage: 'build', level: 0, trigger: 'student_message', currentModule: BASIC_SNAKE_RUNTIME,
          artifactSummary: JSON.stringify({ runtime: BASIC_SNAKE_RUNTIME, codeHasRun: snapshot.executedCode !== null, draftChanged: snapshot.code !== snapshot.executedCode }),
          testFeedback: JSON.stringify({ runMatchesDraft: snapshot.executedCode === snapshot.code,
            state: snapshot.state ? { head: snapshot.state.snake[0], length: snapshot.state.snake.length, food: snapshot.state.food, score: snapshot.state.score, game_over: snapshot.state.game_over } : null,
            error: (snapshot.runError || clickError).slice(0, 500), output: output.join('\n').slice(-600) }) },
      });
      if (!active.current || !session.current()) return;
      setMessages(previous => [...previous, { role: 'assistant', text: reply.message }]); setSupport(reply.support ?? null);
    } catch (error) {
      if (active.current && session.current()) {
        setChatError(error instanceof Error ? error.message : 'AI 暂时未连接，请重试。');
        if (!choice) setQuestion(draft => draft || message);
      }
    }
    finally { chatLock.current = false; if (active.current) setSending(false); }
  };

  const leave = () => {
    loop.stop();
    recordSessionEnd.current();
    void persistence.current?.flush(true); onReturnToPreparation();
  };
  if (!loaded) return <section className="basic-snake-loading">{loadError ? <><p role="alert">{loadError}，尚未改动云端代码。</p><button onClick={() => setAttempt(n => n + 1)}>重新读取</button></> : '正在读取课堂项目…'}</section>;
  if (!task) return <section className="basic-snake-loading"><p>老师还没有启动本课项目。</p><button onClick={onReturnToPreparation}>返回准备区</button></section>;
  const status = running ? '正在运行…' : stale ? '代码已修改，运行后更新画面' : runError ? '运行出错，请检查代码' : !state ? '点击「运行代码」开始' : state.won ? '棋盘已填满，完成！' : state.game_over ? '游戏结束' : playing ? '正在前进 · W / A / S / D 转向' : '已暂停';

  return <main className="basic-snake" data-runtime={BASIC_SNAKE_RUNTIME}>
    <header className="basic-snake-header"><div><small>PYTHON LAB / 01</small><h1>贪吃蛇</h1></div>
      <div className="basic-snake-actions"><span aria-live="polite">{saveStatus}</span><button disabled={!allowAI} onClick={() => setChatOpen(open => !open)} aria-expanded={chatOpen}><MessageCircle size={17} />{chatOpen ? '收起 AI' : '问 AI'}</button><button onClick={leave}><ArrowLeft size={17} />返回</button></div>
    </header>
    {saveError && <div role="alert" className="basic-snake-notice">{saveError}<button onClick={() => void persistence.current?.flush()}>重试保存</button></div>}
    {evidenceFailed > 0 && <div role="alert" className="basic-snake-notice">有 {evidenceFailed} 条运行记录未同步。<button onClick={() => { for (const item of pendingEvidence.current.values()) void sendEvidence(item); }}>重试同步</button></div>}
    {evidenceStorageError && <div role="alert" className="basic-snake-notice">本机无法暂存运行记录，请保持页面打开并完成同步。</div>}
    <div className={`basic-snake-layout${chatOpen ? ' with-chat' : ''}`}>
      <section className="basic-snake-preview" aria-label="游戏预览">
        <div className="basic-snake-score"><div><small>得分</small><strong data-testid="snake-score">{state?.score ?? '—'}</strong></div><span>10 × 10 · 行 / 列</span><span>{state ? `${state.snake.length} 格` : '未运行'}</span></div>
        <BasicSnakeBoard state={state} stale={stale} running={running} onCellClick={canMove ? cell => void clickBoard(cell) : undefined} />
        {clickError && <p role="alert" className="basic-snake-click-error">{clickError}</p>}
        <p className="basic-snake-status" role="status">{status}</p>
        <div className="basic-snake-controls"><div className="basic-snake-pad">{directions.map(({ key, label }) => <button key={key} className={`key-${key}`} aria-label={`${label} ${key.toUpperCase()}`} disabled={!canMove} onClick={() => turn(key)}>{key.toUpperCase()}</button>)}</div>
          <button disabled={!canMove} onClick={() => { if (playing) { loop.stop(); recordSessionEnd.current(); } else loop.start(); }}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? '暂停' : '继续'}</button>
          <button disabled={running || !executedCode || stale} onClick={() => void restart()}><RotateCcw size={17} />重新开始</button></div>
        <small className="basic-snake-caption">约每 0.36 秒前进一步 · 修改代码时暂停</small>
      </section>
      <section className="basic-snake-code" aria-label="Python 代码编辑器">
        <div className="basic-snake-code-bar"><strong>main.py</strong><span>Python</span><button className="basic-snake-primary" disabled={running} onClick={() => void restart()}><Play size={17} />运行代码</button></div>
        {task.instructions && <details className="basic-snake-instructions"><summary>老师的说明</summary><p>{task.instructions}</p></details>}
        <details className="basic-snake-instructions"><summary>扩展任务接口</summary><p>棋盘点击会调用你写的 on_board_click(state, row, col)，行列从 0 到 9。可以在返回的状态中加入 obstacles（障碍坐标）和 path（路径坐标），由棋盘显示。自主移动仍由你的 Python 代码决定；平台只传递点击位置，不代你选择路线。</p></details>
        {legacyCode && <details className="basic-snake-instructions"><summary>以前的代码（已保留）</summary><pre>{legacyCode}</pre></details>}
        <div className="basic-snake-editor"><Suspense fallback={<p>正在载入编辑器…</p>}><Editor value={code} language="python" theme={theme} onChange={changeCode} /></Suspense></div>
        <div className="basic-snake-output" aria-label="运行输出"><small>输出{stale ? ' · 上次运行' : ''}</small>{runError ? <pre role="alert">{runError}</pre> : null}<pre>{output.join('\n') || (executedCode && !runError ? '运行完成。' : 'print 的结果和报错显示在这里。')}</pre></div>
      </section>
      {allowAI && <aside className="basic-snake-chat" hidden={!chatOpen} aria-label="AI 助手">
        <header><strong>一起想一想</strong><button aria-label="关闭 AI 助手" onClick={() => setChatOpen(false)}><X size={18} /></button></header>
        <div ref={conversation} className="basic-snake-messages" role="log" aria-label="与小家伙的对话" aria-live="polite" aria-relevant="additions text" onScroll={event => {
          const element = event.currentTarget;
          followConversation.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}>{messages.length ? messages.map((message, i) => <article key={i} className={message.role} aria-label={message.role === 'student' ? '我的消息' : 'AI 的回复'}><small>{message.role === 'student' ? '我' : '小家伙 · AI'}</small><Reply text={message.text} /></article>) : <p className="basic-snake-chat-empty">哪里没想明白？直接问我就好。</p>}{sending && <article className="assistant"><small>小家伙 · AI</small><p role="status">正在回复…</p></article>}</div>
        <details className="basic-snake-help" open={support?.practice ? true : undefined}><summary>需要一点提示？</summary>
          <SupportTools taskId={task.id} focus={BASIC_SNAKE_RUNTIME} busy={sending} response={support} onAction={choice => void ask(choice)} onRestore={history => setMessages(previous => previous.length ? previous : history.flatMap(item => [{ role: 'student' as const, text: item.question }, { role: 'assistant' as const, text: item.reply }]))} />
        </details>
        {chatError && <p role="alert" className="basic-snake-chat-error">{chatError}</p>}
        <form className="basic-snake-composer" onSubmit={event => { event.preventDefault(); if (!composing.current) void ask(); }}>
          <textarea ref={composer} aria-label="向 AI 提问" aria-describedby="snake-chat-hint" value={question} rows={2} maxLength={4000} onChange={event => setQuestion(event.target.value)} placeholder="输入你的问题…"
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); if (!event.repeat) void ask(); } }} />
          <div className="basic-snake-composer-footer"><small id="snake-chat-hint">{sending ? '等回复时也可以先写下一句' : 'Enter 发送 · Shift + Enter 换行'}</small><button type="submit" className="basic-snake-primary" aria-label="发送" disabled={sending || !question.trim()}><Send size={16} />{sending ? '回复中' : '发送'}</button></div>
        </form>
      </aside>}
    </div>
  </main>;
}
