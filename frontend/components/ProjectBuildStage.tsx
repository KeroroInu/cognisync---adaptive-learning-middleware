import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDot,
  Code2,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Power,
  RotateCcw,
  TestTube2,
  Trash2,
} from 'lucide-react';
import type { Language } from '../types';
import { readStoredList, readStoredObject, type StudentModuleProgress } from '../data/projectPath';
import { SNAKE_BUILD_FUNCTIONS, type SnakeBuildFunction } from '../data/snakeBuildFunctions';
import {
  MAX_CREATIVE_CODE_CHARS,
  MAX_CREATIVE_FUNCTIONS,
  createStudentCreativeFunction,
  creativeHookLabel,
  creativeUnitId,
  upgradeCreativeStarterCode,
  type StudentCreativeFunction,
} from '../data/snakeCreativeFunctions';
import {
  disposePythonModuleRunner,
  formatPythonModuleTestResult,
  formatPythonRunnerError,
  resetPythonGame,
  runPythonCreativeHooks,
  runPythonCreativeTest,
  runPythonModuleTest,
  stepPythonGame,
  type PythonGameState,
  type PythonModulePreview,
  type PythonCreativeHookError,
} from '../services/pythonModuleRunner';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import { creativeCodeArtifact, createRequestId, moduleCodeArtifact, type ReportKeyMoment } from '../services/stageEvents';
import './ProjectBuildStage.css';

const ResearchCodeEditor = React.lazy(() => import('./ResearchCodeEditor'));

interface Props {
  language: Language;
  theme: 'light' | 'dark';
  taskId: string;
  onBack: () => void;
  onAssistantContextChange?: (context: ProjectBuildAssistantContext) => void;
  onReportKeyMoment?: ReportKeyMoment;
  onReviseEarlierStage?: (stage: 'observe' | 'decompose' | 'model') => void;
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
  creativeFunctions: StudentCreativeFunction[];
  demonstration: { nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null;
  diagnosticRun: number;
  onDiagnostic: (messages: string[]) => void;
  onCreativeRuntimeErrors: (errors: PythonCreativeHookError[]) => void;
}

const SnakeBuildPreview: React.FC<SnakeBuildPreviewProps> = React.memo(({
  language,
  capabilities,
  codeByNode,
  creativeFunctions,
  demonstration,
  diagnosticRun,
  onDiagnostic,
  onCreativeRuntimeErrors,
}) => {
  const isZh = language === 'zh';
  const [game, setGame] = useState<PythonGameState>(INITIAL_GAME_STATE);
  const [running, setRunning] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const gameRef = useRef(game);
  const inputRef = useRef<Direction | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const creativeRuntimeRef = useRef(creativeFunctions);
  const creativeErrorHandlerRef = useRef(onCreativeRuntimeErrors);
  const has = useCallback((id: string) => capabilities.has(id), [capabilities]);
  const tickMs = Math.max(190, 360 - Math.floor(game.score / 20) * 25);

  useEffect(() => {
    creativeRuntimeRef.current = creativeFunctions;
  }, [creativeFunctions]);

  useEffect(() => {
    creativeErrorHandlerRef.current = onCreativeRuntimeErrors;
  }, [onCreativeRuntimeErrors]);

  const runCreativeHook = useCallback(async (
    hook: StudentCreativeFunction['hook'],
    state: PythonGameState,
    event: { input?: Direction | null; scoreBefore?: number; scoreAfter?: number } = {},
  ) => {
    const result = await runPythonCreativeHooks(creativeRuntimeRef.current, hook, state, event);
    if (result.errors.length > 0) creativeErrorHandlerRef.current(result.errors);
    return result.state;
  }, []);

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
      const base = await resetPythonGame(codeByNode);
      applyGame(await runCreativeHook('game_start', base));
    } catch (error) {
      applyGame(INITIAL_GAME_STATE);
      setRuntimeMessage(formatPythonRunnerError(error, language));
    }
  }, [applyGame, codeByNode, has, language, runCreativeHook]);

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
        const userInput = inputRef.current;
        let before = gameRef.current;
        if (userInput) before = await runCreativeHook('key_input', before, { input: userInput });
        before = await runCreativeHook('before_move', before, { input: userInput });
        const scoreBefore = before.score;
        let next = await stepPythonGame(codeByNode, before, userInput);
        const baseScoreAfter = next.score;
        inputRef.current = null;
        next = await runCreativeHook('after_move', next, { scoreBefore, scoreAfter: baseScoreAfter });
        if (baseScoreAfter > scoreBefore) {
          next = await runCreativeHook('food_eaten', next, { scoreBefore, scoreAfter: baseScoreAfter });
        }
        next = await runCreativeHook('loop', next, { scoreBefore, scoreAfter: next.score });
        if (!before.game_over && next.game_over) next = await runCreativeHook('game_end', next);
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
  }, [applyGame, codeByNode, game.game_over, game.score, game.snake, has, language, runCreativeHook, running, tickMs]);

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
      <div className="construction-scorebar">
        <div><small>{isZh ? '得分' : 'SCORE'}</small><strong>{String(game.score).padStart(3, '0')}</strong></div>
        <div><small>{isZh ? '间隔' : 'TICK'}</small><strong>{tickMs}<i>ms</i></strong></div>
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
    </section>
  );
});

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
  const creativeKey = `cognisync:project-creative-functions:v1:${taskId}`;
  const sidebarKey = `cognisync:project-build-sidebar:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [progress, setProgress] = useState<Record<string, StudentModuleProgress>>(() => readStoredObject(progressKey, {}));
  const [creativeFunctions, setCreativeFunctions] = useState<StudentCreativeFunction[]>(() => (
    readStoredList<StudentCreativeFunction>(creativeKey).map(card => ({
      ...card,
      code: upgradeCreativeStarterCode(card.code),
    }))
  ));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarKey) !== 'expanded';
    } catch {
      return true;
    }
  });
  const creativeFunctionsRef = useRef(creativeFunctions);
  const [selectedNodeId, setSelectedNodeId] = useState(SNAKE_BUILD_FUNCTIONS[0].id);
  const [activeCreativeId, setActiveCreativeId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [lastFailedUnitId, setLastFailedUnitId] = useState<string | null>(null);
  const [revisingStage, setRevisingStage] = useState<'observe' | 'decompose' | 'model' | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [diagnosticRun, setDiagnosticRun] = useState(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [demonstration, setDemonstration] = useState<{ nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null>(null);

  const selectedNode = SNAKE_BUILD_FUNCTIONS.find(node => node.id === selectedNodeId) ?? SNAKE_BUILD_FUNCTIONS[0];
  const selectedCreative = creativeFunctions.find(card => card.id === activeCreativeId);
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
  const creativeRuntimeSnapshot = JSON.stringify(
    creativeFunctions.filter(card => card.enabled && card.verified).slice(0, MAX_CREATIVE_FUNCTIONS),
  );
  const creativeRuntimeFunctions = useMemo<StudentCreativeFunction[]>(
    () => JSON.parse(creativeRuntimeSnapshot) as StudentCreativeFunction[],
    [creativeRuntimeSnapshot],
  );

  const persistCreativeFunctions = useCallback((next: StudentCreativeFunction[]) => {
    creativeFunctionsRef.current = next;
    setCreativeFunctions(next);
    window.localStorage.setItem(creativeKey, JSON.stringify(next));
  }, [creativeKey]);

  useEffect(() => {
    window.localStorage.setItem(progressKey, JSON.stringify(progress));
  }, [progress, progressKey]);

  useEffect(() => {
    window.localStorage.setItem(creativeKey, JSON.stringify(creativeFunctions));
  }, [creativeFunctions, creativeKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarKey, sidebarCollapsed ? 'collapsed' : 'expanded');
    } catch {
      // 侧栏偏好保存失败不影响编码与测试。
    }
  }, [sidebarCollapsed, sidebarKey]);

  useEffect(() => () => disposePythonModuleRunner(), []);

  useEffect(() => {
    if (selectedCreative) {
      const latestAttempt = selectedCreative.testAttempts?.[selectedCreative.testAttempts.length - 1];
      onAssistantContextChange?.({
        currentModuleId: creativeUnitId(selectedCreative.id),
        currentModule: selectedCreative.title,
        currentCode: selectedCreative.code,
        testFeedback: selectedCreative.lastRuntimeError
          || (latestAttempt ? `${latestAttempt.passed ? 'passed' : 'failed'} · ${latestAttempt.resultCode}` : undefined),
        artifactSummary: [
          `当前创意函数：${selectedCreative.title}`,
          `受控事件钩子：${creativeHookLabel(selectedCreative.hook, language)}`,
          `状态：${selectedCreative.enabled ? '已启用' : selectedCreative.verified ? '已通过、未启用' : '待测试'}`,
          `七函数进度：${completedCount}/7`,
        ].join('\n'),
      });
      return;
    }
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
  }, [completedCount, currentCode, currentProgress?.testAttempts, isZh, language, onAssistantContextChange, selectedCard, selectedCreative, selectedNode, testMessage]);

  const addCreativeFunction = () => {
    if (creativeFunctionsRef.current.length >= MAX_CREATIVE_FUNCTIONS) return;
    const current = creativeFunctionsRef.current;
    const created = createStudentCreativeFunction(current.length + 1);
    const next = [...current, created];
    persistCreativeFunctions(next);
    setActiveCreativeId(created.id);
    setSidebarCollapsed(false);
    setTestMessage('');
    void onReportKeyMoment?.({
      stage: 'build',
      eventType: 'structure_change',
      detail: { action: 'creative_add', cardId: created.id, hook: created.hook },
      artifacts: [creativeCodeArtifact(created, 'structure_edit', 'creative function added')],
    });
  };

  const updateCreativeFunction = (cardId: string, update: Partial<StudentCreativeFunction>) => {
    const now = new Date().toISOString();
    persistCreativeFunctions(creativeFunctionsRef.current.map(card => (
      card.id === cardId ? { ...card, ...update, updatedAt: now } : card
    )));
  };

  const updateCreativeCode = (code: string) => {
    if (!selectedCreative) return;
    if (code.length > MAX_CREATIVE_CODE_CHARS) {
      setTestMessage(isZh ? '单张创意卡最多保存 12000 个字符。' : 'A creative card can store up to 12,000 characters.');
      return;
    }
    updateCreativeFunction(selectedCreative.id, {
      code,
      enabled: false,
      verified: false,
      lastRuntimeError: undefined,
    });
    setTestMessage('');
  };

  const verifyCreativeFunction = async () => {
    if (!selectedCreative || testRunning) return;
    setTestRunning(true);
    setTestMessage(isZh ? '正在浏览器内检查创意函数与受控状态契约。' : 'Checking the creative function against the controlled state contract.');
    try {
      const result = await runPythonCreativeTest(selectedCreative.code, selectedCreative.hook);
      const now = new Date().toISOString();
      const attempt = {
        id: createRequestId(), passed: result.passed, resultCode: result.resultCode,
        durationMs: result.durationMs, createdAt: now,
      };
      const nextCard: StudentCreativeFunction = {
        ...selectedCreative,
        enabled: result.passed ? selectedCreative.enabled : false,
        verified: result.passed,
        updatedAt: now,
        lastRuntimeError: undefined,
        testAttempts: [...(selectedCreative.testAttempts ?? []).slice(-11), attempt],
      };
      persistCreativeFunctions(creativeFunctionsRef.current.map(card => card.id === nextCard.id ? nextCard : card));
      setTestMessage(result.passed
        ? (isZh ? '创意函数通过安全检查；你可以决定是否启用。' : 'The creative function passed its safety check. You can now choose whether to enable it.')
        : formatPythonModuleTestResult(result, language));
      void onReportKeyMoment?.({
        stage: 'build',
        eventType: 'module_test',
        detail: {
          unitId: creativeUnitId(nextCard.id), cardId: nextCard.id, creative: true,
          hook: nextCard.hook, attemptId: attempt.id, passed: result.passed,
          resultCode: result.resultCode, durationMs: result.durationMs,
        },
        artifacts: [creativeCodeArtifact(nextCard, 'structure_edit', result.passed ? undefined : `test failed: ${result.resultCode}`)],
      });
    } catch (error) {
      setTestMessage(formatPythonRunnerError(error, language));
    } finally {
      setTestRunning(false);
    }
  };

  const toggleCreativeFunction = (card: StudentCreativeFunction) => {
    if (!card.verified) return;
    const nextCard = { ...card, enabled: !card.enabled, lastRuntimeError: undefined, updatedAt: new Date().toISOString() };
    persistCreativeFunctions(creativeFunctionsRef.current.map(item => item.id === card.id ? nextCard : item));
    void onReportKeyMoment?.({
      stage: 'build',
      eventType: 'structure_change',
      detail: { action: nextCard.enabled ? 'creative_enable' : 'creative_disable', cardId: card.id, hook: card.hook },
      artifacts: [creativeCodeArtifact(nextCard, 'structure_edit', nextCard.enabled ? 'creative function enabled' : 'creative function disabled')],
    });
  };

  const deleteCreativeFunction = (card: StudentCreativeFunction) => {
    const confirmed = window.confirm(isZh ? `删除创意功能“${card.title}”？` : `Delete “${card.title}”?`);
    if (!confirmed) return;
    persistCreativeFunctions(creativeFunctionsRef.current.filter(item => item.id !== card.id));
    if (activeCreativeId === card.id) setActiveCreativeId(null);
    void onReportKeyMoment?.({
      stage: 'build',
      eventType: 'structure_change',
      detail: { action: 'creative_delete', cardId: card.id, hook: card.hook },
      artifacts: [creativeCodeArtifact(card, 'structure_edit', 'creative function deleted', true)],
    });
  };

  const handleCreativeRuntimeErrors = useCallback((errors: PythonCreativeHookError[]) => {
    if (errors.length === 0) return;
    const byId = new Map(errors.map(error => [error.cardId, error]));
    const next = creativeFunctionsRef.current.map(card => {
      const error = byId.get(card.id);
      return error ? {
        ...card,
        enabled: false,
        lastRuntimeError: error.resultCode,
        updatedAt: new Date().toISOString(),
      } : card;
    });
    persistCreativeFunctions(next);
    const failedCards = errors.flatMap(error => {
      const card = next.find(item => item.id === error.cardId);
      return card ? [{ card, error }] : [];
    });
    if (failedCards.length > 0) {
      void onReportKeyMoment?.({
        stage: 'build',
        eventType: 'module_test',
        detail: {
          creative: true,
          runtime: true,
          passed: false,
          failures: failedCards.map(({ card, error }) => ({
            unitId: creativeUnitId(card.id), cardId: card.id,
            hook: card.hook, resultCode: error.resultCode,
          })),
        },
        artifacts: failedCards.map(({ card, error }) => (
          creativeCodeArtifact(card, 'test_revision', `runtime isolated: ${error.resultCode}`)
        )),
      });
    }
  }, [onReportKeyMoment, persistCreativeFunctions]);

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

  const reviseEarlierStage = async (stage: 'observe' | 'decompose' | 'model') => {
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
            creativeFunctions={creativeRuntimeFunctions}
            diagnosticRun={diagnosticRun}
            demonstration={demonstration}
            onDiagnostic={setDiagnostics}
            onCreativeRuntimeErrors={handleCreativeRuntimeErrors}
          />
          <section className="integration-diagnostics">
            <header>
              <div><TestTube2 size={16} /><strong>{isZh ? '整体检查' : 'Game check'}</strong></div>
              <button type="button" onClick={() => setDiagnosticRun(value => value + 1)}>{isZh ? '检查游戏' : 'Check game'}</button>
            </header>
            {diagnosticRun > 0 && (diagnostics.length === 0 ? (
              <p className="is-success"><CheckCircle2 size={15} />{isZh ? '七个基础函数都已通过并接入同一个运行器。' : 'All seven functions passed and share one runner.'}</p>
            ) : (
              <ul>{diagnostics.map(item => <li key={item}><CircleAlert size={14} />{item}</li>)}</ul>
            ))}
          </section>
        </div>

        <div className="build-editor-column">
          <div className={`build-editor-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
            <aside className="build-function-sidebar">
              <header>
                <div><strong>{isZh ? '函数卡' : 'Functions'}</strong></div>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(value => !value)}
                  aria-label={sidebarCollapsed ? (isZh ? '展开函数卡侧栏' : 'Expand function sidebar') : (isZh ? '收起函数卡侧栏' : 'Collapse function sidebar')}
                  title={sidebarCollapsed ? (isZh ? '展开函数卡' : 'Expand functions') : (isZh ? '收起函数卡' : 'Collapse functions')}
                >
                  {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                </button>
              </header>

              <nav className="student-module-sidebar" aria-label={isZh ? '七个基础函数' : 'Seven core functions'}>
                {SNAKE_BUILD_FUNCTIONS.map((node, index) => {
                  const verified = Boolean(resolveProgress(progress, node.id)?.verified);
                  const title = isZh ? node.titleZh : node.titleEn;
                  return (
                    <button key={node.id} type="button" title={sidebarCollapsed ? `${String(index + 1).padStart(2, '0')} ${title}` : undefined} aria-label={`${String(index + 1).padStart(2, '0')} ${title}`} className={`${!selectedCreative && selectedNode.id === node.id ? 'is-active' : ''} ${verified ? 'is-verified' : ''}`} onClick={() => { setActiveCreativeId(null); setSelectedNodeId(node.id); setTestMessage(''); setContextOpen(false); }}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <p>{title}<small>{node.signature}</small></p>
                      <i>{verified ? <Check size={14} /> : <CircleDot size={14} />}</i>
                    </button>
                  );
                })}
              </nav>

              <section className="build-creative-sidebar">
                <header>
                  <div><strong>{isZh ? '创意卡' : 'Creative'}</strong></div>
                  <button type="button" onClick={addCreativeFunction} disabled={creativeFunctions.length >= MAX_CREATIVE_FUNCTIONS} aria-label={isZh ? '添加创意卡' : 'Add creative card'} title={isZh ? '添加创意卡' : 'Add creative card'}><Plus size={14} /></button>
                </header>
                {creativeFunctions.length > 0 ? (
                  <nav aria-label={isZh ? '创意功能卡' : 'Creative function cards'}>
                    {creativeFunctions.map((card, index) => (
                      <button key={card.id} type="button" title={sidebarCollapsed ? card.title : undefined} aria-label={card.title} className={`${selectedCreative?.id === card.id ? 'is-active' : ''} ${card.enabled ? 'is-enabled' : ''}`} onClick={() => { setActiveCreativeId(card.id); setTestMessage(''); setContextOpen(false); }}>
                        <span className="creative-card-index">C{index + 1}</span>
                        <p><strong>{card.title}</strong><small>{card.enabled ? (isZh ? '运行中' : 'Enabled') : card.verified ? (isZh ? '已测试' : 'Tested') : (isZh ? '待测试' : 'To test')}</small></p>
                        <i className="creative-card-state"><Power size={13} /></i>
                      </button>
                    ))}
                  </nav>
                ) : <p>{isZh ? '点击 + 添加' : 'Press + to add'}</p>}
              </section>
            </aside>

            <div className="build-editor-pane">
            {selectedCreative ? (
            <article className="module-editor-card creative-editor-card">
              <header className="creative-editor-header">
                <input aria-label={isZh ? '创意功能名称' : 'Creative function name'} placeholder={isZh ? '给这个创意命名' : 'Name this idea'} maxLength={60} value={selectedCreative.title} onChange={event => updateCreativeFunction(selectedCreative.id, { title: event.target.value })} />
                <div className="creative-editor-status">
                  <span className={selectedCreative.enabled ? 'is-complete' : ''}>{selectedCreative.enabled ? (isZh ? '运行中' : 'ENABLED') : selectedCreative.verified ? (isZh ? '已测试' : 'TESTED') : (isZh ? '待测试' : 'TO TEST')}</span>
                  <button type="button" onClick={() => deleteCreativeFunction(selectedCreative)} aria-label={isZh ? '删除创意卡' : 'Delete creative card'} title={isZh ? '删除创意卡' : 'Delete creative card'}><Trash2 size={16} /></button>
                </div>
              </header>

              {selectedCreative.lastRuntimeError ? (
                <div className="creative-runtime-isolated" role="alert"><CircleAlert size={15} />{isZh ? `运行异常已隔离并自动停用：${selectedCreative.lastRuntimeError}` : `Runtime error isolated; card disabled: ${selectedCreative.lastRuntimeError}`}</div>
              ) : null}

              <div className="module-code-header"><div><Code2 size={15} /><span>def creative_feature(event, state):</span></div></div>
              <div className="module-code-editor">
                <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
                  <ResearchCodeEditor value={selectedCreative.code} onChange={updateCreativeCode} language="python" theme={theme} />
                </React.Suspense>
              </div>
              <footer className="module-test-bar creative-test-bar">
                <span>{testMessage || (isZh ? '从空白模板开始，也可以先向 AI 描述你的创意。' : 'Start from the blank template, or describe your idea to AI first.')}</span>
                <div className="creative-test-actions">
                  <button type="button" className={`creative-enable-button ${selectedCreative.enabled ? 'is-on' : ''}`} onClick={() => toggleCreativeFunction(selectedCreative)} disabled={!selectedCreative.verified}><Power size={15} />{selectedCreative.enabled ? (isZh ? '停用' : 'Disable') : (isZh ? '启用' : 'Enable')}</button>
                  <button type="button" onClick={() => void verifyCreativeFunction()} disabled={testRunning}>
                    {testRunning ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
                    {testRunning ? (isZh ? '正在运行' : 'Running') : (isZh ? '测试创意' : 'Test idea')}
                  </button>
                </div>
              </footer>
            </article>
          ) : (
          <article className="module-editor-card">
            <header>
              <div>
                <h4>{isZh ? selectedNode.titleZh : selectedNode.titleEn}</h4>
                {selectedCard ? <small>{selectedCard.responsibility}</small> : null}
              </div>
              <span className={currentProgress?.verified ? 'is-complete' : ''}>{currentProgress?.verified ? (isZh ? '已接入' : 'CONNECTED') : (isZh ? '待接入' : 'TO CONNECT')}</span>
            </header>

            <button type="button" className="module-context-toggle" aria-expanded={contextOpen} onClick={() => setContextOpen(value => !value)}>
              <span>{contextOpen ? (isZh ? '收起功能依据' : 'Hide function context') : (isZh ? '查看功能依据' : 'View function context')}</span>
              {contextOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {contextOpen ? (
              <div className="module-contract-grid">
                <div><strong>{isZh ? '运行观察' : 'Observation'}</strong><span>{selectedCard?.observationText || (isZh ? '回看左侧游戏，定位这个函数对应的变化。' : 'Use the game on the left to locate this function’s change.')}</span></div>
                <div><strong>{isZh ? '实现描述' : 'Implementation'}</strong><span>{selectedCard?.implementation || (isZh ? '可以先编码，再回去修订功能卡。' : 'You can code first and revise the function card later.')}</span></div>
              </div>
            ) : null}

            <div className="module-code-header"><div><Code2 size={15} /><span>{selectedNode.signature}</span></div><div><span>{isZh ? '浏览器本地运行' : 'LOCAL IN BROWSER'}</span></div></div>
            <div className="module-code-editor">
              <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
                <ResearchCodeEditor value={currentCode} onChange={updateCode} language="python" theme={theme} />
              </React.Suspense>
            </div>
            <footer className="module-test-bar">
              <span>{testMessage || (isZh ? '修改后先测试；通过的版本才会替换左侧游戏。' : 'Test after editing. Only a passing version replaces the game on the left.')}</span>
              <button type="button" onClick={() => void verifyCurrentModule()} disabled={testRunning}>
                {testRunning ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
                {testRunning ? (isZh ? '正在运行' : 'Running') : (isZh ? '测试并接入游戏' : 'Test and connect')}
              </button>
            </footer>
          </article>
            )}
            </div>
          </div>
        </div>
      </div>

      {lastFailedUnitId && (
        <div className="build-revision-prompt" role="status">
          <strong>{isZh ? '测试未通过，要回看哪一步？' : 'Test failed. Which step do you want to revisit?'}</strong>
          {revisionError ? <p className="build-revision-error" role="alert">{revisionError}</p> : null}
          <div className="build-revision-actions">
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('observe')}>{revisingStage === 'observe' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '补充观察' : 'Revise observations')}</button>
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('decompose')}>{revisingStage === 'decompose' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '修订功能卡' : 'Revise function cards')}</button>
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('model')}>{revisingStage === 'model' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '修订功能流程' : 'Revise function flow')}</button>
            <button type="button" disabled={revisingStage !== null} onClick={() => { setRevisionError(''); setLastFailedUnitId(null); }}>{isZh ? '继续在这里改' : 'Keep editing here'}</button>
          </div>
        </div>
      )}

      <footer className="build-workspace-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能流程' : 'Back to function flows'}</button>
        <button type="button" className="build-final-submit" onClick={() => {
          if (creativeFunctions.length === 0) addCreativeFunction();
          else setActiveCreativeId(creativeFunctions[0].id);
        }}>
          {creativeFunctions.length > 0 ? (isZh ? '继续创意扩展' : 'Continue creative work') : (isZh ? '开始创意扩展' : 'Start creative work')}
        </button>
      </footer>
    </section>
  );
};
