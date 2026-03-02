import React, { useState, useRef, useEffect, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Send, CheckCircle, FlaskConical, Loader, Save, Play, Terminal, Trash2, X } from 'lucide-react';
import type { ChatMessage, Language, UserProfile, ResearchTask } from '../types';
import {
  sendChatMessage,
  getActiveResearchTask,
  saveResearchProgress,
  completeResearchTask,
  reopenResearchTask,
} from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'info' | 'error';
  text: string;
}

interface Props {
  onUpdateProfile: (profile: UserProfile) => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
}

// Extend Window so TS knows about Pyodide on CDN
declare global {
  interface Window {
    loadPyodide: (options?: Record<string, unknown>) => Promise<any>;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export const Research: React.FC<Props> = ({
  onUpdateProfile,
  language,
  theme,
  userId,
}) => {
  // Task / code state
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [code, setCode] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Task completion
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  // Terminal / Pyodide
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [pyodideReady, setPyodideReady] = useState(false);
  const pyodideRef = useRef<any>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Elapsed timer
  const startTimeRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isZh = language === 'zh';
  const isPython = task?.language?.toLowerCase() === 'python';

  // ── Load task ──────────────────────────────────────────────────────────

  useEffect(() => {
    getActiveResearchTask()
      .then(t => {
        setTask(t);
        if (t) {
          // 优先使用学生已保存的代码，否则用模板原始代码
          setCode(t.code_submitted || t.code_content);
          // 若已提交过，直接标记为完成（停止计时器）
          if (t.is_completed) {
            setCompleted(true);
          }
        }
      })
      .catch(() => setTask(null))
      .finally(() => setLoadingTask(false));
  }, []);

  // ── Auto-scroll chat ────────────────────────────────────────────────────

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // ── Auto-scroll terminal ────────────────────────────────────────────────

  useEffect(() => {
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [terminalLines]);

  // ── Code change + auto-save ─────────────────────────────────────────────

  // Start timer when task first loads
  useEffect(() => {
    if (task && !startTimeRef.current) {
      startTimeRef.current = Date.now();
    }
  }, [task]);

  // Tick every second until completed
  useEffect(() => {
    if (!task || completed) return;
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [task, completed]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!task) return;
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await saveResearchProgress(task.id, value, startTimeRef.current ? new Date(startTimeRef.current).toISOString() : undefined);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [task]);

  // ── Chat submit ─────────────────────────────────────────────────────────

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !task) return;
    const userText = input;
    setInput('');
    setChatError(null);

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      text: userText,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const response = await sendChatMessage({
        userId: userId || 'guest',
        message: userText,
        language,
        isResearchMode: true,
        currentCode: code,
        taskPrompt: task.ai_prompt ?? undefined,
      });
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        text: response.message,
        timestamp: new Date().toISOString(),
        analysis: response.analysis,
      };
      setMessages(prev => [...prev, assistantMsg]);
      if (response.updatedProfile) onUpdateProfile(response.updatedProfile);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : isZh ? '发送失败' : 'Failed to send');
    } finally {
      setIsTyping(false);
    }
  };

  // ── Complete task ───────────────────────────────────────────────────────

  const handleComplete = async () => {
    if (!task || completing || completed) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeResearchTask(task.id, code, startTimeRef.current ? new Date(startTimeRef.current).toISOString() : undefined);
      setCompleted(true);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : isZh ? '提交失败' : 'Failed to submit');
    } finally {
      setCompleting(false);
    }
  };

  // ── Reopen task ─────────────────────────────────────────────────────────

  const handleReopen = async () => {
    if (!task || reopening) return;
    setReopening(true);
    setCompleteError(null);
    try {
      await reopenResearchTask(task.id);
      setCompleted(false);
      // 重置计时器，从本次重新开始算
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : isZh ? '退回失败' : 'Failed to reopen');
    } finally {
      setReopening(false);
    }
  };

  // ── Pyodide: load from CDN ──────────────────────────────────────────────

  const ensurePyodide = useCallback(async (): Promise<any> => {
    if (pyodideRef.current) return pyodideRef.current;

    setTerminalLines(prev => [
      ...prev,
      {
        type: 'info',
        text: isZh
          ? '⏳ 正在加载 Python 环境（首次约需 10-20 秒）...'
          : '⏳ Loading Python environment (first time ~10-20s)...',
      },
    ]);

    // Inject the Pyodide CDN script once
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.getElementById('pyodide-cdn');
        if (existing) { resolve(); return; }
        const s = document.createElement('script');
        s.id = 'pyodide-cdn';
        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to fetch Pyodide CDN'));
        document.head.appendChild(s);
      });
    }

    const pyodide = await window.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
      // Route Python stdout/stderr directly into terminal lines
      stdout: (text: string) =>
        setTerminalLines(prev => [...prev, { type: 'stdout', text: text.replace(/\n$/, '') }]),
      stderr: (text: string) =>
        setTerminalLines(prev => [...prev, { type: 'stderr', text: text.replace(/\n$/, '') }]),
    });

    pyodideRef.current = pyodide;
    setPyodideReady(true);
    setTerminalLines(prev => [
      ...prev,
      { type: 'info', text: isZh ? '✓ Python 环境就绪' : '✓ Python ready' },
    ]);
    return pyodide;
  }, [isZh]);

  // ── Run code ────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setTerminalOpen(true);

    // Run separator with timestamp
    const ts = new Date().toLocaleTimeString('en-GB');
    setTerminalLines(prev => [
      ...prev,
      { type: 'info', text: `─── ${ts} ${'─'.repeat(28)}` },
    ]);

    const startMs = Date.now();

    try {
      const pyodide = await ensurePyodide();

      try {
        await pyodide.runPythonAsync(code);
      } catch (err: any) {
        // Pyodide already sent the full traceback via the stderr callback.
        // Extract just the last line for a compact error entry.
        const raw: string = err?.message ?? String(err);
        const lastLine = raw.trim().split('\n').pop() ?? raw;
        setTerminalLines(prev => [...prev, { type: 'error', text: lastLine }]);
        return;
      }

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
      setTerminalLines(prev => [
        ...prev,
        {
          type: 'info',
          text: isZh ? `✓ 执行完毕（${elapsed}s）` : `✓ Done (${elapsed}s)`,
        },
      ]);
    } catch (err: any) {
      setTerminalLines(prev => [
        ...prev,
        {
          type: 'error',
          text: isZh
            ? `环境加载失败: ${err?.message}`
            : `Load failed: ${err?.message}`,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  // ── Language extensions for CodeMirror ─────────────────────────────────

  const getExtensions = () => {
    if (!task) return [];
    switch (task.language.toLowerCase()) {
      case 'python':       return [python()];
      case 'javascript':
      case 'js':           return [javascript()];
      case 'typescript':
      case 'ts':           return [javascript({ typescript: true })];
      default:             return [];
    }
  };

  // ── Theme helpers ───────────────────────────────────────────────────────

  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.1)'       : 'rgba(255,255,255,0.1)';
  const textColor   = theme === 'light' ? '#000000'                : '#ffffff';
  const panelBg     = theme === 'light' ? 'rgba(249,250,251,0.8)'  : 'rgba(15,23,42,0.8)';
  const inputBg     = theme === 'light' ? '#ffffff'                : '#1e293b';

  // ── Guard states ────────────────────────────────────────────────────────

  if (loadingTask) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!task) {
    return (
      <div
        className="flex flex-col items-center justify-center py-24"
        style={{ color: theme === 'light' ? '#6b7280' : '#94a3b8' }}
      >
        <FlaskConical className="w-16 h-16 mb-4 opacity-20" />
        <p className="text-lg font-medium">
          {isZh ? '暂无活跃的研究任务' : 'No active research task'}
        </p>
        <p className="text-sm mt-2">
          {isZh
            ? '教师发布任务后，将会在此处显示。'
            : 'Tasks will appear here once published by your instructor.'}
        </p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4 flex-1 min-h-0">

      {/* ── Left: Code Editor + Terminal ─────────────────────────────── */}
      <div
        className="flex-[3] flex flex-col min-h-0 rounded-2xl overflow-hidden border"
        style={{ borderColor, background: theme === 'light' ? '#ffffff' : '#0f172a' }}
      >
        {/* Task header */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <FlaskConical size={16} className="text-indigo-500 shrink-0" />
            <span className="font-semibold text-sm truncate" style={{ color: textColor }}>
              {task.title}
            </span>
            <span className="px-2 py-0.5 text-xs font-mono rounded shrink-0 bg-blue-100 text-blue-800">
              {task.language}
            </span>
          </div>
          {task.instructions && (
            <span className="text-xs text-gray-500 max-w-xs truncate ml-4 shrink-0">
              {task.instructions}
            </span>
          )}
        </div>

        {/* CodeMirror editor — flex-1 shrinks when terminal opens */}
        <div className="flex-1 overflow-hidden min-h-0">
          <CodeMirror
            value={code}
            onChange={handleCodeChange}
            extensions={getExtensions()}
            theme={theme === 'dark' ? oneDark : undefined}
            height="100%"
            style={{ height: '100%', fontSize: '13px' }}
          />
        </div>

        {/* ── Terminal panel ─────────────────────────────────────────── */}
        {terminalOpen && (
          <div
            className="shrink-0 flex flex-col border-t"
            style={{ borderColor, maxHeight: '200px', minHeight: '120px' }}
          >
            {/* Terminal title bar */}
            <div
              className="flex items-center justify-between px-3 py-1.5 shrink-0"
              style={{
                background: '#0d1117',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="flex items-center gap-1.5">
                <Terminal size={12} className="text-green-400" />
                <span className="text-xs font-mono text-gray-400">
                  {isZh ? '输出' : 'Output'}
                  {pyodideReady && (
                    <span className="ml-2 text-green-500">● Python 3.x</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTerminalLines([])}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title={isZh ? '清空' : 'Clear'}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title={isZh ? '关闭' : 'Close'}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Terminal output lines */}
            <div
              ref={terminalScrollRef}
              className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs"
              style={{ background: '#0d1117' }}
            >
              {terminalLines.length === 0 ? (
                <span className="text-gray-600">
                  {isZh ? '点击"运行"执行代码' : 'Click "Run" to execute code'}
                </span>
              ) : (
                terminalLines.map((line, i) => (
                  <div
                    key={i}
                    className="leading-5 whitespace-pre-wrap break-all"
                    style={{
                      color:
                        line.type === 'stdout' ? '#e6edf3'
                        : line.type === 'stderr' ? '#f85149'
                        : line.type === 'error'  ? '#ff7b72'
                        : '#8b949e',  // info
                    }}
                  >
                    {line.text}
                  </div>
                ))
              )}
              {running && (
                <div className="flex items-center gap-1.5 mt-1 text-yellow-400">
                  <Loader size={10} className="animate-spin" />
                  <span>{isZh ? '运行中...' : 'Running...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer: save status + run + complete */}
        <div
          className="px-4 py-2 border-t flex items-center justify-between shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          {/* Save status */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <div className="flex items-center gap-1.5">
              <Save size={12} />
              <span>
                {saveStatus === 'saving'
                  ? (isZh ? '保存中...' : 'Saving...')
                  : saveStatus === 'saved'
                  ? (isZh ? '已保存' : 'Saved')
                  : (isZh ? '未保存' : 'Unsaved')}
              </span>
            </div>
            {startTimeRef.current !== null && (
              <span className="font-mono">
                ⏱ {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">

            {/* Run button — only shown for Python tasks */}
            {isPython && (
              <button
                onClick={handleRun}
                disabled={running || completed}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all disabled:opacity-40"
                style={{
                  background: 'rgba(99,102,241,0.12)',
                  color: '#818cf8',
                  border: '1px solid rgba(99,102,241,0.25)',
                }}
                title={isZh ? '运行代码 (Pyodide)' : 'Run code (Pyodide)'}
              >
                {running
                  ? <Loader size={13} className="animate-spin" />
                  : <Play size={13} />}
                <span>{isZh ? '运行' : 'Run'}</span>
              </button>
            )}

            {/* Complete / Submit button */}
            <button
              onClick={handleComplete}
              disabled={completing || completed}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              style={{
                background: completed
                  ? '#6b7280'
                  : 'linear-gradient(to right, #10b981, #059669)',
              }}
            >
              {completing
                ? <Loader size={14} className="animate-spin" />
                : <CheckCircle size={14} />}
              <span>
                {completed
                  ? (isZh ? '已提交' : 'Submitted')
                  : (isZh ? '完成任务' : 'Submit Task')}
              </span>
            </button>

            {/* Reopen button — only shown after submitted */}
            {completed && (
              <button
                onClick={handleReopen}
                disabled={reopening}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all disabled:opacity-50"
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)',
                }}
                title={isZh ? '撤回提交，重新编辑' : 'Reopen to edit again'}
              >
                {reopening
                  ? <Loader size={13} className="animate-spin" />
                  : <span>↩</span>}
                <span>{isZh ? '退回重做' : 'Reopen'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Complete error */}
        {completeError && (
          <div className="px-4 py-1 text-xs text-red-500 text-center shrink-0">
            {completeError}
          </div>
        )}
      </div>

      {/* ── Right: Chat Panel ─────────────────────────────────────── */}
      <div
        className="flex-[2] flex flex-col min-h-0 rounded-2xl overflow-hidden border"
        style={{ borderColor, background: theme === 'light' ? '#ffffff' : '#0f172a' }}
      >
        {/* Chat header */}
        <div
          className="px-4 py-3 border-b shrink-0"
          style={{ borderColor, backgroundColor: panelBg }}
        >
          <p className="text-sm font-semibold" style={{ color: textColor }}>
            {isZh ? 'AI 学习助手' : 'AI Learning Assistant'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: theme === 'light' ? '#6b7280' : '#94a3b8' }}>
            {isZh ? '遇到问题？和我聊聊吧' : 'Stuck? Chat with me'}
          </p>
        </div>

        {/* Messages */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div
              className="text-center text-sm mt-8"
              style={{ color: theme === 'light' ? '#9ca3af' : '#64748b' }}
            >
              {isZh
                ? '开始提问，我会帮助你完成代码！'
                : "Start asking — I'll help you complete the code!"}
            </div>
          )}
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-sm'
                    : ''
                }`}
                style={
                  msg.role === 'assistant'
                    ? {
                        backgroundColor: theme === 'light' ? '#f3f4f6' : '#1e293b',
                        color: textColor,
                        borderRadius: '1rem 1rem 1rem 0.25rem',
                      }
                    : {}
                }
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl rounded-bl-sm px-4 py-3"
                style={{ backgroundColor: theme === 'light' ? '#f3f4f6' : '#1e293b' }}
              >
                <div className="flex gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="w-2 h-2 rounded-full animate-bounce"
                      style={{ backgroundColor: '#9ca3af', animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat error */}
        {chatError && (
          <div className="mx-4 mb-1 text-xs text-red-500 text-center">{chatError}</div>
        )}

        {/* Input */}
        <form onSubmit={handleChatSubmit} className="px-4 pb-4 pt-2 shrink-0">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isZh ? '问我任何问题...' : 'Ask me anything...'}
              disabled={completed}
              className="flex-1 px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500"
              style={{ borderColor, backgroundColor: inputBg, color: textColor }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping || completed}
              className="p-2 rounded-xl text-white hover:opacity-90 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(to right, #6366f1, #9333ea)' }}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
