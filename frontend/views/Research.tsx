import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, CheckCircle, FlaskConical, Loader, Save, Play, Terminal, Trash2, X } from 'lucide-react';
import type { ChatMessage, Language, User, UserProfile, ResearchTask } from '../types';
import {
  sendChatMessage,
  getActiveResearchTask,
  saveResearchProgress,
  saveResearchWorkspace,
  completeResearchTask,
  reopenResearchTask,
} from '../services/api';
import { SnakeProjectDemo } from '../components/SnakeProjectDemo';
import { ProjectScaffoldAssistant, type ScaffoldCompletion } from '../components/ProjectScaffoldAssistant';
import {
  ProjectFactoryHeader,
  ProjectObservationStage,
  ProjectStagePreview,
  type ProjectStage,
} from '../components/ProjectFactory';
import { ProjectFunctionStage } from '../components/ProjectFunctionStage';
import { ProjectPathStage } from '../components/ProjectPathStage';
import { ProjectBuildStage } from '../components/ProjectBuildStage';
import type { SnakeRuntimeEvidence } from '../data/snakeProjectBlueprint';
import {
  collectSnakeProjectWorkspace,
  createSnakeProjectMechanisms,
  hydrateSnakeProjectWorkspace,
  isSnakeProjectWorkspace,
  seedSnakeProjectDemo,
  type SnakeProjectWorkspace,
} from '../data/snakeProjectDemo';

const ResearchCodeEditor = React.lazy(() => import('../components/ResearchCodeEditor'));

// ── Types ──────────────────────────────────────────────────────────────────

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'info' | 'error';
  text: string;
}

interface Props {
  onUpdateProfile: (profile: UserProfile) => void;
  onExit: () => void;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
  studentId?: string;
  experimentGroup: User['experimentGroup'];
}

type WorkspaceSaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const workspaceSignature = (workspace: SnakeProjectWorkspace) => JSON.stringify({
  version: workspace.version,
  evidence: workspace.evidence,
  observations: workspace.observations,
  functions: workspace.functions,
  path: workspace.path,
  progress: workspace.progress,
});

const WORKSPACE_CHECK_INTERVAL_MS = 400;
const WORKSPACE_SAVE_DEBOUNCE_MS = 900;
const WORKSPACE_RETRY_DELAY_MS = 4000;

// Extend Window so TS knows about Pyodide on CDN
declare global {
  interface Window {
    loadPyodide: (options?: Record<string, unknown>) => Promise<any>;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export const Research: React.FC<Props> = ({
  onUpdateProfile,
  onExit,
  language,
  theme,
  userId,
  studentId,
  experimentGroup,
}) => {
  // Task / code state
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [loadingTask, setLoadingTask] = useState(true);
  const [code, setCode] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [workspaceSaveStatus, setWorkspaceSaveStatus] = useState<WorkspaceSaveStatus>('saved');
  const [factoryStage, setFactoryStage] = useState<ProjectStage>('observe');
  const [demoOpen, setDemoOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [runtimeEvidence, setRuntimeEvidence] = useState<SnakeRuntimeEvidence[]>([]);
  const [observationCardCount, setObservationCardCount] = useState(0);
  const [scaffoldCompletion, setScaffoldCompletion] = useState<ScaffoldCompletion | null>(null);

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
  const workspaceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceSaveRunningRef = useRef(false);
  const workspacePendingRef = useRef<SnakeProjectWorkspace | null>(null);
  const workspaceLastSavedSignatureRef = useRef('');
  const flushWorkspaceRef = useRef<(keepalive?: boolean) => Promise<void>>(async () => {});
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Elapsed timer
  const startTimeRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isZh = language === 'zh';
  const isPython = task?.language?.toLowerCase() === 'python';
  const allowAI = experimentGroup === 'pdt' || experimentGroup === 'ai_pbl';
  const factorySaveLabel = experimentGroup === 'pdt'
    ? (workspaceSaveStatus === 'saving'
      ? (isZh ? '保存中' : 'Saving')
      : workspaceSaveStatus === 'unsaved'
        ? (isZh ? '待保存' : 'Unsaved')
        : workspaceSaveStatus === 'error'
          ? (isZh ? '同步失败 · 已存本机' : 'Sync failed · saved locally')
          : (isZh ? '已同步' : 'Synced'))
    : factoryStage === 'build'
      ? (saveStatus === 'saving'
        ? (isZh ? '保存中' : 'Saving')
        : saveStatus === 'unsaved'
          ? (isZh ? '待保存' : 'Unsaved')
          : (isZh ? '已保存' : 'Saved'))
      : (isZh ? '过程已暂存' : 'Progress saved');

  const flushWorkspaceQueue = useCallback(async (keepalive = false) => {
    if (!task || experimentGroup !== 'pdt' || workspaceSaveRunningRef.current) return;
    workspaceSaveRunningRef.current = true;
    try {
      while (workspacePendingRef.current) {
        const snapshot = workspacePendingRef.current;
        const signature = workspaceSignature(snapshot);
        workspacePendingRef.current = null;
        if (signature === workspaceLastSavedSignatureRef.current) continue;
        setWorkspaceSaveStatus('saving');
        try {
          await saveResearchWorkspace(task.id, snapshot, { keepalive });
          workspaceLastSavedSignatureRef.current = signature;
        } catch {
          workspacePendingRef.current ??= snapshot;
          setWorkspaceSaveStatus('error');
          if (workspaceRetryTimerRef.current) clearTimeout(workspaceRetryTimerRef.current);
          workspaceRetryTimerRef.current = setTimeout(() => {
            workspaceRetryTimerRef.current = null;
            void flushWorkspaceRef.current();
          }, WORKSPACE_RETRY_DELAY_MS);
          return;
        }
      }
      setWorkspaceSaveStatus('saved');
    } finally {
      workspaceSaveRunningRef.current = false;
    }
  }, [experimentGroup, task]);

  useEffect(() => {
    flushWorkspaceRef.current = flushWorkspaceQueue;
  }, [flushWorkspaceQueue]);

  const queueWorkspaceSave = useCallback((delay = WORKSPACE_SAVE_DEBOUNCE_MS) => {
    if (!task || experimentGroup !== 'pdt') return;
    const snapshot = collectSnakeProjectWorkspace(task.id);
    const signature = workspaceSignature(snapshot);
    const pendingSignature = workspacePendingRef.current
      ? workspaceSignature(workspacePendingRef.current)
      : '';
    if (signature === workspaceLastSavedSignatureRef.current || signature === pendingSignature) return;
    workspacePendingRef.current = snapshot;
    setWorkspaceSaveStatus('unsaved');
    if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    if (workspaceRetryTimerRef.current) {
      clearTimeout(workspaceRetryTimerRef.current);
      workspaceRetryTimerRef.current = null;
    }
    workspaceSaveTimerRef.current = setTimeout(() => {
      workspaceSaveTimerRef.current = null;
      void flushWorkspaceRef.current();
    }, delay);
  }, [experimentGroup, task]);

  // ── Load task ──────────────────────────────────────────────────────────

  useEffect(() => {
    const loadTask = async () => {
      try {
        const t = await getActiveResearchTask();
        setTask(t);
        if (t) {
          let workspace = isSnakeProjectWorkspace(t.workspace_data) ? t.workspace_data : null;
          // kero 是开发验收账号：首次进入时自动生成一套完整蓝图，并写入账号记录。
          if (!workspace && studentId === 'kero' && experimentGroup === 'pdt') {
            const demo = seedSnakeProjectDemo(t.id);
            workspace = demo.workspace;
            await saveResearchWorkspace(t.id, workspace);
          } else if (workspace && studentId === 'kero' && experimentGroup === 'pdt' && !workspace.path.functionMechanisms) {
            workspace = {
              ...workspace,
              path: { ...workspace.path, functionMechanisms: createSnakeProjectMechanisms() },
              savedAt: new Date().toISOString(),
            };
            await saveResearchWorkspace(t.id, workspace);
            hydrateSnakeProjectWorkspace(t.id, workspace);
          } else if (workspace) {
            hydrateSnakeProjectWorkspace(t.id, workspace);
          }

          workspaceLastSavedSignatureRef.current = workspace ? workspaceSignature(workspace) : '';
          workspacePendingRef.current = null;
          setWorkspaceSaveStatus('saved');

          // 优先使用学生已保存的代码，否则用模板原始代码
          setCode(t.code_submitted || t.code_content);
          // 若已提交过，直接标记为完成（停止计时器）
          if (t.is_completed) {
            setCompleted(true);
          }
          try {
            const evidence = workspace?.evidence ?? [];
            setRuntimeEvidence(evidence);
            setObservationCardCount(workspace?.observations.length ?? 0);
          } catch {
            setRuntimeEvidence([]);
          }
        }
      } catch {
        setTask(null);
      } finally {
        setLoadingTask(false);
      }
    };
    void loadTask();
  }, [experimentGroup, studentId]);

  useEffect(() => {
    if (!task || experimentGroup !== 'pdt') return;
    const interval = window.setInterval(() => queueWorkspaceSave(), WORKSPACE_CHECK_INTERVAL_MS);
    const flushBeforeLeaving = () => {
      queueWorkspaceSave(0);
      void flushWorkspaceRef.current(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBeforeLeaving();
    };
    window.addEventListener('pagehide', flushBeforeLeaving);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', flushBeforeLeaving);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [experimentGroup, queueWorkspaceSave, task]);

  useEffect(() => () => {
    if (workspaceSaveTimerRef.current) clearTimeout(workspaceSaveTimerRef.current);
    if (workspaceRetryTimerRef.current) clearTimeout(workspaceRetryTimerRef.current);
  }, []);

  const handleSnakeEvidence = useCallback((event: SnakeRuntimeEvidence) => {
    setRuntimeEvidence(current => {
      const previous = current[current.length - 1];
      if (
        previous
        && previous.type === event.type
        && JSON.stringify(previous.details ?? {}) === JSON.stringify(event.details ?? {})
        && Date.parse(event.timestamp) - Date.parse(previous.timestamp) < 300
      ) {
        return current;
      }
      const next = [...current, event].slice(-30);
      if (task?.id) {
        try {
          window.localStorage.setItem(`cognisync:snake-runtime-evidence:v1:${task.id}`, JSON.stringify(next));
        } catch {
          // Runtime evidence persistence must not interrupt project operation.
        }
      }
      return next;
    });
  }, [task?.id]);

  const handleFactoryStageChange = useCallback((stage: ProjectStage) => {
    queueWorkspaceSave(0);
    setFactoryStage(stage);
  }, [queueWorkspaceSave]);

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
    <div className="project-factory">
      <ProjectFactoryHeader
        language={language}
        taskTitle={task.title}
        experimentGroup={experimentGroup}
        activeStage={factoryStage}
        onExit={onExit}
        onStageChange={handleFactoryStageChange}
        onOpenProject={() => setDemoOpen(true)}
        onOpenAssistant={() => setAssistantOpen(true)}
        saveLabel={factorySaveLabel}
      />

      <SnakeProjectDemo
        language={language}
        open={demoOpen}
        onOpenChange={setDemoOpen}
        variant="viewer"
        showLauncher={false}
        onEvidence={handleSnakeEvidence}
      />

      {experimentGroup !== 'lecture' && (
        <ProjectScaffoldAssistant
          language={language}
          taskId={task.id}
          stage={factoryStage}
          open={assistantOpen}
          onOpenChange={setAssistantOpen}
          evidence={runtimeEvidence}
          observationCount={observationCardCount}
          onApplyCompletion={setScaffoldCompletion}
        />
      )}

      {factoryStage === 'observe' && (
        <ProjectObservationStage
          language={language}
          taskId={task.id}
          evidence={runtimeEvidence}
          scaffoldCompletion={scaffoldCompletion}
          onOpenProject={() => setDemoOpen(true)}
          onContinue={() => handleFactoryStageChange('decompose')}
          onCardCountChange={setObservationCardCount}
        />
      )}

      {factoryStage === 'decompose' && (
        <ProjectFunctionStage
          language={language}
          taskId={task.id}
          onBack={() => handleFactoryStageChange('observe')}
          onContinue={() => handleFactoryStageChange('model')}
        />
      )}

      {factoryStage === 'model' && (
        experimentGroup === 'pdt'
          ? <ProjectPathStage
              language={language}
              taskId={task.id}
              stage="model"
              onBack={() => handleFactoryStageChange('decompose')}
              onContinue={() => handleFactoryStageChange('plan')}
            />
          : <ProjectStagePreview
              language={language}
              stage="model"
              onBack={() => handleFactoryStageChange('decompose')}
              onContinue={() => handleFactoryStageChange('plan')}
            />
      )}

      {factoryStage === 'plan' && (
        experimentGroup === 'pdt'
          ? <ProjectPathStage
              language={language}
              taskId={task.id}
              stage="plan"
              onBack={() => handleFactoryStageChange('model')}
              onContinue={() => handleFactoryStageChange('build')}
            />
          : <ProjectStagePreview
              language={language}
              stage="plan"
              onBack={() => handleFactoryStageChange('model')}
              onContinue={() => handleFactoryStageChange('build')}
            />
      )}

      {factoryStage === 'build' && experimentGroup === 'pdt' && (
        <ProjectBuildStage
          language={language}
          theme={theme}
          taskId={task.id}
          onBack={() => handleFactoryStageChange('plan')}
        />
      )}

      {factoryStage === 'build' && experimentGroup !== 'pdt' && (
      <div className="project-build-stage">
      <div className={`research-workbench ${allowAI ? '' : 'research-workbench-solo'}`}>

      {/* ── Left: Code Editor + Terminal ─────────────────────────────── */}
      <div className="research-panel research-code-panel">
        {/* Task header */}
        <div className="research-panel-header research-code-header">
          <div className="research-title-row">
            <FlaskConical size={16} className="research-title-icon" />
            <span className="research-task-title">
              {task.title}
            </span>
            <span className="research-language-badge">
              {task.language}
            </span>
          </div>
          {task.instructions && (
            <span className="research-instructions">
              {task.instructions}
            </span>
          )}
        </div>

        {/* CodeMirror editor — flex-1 shrinks when terminal opens */}
        <div className="research-editor-wrap">
          <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
            <ResearchCodeEditor
              value={code}
              onChange={handleCodeChange}
              language={task.language}
              theme={theme}
            />
          </React.Suspense>
        </div>

        {/* ── Terminal panel ─────────────────────────────────────────── */}
        {terminalOpen && (
          <div className="research-terminal">
            {/* Terminal title bar */}
            <div className="research-terminal-bar">
              <div className="flex items-center gap-1.5">
                <Terminal size={12} className="text-violet-300" />
                <span className="research-terminal-title">
                  {isZh ? '输出' : 'Output'}
                  {pyodideReady && (
                    <span className="research-python-status">● Python 3.x</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTerminalLines([])}
                  className="research-icon-button"
                  title={isZh ? '清空' : 'Clear'}
                >
                  <Trash2 size={12} />
                </button>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="research-icon-button"
                  title={isZh ? '关闭' : 'Close'}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Terminal output lines */}
            <div
              ref={terminalScrollRef}
              className="research-terminal-output"
            >
              {terminalLines.length === 0 ? (
                <span className="research-terminal-empty">
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
                <div className="research-running-line">
                  <Loader size={10} className="animate-spin" />
                  <span>{isZh ? '运行中...' : 'Running...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer: save status + run + complete */}
        <div className="research-actionbar">
          {/* Save status */}
          <div className="research-save-status">
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
          <div className="research-action-buttons">

            {/* Run button — only shown for Python tasks */}
            {isPython && (
              <button
                onClick={handleRun}
                disabled={running || completed}
                className="research-run-button"
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
              className={`research-submit-button ${completed ? 'research-submit-button-done' : ''}`}
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
                className="research-reopen-button"
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
          <div className="research-error-line">
            {completeError}
          </div>
        )}
      </div>

      {/* ── Right: Chat Panel ─────────────────────────────────────── */}
      {allowAI && <div className="research-panel research-assistant-panel">
        {/* Chat header */}
        <div className="research-panel-header research-assistant-header">
          <p className="research-assistant-title">
            {isZh ? 'AI 学习助手' : 'AI Learning Assistant'}
          </p>
          <p className="research-assistant-subtitle">
            {isZh ? '遇到问题？和我聊聊吧' : 'Stuck? Chat with me'}
          </p>
        </div>

        {/* Messages */}
        <div ref={chatScrollRef} className="research-chat-stream">
          {messages.length === 0 && (
            <div className="research-empty-chat">
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
                className={`research-chat-bubble ${
                  msg.role === 'user'
                    ? 'research-chat-bubble-user'
                    : 'research-chat-bubble-assistant'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="research-typing-bubble">
                <div className="flex gap-1">
                  {[0, 150, 300].map(delay => (
                    <span
                      key={delay}
                      className="research-typing-dot animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat error */}
        {chatError && (
          <div className="research-error-line">{chatError}</div>
        )}

        {/* Input */}
        <form onSubmit={handleChatSubmit} className="research-composer">
          <div className="research-composer-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isZh ? '问我任何问题...' : 'Ask me anything...'}
              disabled={completed}
              className="research-composer-input"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping || completed}
              className="research-send-button"
              title={isZh ? '发送' : 'Send'}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>}
      </div>
      </div>
      )}
    </div>
  );
};
