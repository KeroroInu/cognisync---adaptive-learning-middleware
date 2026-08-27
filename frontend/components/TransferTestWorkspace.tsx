import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, LoaderCircle, LogOut, PanelLeftClose, PanelLeftOpen, Play, Plus, Send, Terminal, Trash2, X } from 'lucide-react';
import type { Language, ResearchTask, UserProfile } from '../types';
import { saveResearchProgress, saveResearchWorkspace } from '../services/api';
import { createRequestId, isFinalSubmissionPersisted, isStageEventPersisted, reportFinalSubmission, reportStageEvent } from '../services/stageEvents';
import { formatPythonRunnerError, runPythonMazeTest, type PythonMazeTestResult } from '../services/pythonModuleRunner';
import { bundleMazeFunctions, createMazeTransferWorkspace, generateCodeSignature, isMazeTransferWorkspace, MAZE_TRANSFER_CONFIG, type MazeTransferWorkspace } from '../data/mazeTransfer';
import { ProjectScaffoldAssistant } from './ProjectScaffoldAssistant';
import './TransferTestWorkspace.css';

const ResearchCodeEditor = React.lazy(() => import('./ResearchCodeEditor'));

interface Props {
  task: ResearchTask;
  language: Language;
  theme: 'light' | 'dark';
  userId?: string;
  onUpdateProfile: (profile: UserProfile) => void;
  onLogout: () => void;
}

const resultText = (result: PythonMazeTestResult | null, isZh: boolean) => {
  if (!result) return isZh ? '终端将显示代码输出和迷宫检查结果。' : 'Output and maze checks will appear here.';
  const labels: Record<string, string> = {
    PASSED: '到达宝箱', FUNCTION_MISSING: '找不到 next_move(state)', INVALID_DIRECTION: '返回值不是四个方向之一',
    HIT_WALL: '角色撞到了墙', OUT_OF_BOUNDS: '角色走出了边界', GOAL_NOT_REACHED: '在步数上限内没有到达宝箱',
    RESTRICTED_CODE: '代码使用了测试环境禁止的能力', SYNTAX_ERROR: '代码有语法错误', RUNTIME_ERROR: '代码运行时出错',
  };
  return `${result.passed ? '✓' : '×'} ${labels[result.resultCode] || result.resultCode}${result.detail ? ` · ${result.detail}` : ''}`;
};

export const TransferTestWorkspace: React.FC<Props> = ({ task, language, theme, userId, onUpdateProfile, onLogout }) => {
  const isZh = language === 'zh';
  const [workspace, setWorkspace] = useState<MazeTransferWorkspace>(() => {
    let initial = isMazeTransferWorkspace(task.workspace_data) ? task.workspace_data : createMazeTransferWorkspace(task);
    if (!initial.startedAt) {
      initial = { ...initial, startedAt: Date.now() };
    }
    return initial;
  });
  const [railOpen, setRailOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(Boolean(task.is_completed));
  const [result, setResult] = useState<PythonMazeTestResult | null>(() => workspace.lastResult ? {
    ...workspace.lastResult, detail: '', durationMs: 0, output: [],
  } : null);
  const [notice, setNotice] = useState('');
  const [saveLabel, setSaveLabel] = useState('已保存');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitAttempt = useRef<{ signature: string; requestId: string } | null>(null);
  const activeCard = workspace.cards.find(card => card.id === workspace.activeCardId) ?? workspace.cards[0];
  const bundledCode = useMemo(() => bundleMazeFunctions(workspace), [workspace]);
  const currentSignature = useMemo(() => generateCodeSignature(bundledCode), [bundledCode]);
  const isTestPassed = workspace.lastResult?.passed && workspace.lastPassedSignature === currentSignature;
  const startedAtIso = useMemo(() => new Date(workspace.startedAt).toISOString(), [workspace.startedAt]);
  
  const pathSet = useMemo(() => new Map((result?.path ?? []).map((point, index) => [`${point[0]}-${point[1]}`, index])), [result]);
  const wallSet = useMemo(() => new Set(MAZE_TRANSFER_CONFIG.walls.map(point => `${point[0]}-${point[1]}`)), []);

  const saveQueue = useRef<MazeTransferWorkspace[]>([]);
  const isSaving = useRef(false);

  const persist = useCallback((next: MazeTransferWorkspace): Promise<boolean> => {
    return new Promise((resolve) => {
      saveQueue.current.push(next);
      
      const processQueue = async () => {
        if (isSaving.current) return;
        if (saveQueue.current.length === 0) {
          resolve(true);
          return;
        }
        isSaving.current = true;
        setSaveLabel('保存中');
        
        const target = saveQueue.current[saveQueue.current.length - 1];
        saveQueue.current = [];
        
        try {
          const bundle = bundleMazeFunctions(target);
          await Promise.all([
            saveResearchWorkspace(task.id, { ...target }),
            saveResearchProgress(task.id, bundle, new Date(target.startedAt).toISOString()),
          ]);
          setSaveLabel('已保存');
          resolve(true);
        } catch {
          setSaveLabel('保存失败');
          resolve(false);
        } finally {
          isSaving.current = false;
          if (saveQueue.current.length > 0) {
            processQueue();
          }
        }
      };
      
      void processQueue();
    });
  }, [task.id]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveQueue.current.length > 0 || isSaving.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveLabel('待保存');
    saveTimer.current = setTimeout(() => void persist(workspace), 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [persist, workspace]);

  const changeCode = (code: string) => setWorkspace(current => ({
    ...current,
    cards: current.cards.map(card => card.id === activeCard.id ? { ...card, code } : card),
    savedAt: new Date().toISOString(),
  }));

  const addCard = () => {
    const id = `helper-${crypto.randomUUID?.() ?? Date.now()}`;
    setWorkspace(current => ({
      ...current,
      cards: [...current.cards, { id, title: `新函数 ${current.cards.length}`, code: 'def helper(state):\n    # 和 AI 讨论后，在这里自由实现\n    return None' }],
      activeCardId: id,
      savedAt: new Date().toISOString(),
    }));
  };

  const deleteCard = (id: string) => setWorkspace(current => ({
    ...current,
    cards: current.cards.filter(card => card.id !== id),
    activeCardId: current.activeCardId === id ? 'next-move' : current.activeCardId,
    savedAt: new Date().toISOString(),
  }));

  const run = async () => {
    if (running || completed) return;
    setRunning(true);
    setNotice('');
    setTerminalOpen(true);
    try {
      const nextResult = await runPythonMazeTest(bundledCode, MAZE_TRANSFER_CONFIG);
      setResult(nextResult);
      const passed = nextResult.passed;
      const nextWorkspace: MazeTransferWorkspace = {
        ...workspace,
        lastResult: { passed: passed, resultCode: nextResult.resultCode, path: nextResult.path, testedAt: new Date().toISOString() },
        lastPassedSignature: passed ? currentSignature : undefined,
        savedAt: new Date().toISOString(),
      };
      setWorkspace(nextWorkspace);
      const saved = await persist(nextWorkspace);
      if (!saved) {
        setNotice(isZh ? '代码运行完成，但过程数据还没有同步，请检查网络后再测试。' : 'The code ran, but progress has not synced. Check the network before testing again.');
        return;
      }
      const eventOutcome = await reportStageEvent(task.id, {
        request_id: createRequestId(), stage: 'transfer', event_type: 'module_test',
        detail: { passed: passed, resultCode: nextResult.resultCode, cardCount: workspace.cards.length, pathLength: nextResult.path.length },
        artifacts: [{ artifact_type: 'module_code', artifact_key: activeCard.id, content: { title: activeCard.title, code: activeCard.code, verified: passed }, change_source: 'test_revision' }],
      });
      if (!isStageEventPersisted(eventOutcome)) {
        setNotice(isZh ? '测试结果已保存，但本次过程事件没有记录成功，可再运行一次。' : 'The result was saved, but this test event was not recorded. You can run it again.');
      }
    } catch (reason) {
      setNotice(formatPythonRunnerError(reason, language));
    } finally {
      setRunning(false);
    }
  };

  const submit = async () => {
    if (submitting || completed) return;
    
    if (!isTestPassed) {
      setNotice(isZh ? '请先测试代码并确保通过迷宫，且测试后未修改代码，才能提交。' : 'Please run the test and ensure it passes without subsequent code changes before submitting.');
      return;
    }
    
    setSubmitting(true);
    setNotice('');
    try {
      const saved = await persist(workspace);
      if (!saved) {
        setNotice(isZh ? '工作区还没有保存成功，暂时不能提交。' : 'The workspace has not saved yet, so it cannot be submitted.');
        return;
      }
      const signature = JSON.stringify({ taskId: task.id, bundledCode, startedAt: startedAtIso, resultCode: result?.resultCode });
      if (!submitAttempt.current || submitAttempt.current.signature !== signature) {
        submitAttempt.current = { signature, requestId: createRequestId() };
      }
      const outcome = await reportFinalSubmission(task.id, {
        request_id: submitAttempt.current.requestId, stage: 'transfer', code_submitted: bundledCode, started_at: startedAtIso,
        detail: { cardCount: workspace.cards.length, lastTestPassed: true, codeSignature: currentSignature, testTemplate: task.test_template },
        artifacts: workspace.cards.map(card => ({ artifact_type: 'module_code', artifact_key: card.id, content: { title: card.title, code: card.code, verified: true }, change_source: 'stage_confirm' })),
      });
      if (isFinalSubmissionPersisted(outcome)) {
        submitAttempt.current = null;
        setCompleted(true);
      }
      else setNotice(isZh ? '提交没有完成，代码已保存，请稍后重试。' : 'Submission did not complete. Your code is saved; retry shortly.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`transfer-workspace ${railOpen ? '' : 'is-rail-collapsed'}`}>
      <header className="transfer-header">
        <div><span>TRANSFER_TEST / MAZE_01</span><strong>{task.title}</strong></div>
        <div className="transfer-header-actions">
          <span className={`transfer-ai-badge ${task.ai_enabled ? 'is-on' : ''}`}><Bot size={15} />AI {task.ai_enabled ? '已开启' : '未开启'}</span>
          <span className="transfer-save-label"><Check size={14} />{saveLabel}</span>
          {task.ai_enabled && <button type="button" onClick={() => setAssistantOpen(true)}><Bot size={17} />问 AI</button>}
          <button type="button" onClick={onLogout} title="退出"><LogOut size={17} /></button>
        </div>
      </header>

      {notice && <div className="transfer-notice">{notice}<button type="button" onClick={() => setNotice('')}><X size={15} /></button></div>}

      <main className="transfer-main">
        <section className="transfer-maze-panel">
          <div className="transfer-section-bar"><span>迷宫运行器</span><small>{result?.passed ? '已到达宝箱' : '等待运行'}</small></div>
          <div className="transfer-maze" style={{ '--maze-size': MAZE_TRANSFER_CONFIG.boardSize } as React.CSSProperties}>
            {Array.from({ length: MAZE_TRANSFER_CONFIG.boardSize ** 2 }, (_, index) => {
              const x = index % MAZE_TRANSFER_CONFIG.boardSize;
              const y = Math.floor(index / MAZE_TRANSFER_CONFIG.boardSize);
              const key = `${x}-${y}`;
              const pathIndex = pathSet.get(key);
              const isStart = x === MAZE_TRANSFER_CONFIG.start[0] && y === MAZE_TRANSFER_CONFIG.start[1];
              const isGoal = x === MAZE_TRANSFER_CONFIG.goal[0] && y === MAZE_TRANSFER_CONFIG.goal[1];
              const isCurrent = Boolean(result?.path.length) && pathIndex === result!.path.length - 1;
              return <div key={key} className={`transfer-cell ${wallSet.has(key) ? 'is-wall' : ''} ${pathIndex !== undefined ? 'is-path' : ''} ${isCurrent ? 'is-current' : ''}`}>
                {isStart && <span className="transfer-start">S</span>}{isGoal && <span className="transfer-treasure">◆</span>}
              </div>;
            })}
          </div>
          <div className="transfer-maze-foot"><span>起点 S</span><span>宝箱 ◆</span><span>{result ? `${result.path.length - 1} 步` : '尚未测试'}</span></div>
        </section>

        <section className="transfer-code-panel">
          <aside className="transfer-function-rail">
            <button className="transfer-rail-toggle" type="button" onClick={() => setRailOpen(value => !value)} title={railOpen ? '收起函数列表' : '展开函数列表'}>{railOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
            {railOpen && <>
              <div className="transfer-rail-title">函数 <span>{workspace.cards.length}</span></div>
              <nav>{workspace.cards.map((card, index) => <button type="button" key={card.id} className={card.id === activeCard.id ? 'is-active' : ''} onClick={() => setWorkspace(current => ({ ...current, activeCardId: card.id }))}>
                <span>{String(index + 1).padStart(2, '0')}</span><strong>{card.title}</strong>{!card.fixed && <Trash2 size={14} onClick={event => { event.stopPropagation(); deleteCard(card.id); }} />}
              </button>)}</nav>
              <button className="transfer-add-function" type="button" onClick={addCard}><Plus size={16} />添加函数</button>
            </>}
          </aside>

          <div className="transfer-editor-column">
            <div className="transfer-editor-title">
              <input aria-label="函数卡名称" value={activeCard.title} onChange={event => setWorkspace(current => ({ ...current, cards: current.cards.map(card => card.id === activeCard.id ? { ...card, title: event.target.value } : card) }))} />
              <small>{activeCard.fixed ? '可视化运行器入口' : '自定义辅助函数'}</small>
            </div>
            <div className="transfer-editor-wrap"><React.Suspense fallback={<div className="transfer-loading">Preparing editor…</div>}><ResearchCodeEditor value={activeCard.code} onChange={changeCode} language="python" theme={theme} /></React.Suspense></div>
            {terminalOpen && <div className="transfer-terminal">
              <div><span><Terminal size={14} />TERMINAL</span><button type="button" onClick={() => setTerminalOpen(false)}><X size={14} /></button></div>
              <pre>{resultText(result, isZh)}{result?.output?.length ? `\n${result.output.join('\n')}` : ''}</pre>
            </div>}
            <footer className="transfer-actionbar">
              <button className="transfer-terminal-button" type="button" onClick={() => setTerminalOpen(value => !value)}><Terminal size={16} />{terminalOpen ? '隐藏终端' : '显示终端'}</button>
              <div>
                <button className="transfer-run-button" type="button" disabled={running || completed} onClick={() => void run()}>{running ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} />}测试并运行</button>
                <button className={`transfer-submit-button ${!isTestPassed && !completed ? 'is-disabled' : ''}`} type="button" disabled={submitting || completed} onClick={() => void submit()}>{submitting ? <LoaderCircle className="animate-spin" size={17} /> : completed ? <Check size={17} /> : <Send size={17} />}{completed ? '已提交' : '提交测试'}</button>
              </div>
            </footer>
          </div>
        </section>
      </main>

      {task.ai_enabled && <ProjectScaffoldAssistant
        language={language} taskId={task.id} taskTitle={task.title} taskPrompt={task.ai_prompt ?? undefined} userId={userId}
        stage="transfer" open={assistantOpen} onOpenChange={setAssistantOpen} evidence={[]} observationCount={0}
        contextKey={activeCard.id} getArtifactContext={() => ({ summary: `当前是迷宫寻宝迁移测试。学生共有 ${workspace.cards.length} 张函数卡，当前卡为“${activeCard.title}”。`, currentModule: activeCard.id, currentCode: activeCard.code, testFeedback: resultText(result, true) })}
        onProfileUpdate={onUpdateProfile} onApplyCompletion={() => {}}
      />}
    </div>
  );
};
