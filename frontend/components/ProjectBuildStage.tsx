import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Code2,
  Gamepad2,
  LoaderCircle,
  Play,
  RotateCcw,
  TestTube2,
} from 'lucide-react';
import type { Language } from '../types';
import { readStoredList, readStoredObject, type StudentModuleProgress } from '../data/projectPath';
import { SNAKE_BUILD_FUNCTIONS, type SnakeBuildFunction } from '../data/snakeBuildFunctions';
import {
  disposePythonModuleRunner,
  formatPythonModuleTestResult,
  formatPythonRunnerError,
  resetPythonGame,
  runPythonModuleTest,
  stepPythonGame,
  type PythonGameState,
  type PythonModulePreview,
} from '../services/pythonModuleRunner';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import { createRequestId, moduleCodeArtifact, type ReportKeyMoment } from '../services/stageEvents';
import './ProjectBuildStage.css';

const ResearchCodeEditor = React.lazy(() => import('./ResearchCodeEditor'));

interface Props {
  language: Language;
  theme: 'light' | 'dark';
  taskId: string;
  onBack: () => void;
  onAssistantContextChange?: (context: ProjectBuildAssistantContext) => void;
  onReportKeyMoment?: ReportKeyMoment;
  onReviseEarlierStage?: (stage: 'observe' | 'decompose') => void;
  onFinalSubmit?: () => void | Promise<void>;
  completing?: boolean;
  completed?: boolean;
}

export interface ProjectBuildAssistantContext {
  currentModuleId?: string;
  currentModule?: string;
  currentCode?: string;
  testFeedback?: string;
  artifactSummary: string;
}

type Direction = PythonGameState['direction'];
interface Cell { x: number; y: number }

const BOARD_SIZE = 12;
const INITIAL_GAME_STATE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
};
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const KEY_DIRECTIONS: Record<string, Direction | undefined> = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};
const unitId = (nodeId: string) => `base::${nodeId}`;

const resolveProgress = (
  progress: Record<string, StudentModuleProgress>,
  nodeId: string,
): StudentModuleProgress | undefined => {
  const direct = progress[unitId(nodeId)];
  if (direct) return direct;
  return Object.values(progress)
    .filter(item => item.blueprintNodeId === nodeId)
    .sort((left, right) => {
      if (left.verified !== right.verified) return left.verified ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    })[0];
};

interface SnakeBuildPreviewProps {
  language: Language;
  capabilities: Set<string>;
  codeByNode: Record<string, string>;
  demonstration: { nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null;
  diagnosticRun: number;
  onDiagnostic: (messages: string[]) => void;
}

const SnakeBuildPreview: React.FC<SnakeBuildPreviewProps> = ({
  language,
  capabilities,
  codeByNode,
  demonstration,
  diagnosticRun,
  onDiagnostic,
}) => {
  const isZh = language === 'zh';
  const [game, setGame] = useState<PythonGameState>(INITIAL_GAME_STATE);
  const [running, setRunning] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const gameRef = useRef(game);
  const inputRef = useRef<Direction | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const has = useCallback((id: string) => capabilities.has(id), [capabilities]);
  const tickMs = Math.max(190, 360 - Math.floor(game.score / 20) * 25);

  const applyGame = useCallback((next: PythonGameState) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const reset = useCallback(async () => {
    setRunning(false);
    inputRef.current = null;
    setRuntimeMessage('');
    if (!has('initial-state')) {
      applyGame(INITIAL_GAME_STATE);
      return;
    }
    try {
      applyGame(await resetPythonGame(codeByNode));
    } catch (error) {
      applyGame(INITIAL_GAME_STATE);
      setRuntimeMessage(formatPythonRunnerError(error, language));
    }
  }, [applyGame, codeByNode, has, language]);

  useEffect(() => {
    void reset();
  }, [reset]);

  useEffect(() => {
    if (!demonstration?.preview) return;
    const preview = demonstration.preview;
    const next: PythonGameState = {
      snake: preview.snake?.length ? preview.snake : gameRef.current.snake,
      food: preview.food?.length === 2 ? preview.food : gameRef.current.food,
      direction: preview.direction ?? gameRef.current.direction,
      score: preview.score ?? gameRef.current.score,
      game_over: preview.over ?? false,
    };
    applyGame(next);
  }, [applyGame, demonstration]);

  useEffect(() => {
    if (!running || game.game_over || !has('movement')) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await stepPythonGame(codeByNode, gameRef.current, inputRef.current);
        inputRef.current = null;
        if (cancelled) return;
        applyGame(next);
        if (next.game_over) setRunning(false);
      } catch (error) {
        if (cancelled) return;
        setRunning(false);
        setRuntimeMessage(formatPythonRunnerError(error, language));
      }
    }, tickMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyGame, codeByNode, game.game_over, game.score, game.snake, has, language, running, tickMs]);

  useEffect(() => {
    if (diagnosticRun === 0) return;
    const missing: string[] = [];
    if (!has('initial-state')) missing.push(isZh ? '重新开始后，初始状态仍使用演示值' : 'Reset still uses the preview state');
    if (!has('direction-input')) missing.push(isZh ? '方向键还没有接入学生代码' : 'Direction controls are not connected to student code');
    if (!has('movement')) missing.push(isZh ? '运行后蛇身还不会由学生代码推进' : 'Student code does not move the snake yet');
    if (!has('food-spawn')) missing.push(isZh ? '食物位置还没有由学生代码生成' : 'Food is not generated by student code yet');
    if (!has('eat-grow-score')) missing.push(isZh ? '进食后的增长和计分还未接入' : 'Growth and scoring are not connected yet');
    if (!has('collision')) missing.push(isZh ? '越界与自身碰撞还未接入' : 'Collision handling is not connected yet');
    if (!has('game-loop')) missing.push(isZh ? '当前由平台逐项装配，完整循环函数还未通过' : 'The platform is composing parts until the game loop passes');
    if (runtimeMessage) missing.unshift(runtimeMessage);
    onDiagnostic(missing);
  }, [diagnosticRun, has, isZh, onDiagnostic, runtimeMessage]);

  const changeDirection = useCallback((next: Direction) => {
    if (!has('direction-input') || OPPOSITE[gameRef.current.direction] === next) return;
    inputRef.current = next;
    boardRef.current?.focus({ preventScroll: true });
  }, [has]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (
        target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor'))
      );
      if (isEditing) return;
      const next = KEY_DIRECTIONS[event.key];
      if (!next || !has('direction-input')) return;
      event.preventDefault();
      changeDirection(next);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeDirection, has]);

  const cells = useMemo(() => new Map(
    game.snake.map((point, index) => [`${point[0]}:${point[1]}`, index]),
  ), [game.snake]);

  return (
    <section className="construction-preview">
      <header className="construction-titlebar">
        <div className="construction-title">
          <span><Gamepad2 size={15} />SNAKE_BUILD / SHARED RUNNER</span>
          <h3>{isZh ? '贪吃蛇 · 七函数共同运行' : 'Snake · Shared seven-function runner'}</h3>
        </div>
        <div className="construction-status-stack">
          <small>{capabilities.size}/7</small>
          <span className={running ? 'is-running' : ''}><i />{game.game_over ? (isZh ? '已碰撞' : 'COLLISION') : running ? (isZh ? '运行中' : 'RUNNING') : (isZh ? '当前版本' : 'CURRENT')}</span>
        </div>
      </header>
      <div className="construction-scorebar">
        <div><small>{isZh ? '得分' : 'SCORE'}</small><strong>{String(game.score).padStart(3, '0')}</strong></div>
        <div><small>{isZh ? '间隔' : 'TICK'}</small><strong>{tickMs}<i>ms</i></strong></div>
        <div><small>{isZh ? '已验证' : 'VERIFIED'}</small><strong>{capabilities.size}<i>/7</i></strong></div>
        <div><small>{isZh ? '方向' : 'DIRECTION'}</small><strong>{game.direction.toUpperCase()}</strong></div>
      </div>
      {demonstration && (
        <div className="construction-behavior-feedback" key={`${demonstration.nodeId}-${demonstration.run}`}>
          <CheckCircle2 size={14} /><span>{isZh ? '刚刚通过测试并接入同一运行器' : 'Just tested and connected to the shared runner'}</span><strong>{demonstration.label}</strong>
        </div>
      )}
      {runtimeMessage && <div className="construction-runtime-error" role="alert"><CircleAlert size={14} />{runtimeMessage}</div>}
      <div
        ref={boardRef}
        className="construction-board"
        style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`, gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)` }}
        role="application"
        tabIndex={0}
        onPointerDown={() => boardRef.current?.focus({ preventScroll: true })}
        aria-label={isZh ? '贪吃蛇当前版本，点击后可使用方向键或 WASD 控制' : 'Current snake build. Click, then use arrow keys or WASD'}
      >
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
          const x = index % BOARD_SIZE;
          const y = Math.floor(index / BOARD_SIZE);
          const snakeIndex = cells.get(`${x}:${y}`);
          const isFood = game.food[0] === x && game.food[1] === y;
          return <span key={index} className={`${snakeIndex !== undefined ? 'is-snake' : ''} ${snakeIndex === 0 ? 'is-head' : ''} ${isFood ? 'is-food' : ''}`} />;
        })}
        {game.game_over && <div className="construction-over"><strong>{isZh ? '你的碰撞判断结束了游戏' : 'Your collision check ended the game'}</strong><button type="button" onClick={() => void reset()}>{isZh ? '重新运行' : 'Reset'}</button></div>}
      </div>
      <div className="construction-controls">
        <div className="construction-dpad">
          <button type="button" className="is-up" onClick={() => changeDirection('up')} disabled={!has('direction-input')}><ArrowUp size={17} /></button>
          <button type="button" className="is-left" onClick={() => changeDirection('left')} disabled={!has('direction-input')}><ArrowLeft size={17} /></button>
          <button type="button" className="is-right" onClick={() => changeDirection('right')} disabled={!has('direction-input')}><ArrowRight size={17} /></button>
          <button type="button" className="is-down" onClick={() => changeDirection('down')} disabled={!has('direction-input')}><ArrowDown size={17} /></button>
        </div>
        <button type="button" className="construction-run" onClick={() => setRunning(value => !value)} disabled={!has('movement') || game.game_over}>
          <Play size={16} />{running ? (isZh ? '暂停' : 'Pause') : (isZh ? '运行当前版本' : 'Run current build')}
        </button>
        <button type="button" className="construction-reset" onClick={() => void reset()} disabled={!has('initial-state')}><RotateCcw size={16} />{isZh ? '执行重置函数' : 'Run reset function'}</button>
      </div>
      <p className="construction-keyboard-hint">{isZh ? '通过测试的函数会立即加入这里；按键与每一帧都只在浏览器内运行' : 'Passed functions join this runner immediately; keys and frames stay in your browser'}</p>
    </section>
  );
};

const linkedFunctionCard = (cards: StudentFunctionCard[], nodeId: string) => cards.find(
  card => card.mappingDecision?.status === 'accepted' && card.mappingDecision.acceptedNodeIds.includes(nodeId),
);

export const ProjectBuildStage: React.FC<Props> = ({
  language,
  theme,
  taskId,
  onBack,
  onAssistantContextChange,
  onReportKeyMoment,
  onReviseEarlierStage,
  onFinalSubmit,
  completing = false,
  completed = false,
}) => {
  const isZh = language === 'zh';
  const functionKey = `cognisync:project-function-cards:v1:${taskId}`;
  const progressKey = `cognisync:project-module-progress:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [progress, setProgress] = useState<Record<string, StudentModuleProgress>>(() => readStoredObject(progressKey, {}));
  const [selectedNodeId, setSelectedNodeId] = useState(SNAKE_BUILD_FUNCTIONS[0].id);
  const [testMessage, setTestMessage] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [lastFailedUnitId, setLastFailedUnitId] = useState<string | null>(null);
  const [revisingStage, setRevisingStage] = useState<'observe' | 'decompose' | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [diagnosticRun, setDiagnosticRun] = useState(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [demonstration, setDemonstration] = useState<{ nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null>(null);

  const selectedNode = SNAKE_BUILD_FUNCTIONS.find(node => node.id === selectedNodeId) ?? SNAKE_BUILD_FUNCTIONS[0];
  const selectedCard = linkedFunctionCard(cards, selectedNode.id);
  const currentProgress = resolveProgress(progress, selectedNode.id);
  const currentCode = currentProgress?.code ?? selectedNode.starterCode;
  const completedCount = SNAKE_BUILD_FUNCTIONS.filter(node => resolveProgress(progress, node.id)?.verified).length;
  const capabilities = useMemo(() => new Set(
    SNAKE_BUILD_FUNCTIONS.filter(node => resolveProgress(progress, node.id)?.verified).map(node => node.id),
  ), [progress]);
  const verifiedCodeSnapshot = JSON.stringify(SNAKE_BUILD_FUNCTIONS.flatMap(node => {
    const item = resolveProgress(progress, node.id);
    return item?.verified ? [[node.id, item.code]] : [];
  }));
  // 编辑一张尚未通过的卡不会反复重置左侧游戏；只有真正装配的代码变化时
  // 才生成新的代码集合并触发共享运行器重置。
  const codeByNode = useMemo<Record<string, string>>(
    () => Object.fromEntries(JSON.parse(verifiedCodeSnapshot) as [string, string][]),
    [verifiedCodeSnapshot],
  );

  useEffect(() => {
    window.localStorage.setItem(progressKey, JSON.stringify(progress));
  }, [progress, progressKey]);

  useEffect(() => () => disposePythonModuleRunner(), []);

  useEffect(() => {
    const latestAttempt = currentProgress?.testAttempts?.[currentProgress.testAttempts.length - 1];
    onAssistantContextChange?.({
      currentModuleId: selectedNode.id,
      currentModule: isZh ? selectedNode.titleZh : selectedNode.titleEn,
      currentCode,
      testFeedback: testMessage || (latestAttempt ? `${latestAttempt.passed ? 'passed' : 'failed'} · ${latestAttempt.resultCode}` : undefined),
      artifactSummary: [
        `当前基础函数：${isZh ? selectedNode.titleZh : selectedNode.titleEn}`,
        selectedCard ? `学生自己的功能命名：${selectedCard.responsibility}` : '',
        selectedCard?.implementation ? `学生实现描述：${selectedCard.implementation}` : '',
        `七函数进度：${completedCount}/7`,
      ].filter(Boolean).join('\n'),
    });
  }, [completedCount, currentCode, currentProgress?.testAttempts, isZh, onAssistantContextChange, selectedCard, selectedNode, testMessage]);

  const updateCode = (code: string) => {
    setProgress(current => {
      const next = { ...current };
      const currentKey = unitId(selectedNode.id);
      const legacy = resolveProgress(current, selectedNode.id);
      next[currentKey] = {
        ...(legacy ?? {} as StudentModuleProgress),
        cardId: selectedCard?.id ?? currentKey,
        blueprintNodeId: selectedNode.id,
        code,
        verified: false,
        updatedAt: new Date().toISOString(),
      };
      if (selectedNode.id !== 'game-loop') {
        const loop = resolveProgress(current, 'game-loop');
        if (loop?.verified) next[unitId('game-loop')] = { ...loop, verified: false, updatedAt: new Date().toISOString() };
      }
      return next;
    });
    setTestMessage('');
    setDemonstration(null);
  };

  const reviseEarlierStage = async (stage: 'observe' | 'decompose') => {
    if (revisingStage) return;
    const failedUnitId = lastFailedUnitId;
    const failed = failedUnitId ? progress[failedUnitId] : undefined;
    if (failed && failedUnitId && onReportKeyMoment) {
      setRevisingStage(stage);
      setRevisionError('');
      try {
        const recorded = await onReportKeyMoment({
          stage: 'build',
          eventType: 'structure_change',
          detail: {
            trigger: 'test_failure', revisingStage: stage, failedUnitId,
            failedNodeId: failed.blueprintNodeId,
            lastResultCode: failed.testAttempts?.[failed.testAttempts.length - 1]?.resultCode,
          },
          artifacts: [moduleCodeArtifact(failedUnitId, failed, 'test_revision', `revising ${stage} after failed test`)],
        });
        if (!recorded) {
          setRevisionError(isZh ? '这次修订还没有记录成功。代码和测试结果仍保留，请检查网络后重试。' : 'The revision was not recorded. Your code and result are kept; check the connection and retry.');
          return;
        }
      } catch {
        setRevisionError(isZh ? '这次修订还没有记录成功。代码和测试结果仍保留，请检查网络后重试。' : 'The revision was not recorded. Your code and result are kept; check the connection and retry.');
        return;
      } finally {
        setRevisingStage(null);
      }
    }
    setRevisionError('');
    setLastFailedUnitId(null);
    onReviseEarlierStage?.(stage);
  };

  const verifyCurrentModule = async () => {
    if (testRunning) return;
    setTestRunning(true);
    setTestMessage(isZh ? '正在浏览器内运行当前 Python 函数；首次使用需要加载运行环境。' : 'Running this Python function in your browser. The first run loads the runtime.');
    const currentUnitId = unitId(selectedNode.id);
    const cardId = selectedCard?.id ?? currentUnitId;
    try {
      const result = await runPythonModuleTest(selectedNode.id, currentCode, codeByNode);
      const now = new Date().toISOString();
      const attempt = {
        id: createRequestId(), passed: result.passed, resultCode: result.resultCode,
        durationMs: result.durationMs, createdAt: now,
      };
      const item: StudentModuleProgress = {
        cardId,
        blueprintNodeId: selectedNode.id,
        code: currentCode,
        verified: result.passed,
        updatedAt: now,
        testAttempts: [...(currentProgress?.testAttempts ?? []).slice(-11), attempt],
      };
      setProgress(current => ({ ...current, [currentUnitId]: item }));
      setTestMessage(formatPythonModuleTestResult(result, language));
      void onReportKeyMoment?.({
        stage: 'build',
        eventType: 'module_test',
        detail: {
          unitId: currentUnitId, cardId, blueprintNodeId: selectedNode.id,
          attemptId: attempt.id, passed: result.passed,
          resultCode: result.resultCode, durationMs: result.durationMs,
        },
        artifacts: [moduleCodeArtifact(currentUnitId, { ...item, testAttempts: [attempt] }, 'structure_edit', result.passed ? undefined : `test failed: ${result.resultCode}`)],
      });
      setLastFailedUnitId(result.passed ? null : currentUnitId);
      setDemonstration(result.passed ? current => ({
        nodeId: selectedNode.id,
        run: (current?.run ?? 0) + 1,
        label: isZh ? selectedNode.effectZh : selectedNode.effectEn,
        preview: result.preview,
      }) : null);
    } catch (error) {
      setTestMessage(formatPythonRunnerError(error, language));
    } finally {
      setTestRunning(false);
    }
  };

  return (
    <section className="project-build-workspace">
      <div className="build-workspace-main">
        <div className="build-preview-column">
          <SnakeBuildPreview
            language={language}
            capabilities={capabilities}
            codeByNode={codeByNode}
            diagnosticRun={diagnosticRun}
            demonstration={demonstration}
            onDiagnostic={setDiagnostics}
          />
          <section className="integration-diagnostics">
            <header>
              <div><TestTube2 size={16} /><strong>{isZh ? '七函数组合检查' : 'SEVEN-FUNCTION CHECK'}</strong></div>
              <button type="button" onClick={() => setDiagnosticRun(value => value + 1)}>{isZh ? '检查当前游戏' : 'Check current game'}</button>
            </header>
            {diagnosticRun === 0 ? (
              <p>{isZh ? '系统只报告当前游戏中可观察的问题；不会显示教师测试数据。' : 'Only observable game problems are reported; teacher test data stays hidden.'}</p>
            ) : diagnostics.length === 0 ? (
              <p className="is-success"><CheckCircle2 size={15} />{isZh ? '七个基础函数都已通过并接入同一个运行器。' : 'All seven functions passed and share one runner.'}</p>
            ) : (
              <ul>{diagnostics.map(item => <li key={item}><CircleAlert size={14} />{item}</li>)}</ul>
            )}
          </section>
        </div>

        <div className="build-editor-column">
          <header className="build-editor-heading">
            <div><span>03 / BUILD & VERIFY</span><h3>{isZh ? '七个基础函数' : 'Seven core functions'}</h3></div>
            <strong>{completedCount}<small>/7</small></strong>
          </header>

          <nav className="student-module-rail" aria-label={isZh ? '七个基础函数' : 'Seven core functions'}>
            {SNAKE_BUILD_FUNCTIONS.map((node, index) => {
              const verified = Boolean(resolveProgress(progress, node.id)?.verified);
              return (
                <button key={node.id} type="button" className={`${selectedNode.id === node.id ? 'is-active' : ''} ${verified ? 'is-verified' : ''}`} onClick={() => { setSelectedNodeId(node.id); setTestMessage(''); }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p title={isZh ? node.titleZh : node.titleEn}>{isZh ? node.titleZh : node.titleEn}<small>{node.signature}</small></p>
                  <i>{verified ? <Check size={14} /> : <CircleDot size={14} />}</i>
                </button>
              );
            })}
          </nav>

          <article className="module-editor-card">
            <header>
              <div>
                <span>{isZh ? '固定基础函数' : 'CORE FUNCTION'}</span>
                <h4>{isZh ? selectedNode.titleZh : selectedNode.titleEn}</h4>
                <small>{selectedCard ? `${isZh ? '你的功能命名' : 'Your function name'}：${selectedCard.responsibility}` : (isZh ? '可以从任意一张函数卡开始' : 'Start with any function')}</small>
              </div>
              <span className={currentProgress?.verified ? 'is-complete' : ''}>{currentProgress?.verified ? (isZh ? '已验证' : 'VERIFIED') : (isZh ? '待实现' : 'TO BUILD')}</span>
            </header>

            <div className="module-contract-grid">
              <div><small>{isZh ? '你的运行观察' : 'YOUR OBSERVATION'}</small><span>{selectedCard?.observationText || (isZh ? '回看左侧游戏，先定位这个函数对应的变化。' : 'Use the game on the left to locate this function’s change.')}</span></div>
              <div><small>{isZh ? '你的实现描述' : 'YOUR DESCRIPTION'}</small><span>{selectedCard?.implementation || (isZh ? '功能卡没有直接对应时，也可以先编码再回去修订。' : 'You can code first and revise your function card later.')}</span></div>
            </div>

            <div className="module-code-header"><div><Code2 size={15} /><span>{selectedNode.signature}</span></div><div><span>{isZh ? '浏览器本地运行' : 'LOCAL IN BROWSER'}</span></div></div>
            <div className="module-code-editor">
              <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
                <ResearchCodeEditor value={currentCode} onChange={updateCode} language="python" theme={theme} />
              </React.Suspense>
            </div>
            <footer className="module-test-bar">
              <span>{testMessage || (isZh ? '运行后只显示通过状态或可观察的短问题，不显示测试输入与标准答案。' : 'Tests report pass status or a short observable issue, never test inputs or answer code.')}</span>
              <button type="button" onClick={() => void verifyCurrentModule()} disabled={testRunning}>
                {testRunning ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
                {testRunning ? (isZh ? '正在运行' : 'Running') : (isZh ? '运行函数测试' : 'Run function test')}
              </button>
            </footer>
          </article>
        </div>
      </div>

      {lastFailedUnitId && (
        <div className="build-revision-prompt" role="status">
          <span>{isZh ? '测试没通过。如果问题出在最初的观察或功能命名，可以回去修订，再回来继续。' : 'If the failed test comes from the observation or function name, revise it and return.'}</span>
          {revisionError ? <p className="build-revision-error" role="alert">{revisionError}</p> : null}
          <div className="build-revision-actions">
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('observe')}>{revisingStage === 'observe' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '补充观察' : 'Revise observations')}</button>
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('decompose')}>{revisingStage === 'decompose' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '修订功能卡' : 'Revise function cards')}</button>
            <button type="button" disabled={revisingStage !== null} onClick={() => { setRevisionError(''); setLastFailedUnitId(null); }}>{isZh ? '继续在这里改' : 'Keep editing here'}</button>
          </div>
        </div>
      )}

      <footer className="build-workspace-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to function cards'}</button>
        <span>{isZh ? '七张卡固定呈现；教师依赖关系只用于装配与诊断，不锁住编码顺序' : 'Seven fixed cards; teacher dependencies guide assembly, not coding order.'}</span>
        {onFinalSubmit && (
          <button type="button" className="build-final-submit" onClick={() => void onFinalSubmit()} disabled={completing || completed || completedCount < 7} title={completedCount < 7 ? (isZh ? '七个基础函数全部通过后再继续' : 'Pass all seven core functions first') : undefined}>
            {completed ? (isZh ? '已提交' : 'Submitted') : completing ? (isZh ? '提交中' : 'Submitting') : (isZh ? '提交基础项目' : 'Submit core project')}
          </button>
        )}
      </footer>
    </section>
  );
};
