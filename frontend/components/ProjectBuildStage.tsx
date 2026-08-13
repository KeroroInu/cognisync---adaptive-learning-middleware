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
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Play,
  RotateCcw,
  TestTube2,
} from 'lucide-react';
import type { Language } from '../types';
import {
  createInitialPathPlan,
  getImplementationOrderIds,
  inferBlueprintNode,
  readStoredList,
  readStoredObject,
  type StudentModuleProgress,
  type StudentPathPlan,
} from '../data/projectPath';
import {
  disposePythonModuleRunner,
  formatPythonModuleTestResult,
  formatPythonRunnerError,
  runPythonModuleTest,
  type PythonModulePreview,
} from '../services/pythonModuleRunner';
import type { StudentObservationCard } from './ProjectFactory';
import type { StudentFunctionCard } from './ProjectFunctionStage';
import './ProjectBuildStage.css';

const ResearchCodeEditor = React.lazy(() => import('./ResearchCodeEditor'));

interface Props {
  language: Language;
  theme: 'light' | 'dark';
  taskId: string;
  onBack: () => void;
}

type Direction = 'up' | 'down' | 'left' | 'right';
interface Cell { x: number; y: number }

const BOARD_COLUMNS = 14;
const BOARD_ROWS = 10;
const INITIAL_SNAKE: Cell[] = [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }];
const INITIAL_FOOD: Cell = { x: 10, y: 5 };
const DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const KEY_DIRECTIONS: Record<string, Direction | undefined> = {
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
};

const MODULE_TEMPLATES: Record<string, string> = {
  'initial-state': `def create_initial_state():\n    # 创建蛇身列表、方向和初始得分\n    # TODO: 返回这三项初始状态\n    pass`,
  'direction-input': `def change_direction(current_direction, next_direction):\n    # 如果新方向与当前方向相反，保持原方向\n    # TODO: 用条件判断完成方向更新\n    pass`,
  movement: `def move_snake(snake, direction):\n    # 1. 根据方向计算新蛇头坐标\n    # 2. 把新蛇头加入列表，再移除蛇尾\n    # TODO: 返回更新后的蛇身\n    pass`,
  'food-spawn': `def spawn_food(snake, board_size):\n    # 在网格内选择一个不与蛇身重合的坐标\n    # TODO: 循环检查候选坐标，并返回合法食物位置\n    pass`,
  'eat-grow-score': `def apply_food_effect(snake, food, score):\n    # 判断蛇头是否到达食物位置\n    # TODO: 吃到时更新蛇身和得分，否则保持原状态\n    pass`,
  collision: `def check_collision(snake, board_size):\n    # 检查蛇头是否超出边界，或者与蛇身重合\n    # TODO: 返回 True 或 False\n    pass`,
  'game-loop': `# 平台已锁定提供：游戏循环、画面绘制和键盘事件\n# 你的功能模块会按关系图装配到这个循环中。`,
};

const FRAMEWORK_NODE_IDS = new Set(['game-loop']);

interface SnakeBuildPreviewProps {
  language: Language;
  capabilities: Set<string>;
  checkpointIndex: number;
  checkpointTotal: number;
  diagnosticRun: number;
  demonstration: { nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null;
  onDiagnostic: (messages: string[]) => void;
}

const SnakeBuildPreview: React.FC<SnakeBuildPreviewProps> = ({
  language,
  capabilities,
  checkpointIndex,
  checkpointTotal,
  diagnosticRun,
  demonstration,
  onDiagnostic,
}) => {
  const isZh = language === 'zh';
  const [snake, setSnake] = useState<Cell[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Cell>(INITIAL_FOOD);
  const [direction, setDirection] = useState<Direction>('right');
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [score, setScore] = useState(0);
  const snakeRef = useRef(snake);
  const foodRef = useRef(food);
  const directionRef = useRef(direction);
  const boardRef = useRef<HTMLDivElement>(null);

  const has = useCallback((id: string) => capabilities.has(id), [capabilities]);
  const tickMs = Math.max(170, 340 - Math.floor(score / 20) * 25);
  const speedLabel = (340 / tickMs).toFixed(1);

  const reset = useCallback(() => {
    snakeRef.current = INITIAL_SNAKE;
    foodRef.current = INITIAL_FOOD;
    directionRef.current = 'right';
    setSnake(INITIAL_SNAKE);
    setFood(INITIAL_FOOD);
    setDirection('right');
    setScore(0);
    setRunning(false);
    setOver(false);
  }, []);

  useEffect(() => {
    reset();
  }, [capabilities, reset]);

  useEffect(() => {
    if (!demonstration) return;
    reset();
    const preview = demonstration.preview;
    if (!preview) return;
    if (preview.snake?.length) {
      const nextSnake = preview.snake
        .filter(point => point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([x, y]) => ({ x, y }));
      if (nextSnake.length) {
        snakeRef.current = nextSnake;
        setSnake(nextSnake);
      }
    }
    if (preview.food?.length === 2 && Number.isFinite(preview.food[0]) && Number.isFinite(preview.food[1])) {
      const nextFood = { x: preview.food[0], y: preview.food[1] };
      foodRef.current = nextFood;
      setFood(nextFood);
    }
    if (preview.direction) {
      directionRef.current = preview.direction;
      setDirection(preview.direction);
    }
    if (Number.isFinite(preview.score)) setScore(preview.score ?? 0);
    if (preview.over) setOver(true);
  }, [demonstration, reset]);

  useEffect(() => {
    if (!running || over || !has('movement')) return undefined;
    const timer = window.setInterval(() => {
      const current = snakeRef.current;
      const head = current[0];
      const delta = DELTA[directionRef.current];
      let next = { x: head.x + delta.x, y: head.y + delta.y };
      const boundary = next.x < 0 || next.x >= BOARD_COLUMNS || next.y < 0 || next.y >= BOARD_ROWS;
      const self = current.slice(0, -1).some(cell => cell.x === next.x && cell.y === next.y);

      if (has('collision') && (boundary || self)) {
        setOver(true);
        setRunning(false);
        return;
      }

      if (boundary && !has('collision')) {
        next = {
          x: (next.x + BOARD_COLUMNS) % BOARD_COLUMNS,
          y: (next.y + BOARD_ROWS) % BOARD_ROWS,
        };
      }

      const ate = has('food-spawn') && next.x === foodRef.current.x && next.y === foodRef.current.y;
      const grows = ate && has('eat-grow-score');
      const nextSnake = grows ? [next, ...current] : [next, ...current.slice(0, -1)];
      if (grows) {
        setScore(value => value + 10);
        const nextFood = foodRef.current.x > 6 ? { x: 3, y: 2 } : { x: 10, y: 7 };
        foodRef.current = nextFood;
        setFood(nextFood);
      }
      snakeRef.current = nextSnake;
      setSnake(nextSnake);
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [has, over, running, tickMs]);

  useEffect(() => {
    if (diagnosticRun === 0) return;
    const missing: string[] = [];
    if (!has('initial-state')) missing.push(isZh ? '重置后初始状态还没有被完整定义' : 'Initial state is incomplete after reset');
    if (!has('direction-input')) missing.push(isZh ? '按键后运动方向没有改变' : 'Key presses do not change direction');
    if (!has('movement')) missing.push(isZh ? '开始后蛇的位置没有更新' : 'The snake does not move after Start');
    if (!has('food-spawn')) missing.push(isZh ? '网格中没有出现可吃的果实' : 'No food appears on the board');
    if (!has('eat-grow-score')) missing.push(isZh ? '蛇头接触果实后，长度和得分没有变化' : 'Length and score do not change after reaching food');
    if (!has('collision')) missing.push(isZh ? '蛇越过边界后仍在继续运行' : 'The snake continues after crossing the boundary');
    onDiagnostic(missing);
  }, [diagnosticRun, has, isZh, onDiagnostic]);

  const changeDirection = useCallback((next: Direction) => {
    if (!has('direction-input') || OPPOSITE[directionRef.current] === next) return;
    directionRef.current = next;
    setDirection(next);
    boardRef.current?.focus({ preventScroll: true });
  }, [has]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing = target instanceof HTMLElement && (
        target.isContentEditable
        || Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor'))
      );
      if (isEditing) return;

      const nextDirection = KEY_DIRECTIONS[event.key];
      if (!nextDirection || !has('direction-input')) return;
      event.preventDefault();
      changeDirection(nextDirection);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeDirection, has]);

  const cells = useMemo(() => new Map(snake.map((cell, index) => [`${cell.x}:${cell.y}`, index])), [snake]);

  return (
    <section className="construction-preview">
      <header className="construction-titlebar">
        <div className="construction-title">
          <span><Gamepad2 size={15} />SNAKE_BUILD / CURRENT</span>
          <h3>{isZh ? `贪吃蛇 · 当前版本 ${String(checkpointIndex).padStart(2, '0')}` : `Snake · Current build ${checkpointIndex}`}</h3>
        </div>
        <div className="construction-status-stack">
          <small>{checkpointIndex}/{checkpointTotal}</small>
          <span className={running ? 'is-running' : ''}><i />{over ? (isZh ? '已碰撞' : 'COLLISION') : running ? (isZh ? '运行中' : 'RUNNING') : (isZh ? '当前版本' : 'CURRENT BUILD')}</span>
        </div>
      </header>
      <div className="construction-scorebar">
        <div><small>{isZh ? '得分' : 'SCORE'}</small><strong>{String(score).padStart(3, '0')}</strong></div>
        <div><small>{isZh ? '速度' : 'SPEED'}</small><strong>{speedLabel}<i>×</i></strong></div>
        <div><small>{isZh ? '已实现' : 'BUILT'}</small><strong>{capabilities.size - 1}<i>/6</i></strong></div>
        <div><small>{isZh ? '方向' : 'DIRECTION'}</small><strong>{direction.toUpperCase()}</strong></div>
      </div>
      {demonstration && (
        <div className="construction-behavior-feedback" key={`${demonstration.nodeId}-${demonstration.run}`}>
          <CheckCircle2 size={14} />
          <span>{isZh ? '刚刚通过代码测试并装配' : 'Just tested and assembled'}</span>
          <strong>{demonstration.label}</strong>
        </div>
      )}
      <div
        ref={boardRef}
        className="construction-board"
        style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${BOARD_ROWS}, 1fr)` }}
        role="application"
        tabIndex={0}
        onPointerDown={() => boardRef.current?.focus({ preventScroll: true })}
        aria-label={isZh ? '贪吃蛇当前版本，点击后可使用方向键或 WASD 控制' : 'Current snake build. Click, then use arrow keys or WASD'}
      >
        {Array.from({ length: BOARD_COLUMNS * BOARD_ROWS }, (_, index) => {
          const x = index % BOARD_COLUMNS;
          const y = Math.floor(index / BOARD_COLUMNS);
          const snakeIndex = cells.get(`${x}:${y}`);
          const isFood = has('food-spawn') && food.x === x && food.y === y;
          const hasInitialState = has('initial-state');
          return <span key={index} className={`${hasInitialState && snakeIndex !== undefined ? 'is-snake' : ''} ${hasInitialState && snakeIndex === 0 ? 'is-head' : ''} ${isFood ? 'is-food' : ''}`} />;
        })}
        {over && <div className="construction-over"><strong>{isZh ? '碰撞检测生效' : 'Collision detected'}</strong><button type="button" onClick={reset}>{isZh ? '重新运行' : 'Reset'}</button></div>}
      </div>
      <div className="construction-controls">
        <div className="construction-dpad">
          <button type="button" className="is-up" onClick={() => changeDirection('up')} disabled={!has('direction-input')}><ArrowUp size={17} /></button>
          <button type="button" className="is-left" onClick={() => changeDirection('left')} disabled={!has('direction-input')}><ArrowLeft size={17} /></button>
          <button type="button" className="is-right" onClick={() => changeDirection('right')} disabled={!has('direction-input')}><ArrowRight size={17} /></button>
          <button type="button" className="is-down" onClick={() => changeDirection('down')} disabled={!has('direction-input')}><ArrowDown size={17} /></button>
        </div>
        <button type="button" className="construction-run" onClick={() => setRunning(value => !value)} disabled={!has('movement') || over}>
          <Play size={16} />{running ? (isZh ? '暂停' : 'Pause') : (isZh ? '运行当前版本' : 'Run current build')}
        </button>
        <button type="button" className="construction-reset" onClick={reset} disabled={!has('initial-state')}><RotateCcw size={16} />{isZh ? '重置' : 'Reset'}</button>
      </div>
      <p className="construction-keyboard-hint">
        {isZh ? '点击棋盘后，可用方向键或 WASD 控制' : 'Click the board, then use arrow keys or WASD'}
      </p>
    </section>
  );
};

export const ProjectBuildStage: React.FC<Props> = ({ language, theme, taskId, onBack }) => {
  const isZh = language === 'zh';
  const functionKey = `cognisync:project-function-cards:v1:${taskId}`;
  const observationKey = `cognisync:project-observation-cards:v2:${taskId}`;
  const pathKey = `cognisync:project-path-plan:v1:${taskId}`;
  const progressKey = `cognisync:project-module-progress:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationKey));
  const [plan] = useState<StudentPathPlan>(() => readStoredObject(pathKey, createInitialPathPlan(readStoredList(functionKey))));
  const [progress, setProgress] = useState<Record<string, StudentModuleProgress>>(() => readStoredObject(progressKey, {}));
  const plannedCardIds = useMemo(() => getImplementationOrderIds(cards, plan), [cards, plan]);
  const [selectedId, setSelectedId] = useState(() => plannedCardIds[0] ?? '');
  const [testMessage, setTestMessage] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [diagnosticRun, setDiagnosticRun] = useState(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [demonstration, setDemonstration] = useState<{ nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null>(null);

  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const orderedCards = useMemo(
    () => plannedCardIds.map(id => cardsById.get(id)).filter((card): card is StudentFunctionCard => Boolean(card)),
    [cardsById, plannedCardIds],
  );
  const selectedCard = cardsById.get(selectedId) ?? orderedCards[0];
  const selectedNode = selectedCard ? inferBlueprintNode(selectedCard, observations) : undefined;

  useEffect(() => {
    window.localStorage.setItem(progressKey, JSON.stringify(progress));
  }, [progress, progressKey]);

  useEffect(() => () => disposePythonModuleRunner(), []);

  useEffect(() => {
    if (!plannedCardIds.includes(selectedId)) setSelectedId(plannedCardIds[0] ?? '');
  }, [plannedCardIds, selectedId]);

  const selectedCheckpointIndex = Math.max(0, orderedCards.findIndex(card => card.id === selectedCard?.id));
  const checkpointCapabilities = useMemo(() => {
    const ids = new Set<string>(FRAMEWORK_NODE_IDS);
    orderedCards.slice(0, selectedCheckpointIndex + 1).forEach(card => {
      const item = progress[card.id];
      if (item?.verified) ids.add(item.blueprintNodeId);
    });
    return ids;
  }, [orderedCards, progress, selectedCheckpointIndex]);

  const dependencyReady = (cardId: string) => (plan.prerequisites[cardId] ?? []).every(id => progress[id]?.verified);
  const currentProgress = selectedCard ? progress[selectedCard.id] : undefined;
  const completedCardCount = orderedCards.reduce((count, card) => {
    const node = inferBlueprintNode(card, observations);
    return count + (FRAMEWORK_NODE_IDS.has(node.id) || progress[card.id]?.verified ? 1 : 0);
  }, 0);
  const currentCode = selectedNode && selectedCard
    ? currentProgress?.code ?? MODULE_TEMPLATES[selectedNode.id] ?? selectedNode.functionTemplate
    : '';

  const dependentCardIds = (cardId: string) => {
    const dependents = new Set<string>();
    const queue = [cardId];
    while (queue.length > 0) {
      const dependencyId = queue.shift();
      if (!dependencyId) continue;
      orderedCards.forEach(card => {
        if (dependents.has(card.id) || !(plan.prerequisites[card.id] ?? []).includes(dependencyId)) return;
        dependents.add(card.id);
        queue.push(card.id);
      });
    }
    return dependents;
  };

  const updateCode = (code: string) => {
    if (!selectedCard || !selectedNode || FRAMEWORK_NODE_IDS.has(selectedNode.id)) return;
    const invalidatedIds = dependentCardIds(selectedCard.id);
    setProgress(current => {
      const next = { ...current };
      invalidatedIds.forEach(cardId => {
        if (next[cardId]) next[cardId] = { ...next[cardId], verified: false };
      });
      next[selectedCard.id] = {
        ...current[selectedCard.id],
        cardId: selectedCard.id,
        blueprintNodeId: selectedNode.id,
        code,
        verified: false,
        updatedAt: new Date().toISOString(),
      };
      return next;
    });
    setTestMessage('');
    setDemonstration(null);
  };

  const verifyCurrentModule = async () => {
    if (!selectedCard || !selectedNode || testRunning) return;
    if (!dependencyReady(selectedCard.id)) {
      setTestMessage(isZh ? '前置功能还没有通过测试，请先按你的路径完成它们。' : 'Complete the prerequisites in your route first.');
      return;
    }
    if (FRAMEWORK_NODE_IDS.has(selectedNode.id)) {
      setTestMessage(isZh ? '该部分由平台提供，已接入装配器。' : 'This part is provided by the platform and already connected.');
      return;
    }
    setTestRunning(true);
    setTestMessage(isZh ? '正在真实运行当前 Python 函数；首次使用需要加载测试环境。' : 'Running the Python function. The first test needs to load the runtime.');
    try {
      const result = await runPythonModuleTest(selectedNode.id, currentCode);
      const now = new Date().toISOString();
      setProgress(current => {
        const previous = current[selectedCard.id];
        return {
          ...current,
          [selectedCard.id]: {
            ...previous,
            cardId: selectedCard.id,
            blueprintNodeId: selectedNode.id,
            code: currentCode,
            verified: result.passed,
            updatedAt: now,
            testAttempts: [...(previous?.testAttempts ?? []).slice(-11), {
              id: `attempt-${Date.now()}`,
              passed: result.passed,
              resultCode: result.resultCode,
              durationMs: result.durationMs,
              createdAt: now,
            }],
          },
        };
      });
      setTestMessage(formatPythonModuleTestResult(result, language));
      if (result.passed) {
        setDemonstration(current => ({
          nodeId: selectedNode.id,
          run: (current?.run ?? 0) + 1,
          label: isZh ? selectedNode.visualizationUnlockZh : selectedNode.visualizationUnlockEn,
          preview: result.preview,
        }));
      } else {
        setDemonstration(null);
      }
    } catch (error) {
      setTestMessage(formatPythonRunnerError(error, language));
    } finally {
      setTestRunning(false);
    }
  };

  const runIntegration = () => {
    setDiagnosticRun(value => value + 1);
  };

  if (orderedCards.length === 0) {
    return (
      <section className="project-build-workspace is-empty">
        <Layers3 size={35} />
        <h3>{isZh ? '没有可装配的学生功能卡' : 'No student modules to assemble'}</h3>
        <p>{isZh ? '建构区不会自动生成标准答案。请先完成观察、功能卡和关系规划。' : 'The build area does not generate the answer. Complete observations, function cards and relations first.'}</p>
        <button type="button" onClick={onBack}>{isZh ? '返回实现规划' : 'Back to plan'}</button>
      </section>
    );
  }

  return (
    <section className="project-build-workspace">
      <div className="build-workspace-main">
        <div className="build-preview-column">
          <SnakeBuildPreview
            language={language}
            capabilities={checkpointCapabilities}
            checkpointIndex={selectedCheckpointIndex + 1}
            checkpointTotal={orderedCards.length}
            diagnosticRun={diagnosticRun}
            demonstration={demonstration}
            onDiagnostic={setDiagnostics}
          />
          <section className="integration-diagnostics">
            <header>
              <div><TestTube2 size={16} /><strong>{isZh ? '综合行为测试' : 'INTEGRATION TEST'}</strong></div>
              <button type="button" onClick={runIntegration}>{isZh ? '检查当前游戏' : 'Test current game'}</button>
            </header>
            {diagnosticRun === 0 ? (
              <p>{isZh ? '完成若干模块后再检查。系统只报告可观察的异常，不直接告诉你遗漏了哪张卡。' : 'Test after assembling modules. The system reports observable problems, not missing answer cards.'}</p>
            ) : diagnostics.length === 0 ? (
              <p className="is-success"><CheckCircle2 size={15} />{isZh ? '当前六类核心行为均已在学生路径中实现。' : 'All six core behaviours are represented in the student route.'}</p>
            ) : (
              <ul>{diagnostics.map(item => <li key={item}><CircleAlert size={14} />{item}</li>)}</ul>
            )}
          </section>
        </div>

        <div className="build-editor-column">
          <header className="build-editor-heading">
            <div><span>05 / BUILD & VERIFY</span><h3>{isZh ? '按自己的路径逐个实现' : 'Build one module at a time'}</h3></div>
            <strong>{completedCardCount}<small>/{orderedCards.length}</small></strong>
          </header>

          <nav className="student-module-rail" aria-label={isZh ? '学生实现路径' : 'Student build route'}>
            {orderedCards.map((card, index) => {
              const node = inferBlueprintNode(card, observations);
              const provided = FRAMEWORK_NODE_IDS.has(node.id);
              const verified = provided || progress[card.id]?.verified;
              const ready = dependencyReady(card.id);
              return (
                <button key={card.id} type="button" className={`${selectedCard?.id === card.id ? 'is-active' : ''} ${verified ? 'is-verified' : ''}`} onClick={() => { setSelectedId(card.id); setTestMessage(''); }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{card.responsibility}</p>
                  <i>{verified ? <Check size={14} /> : ready ? <CircleDot size={14} /> : <LockKeyhole size={14} />}</i>
                </button>
              );
            })}
          </nav>

          {selectedCard && selectedNode && (
            <article className="module-editor-card">
              <header>
                <div>
                  <span>{isZh ? '来自你的功能卡' : 'FROM YOUR FUNCTION CARD'}</span>
                  <h4>{selectedCard.responsibility}</h4>
                </div>
                <span className={currentProgress?.verified || FRAMEWORK_NODE_IDS.has(selectedNode.id) ? 'is-complete' : ''}>
                  {FRAMEWORK_NODE_IDS.has(selectedNode.id) ? (isZh ? '平台提供' : 'PROVIDED') : currentProgress?.verified ? (isZh ? '已验证' : 'VERIFIED') : (isZh ? '待实现' : 'TO BUILD')}
                </span>
              </header>

              <div className="module-contract-grid">
                <div><small>OBSERVE</small><span>{selectedCard.observationText}</span></div>
                <div><small>IN</small><span>{selectedCard.input}</span></div>
                <div><small>OUT</small><span>{selectedCard.output}</span></div>
                <div><small>{isZh ? '验证' : 'VERIFY'}</small><span>{selectedCard.verification}</span></div>
              </div>

              <div className="module-code-header">
                <div><Code2 size={15} /><span>{selectedNode.functionTemplate}</span></div>
                <div>{(isZh ? selectedNode.knowledgeZh : selectedNode.knowledgeEn).map(item => <span key={item}>{item}</span>)}</div>
              </div>

              <div className="module-code-editor">
                <React.Suspense fallback={<div className="view-loading">{isZh ? '正在准备编辑器…' : 'Preparing editor…'}</div>}>
                  <ResearchCodeEditor value={currentCode} onChange={updateCode} language="python" theme={theme} />
                </React.Suspense>
              </div>

              <footer className="module-test-bar">
                <span>{testMessage || (dependencyReady(selectedCard.id) ? (isZh ? '只需完成这张卡对应的函数，其他项目代码已由平台锁定。' : 'Complete only this function; the rest of the project is locked.') : (isZh ? '它依赖的前置卡还没有通过测试。' : 'Its prerequisite cards are not verified yet.'))}</span>
                <button type="button" onClick={() => void verifyCurrentModule()} disabled={!dependencyReady(selectedCard.id) || testRunning}>
                  {testRunning ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
                  {testRunning ? (isZh ? '正在运行' : 'Running') : (isZh ? '运行模块测试' : 'Run module test')}
                </button>
              </footer>
            </article>
          )}
        </div>
      </div>

      <footer className="build-workspace-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回实现路径' : 'Back to route'}</button>
        <span>{isZh ? '一个项目页面内完成观察、规划、建构和验证' : 'Observe, plan, build and verify in one project workspace.'}</span>
      </footer>
    </section>
  );
};
