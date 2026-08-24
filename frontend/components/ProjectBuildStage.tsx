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
  Play,
  RotateCcw,
  TestTube2,
} from 'lucide-react';
import type { Language } from '../types';
import {
  getMappedBlueprintNodes,
  readStoredList,
  readStoredObject,
  type StudentModuleProgress,
} from '../data/projectPath';
import type { BlueprintNode } from '../data/snakeProjectBlueprint';
import {
  disposePythonModuleRunner,
  formatPythonModuleTestResult,
  formatPythonRunnerError,
  runPythonModuleTest,
  type PythonModulePreview,
} from '../services/pythonModuleRunner';
import type { StudentObservationCard } from './ProjectFactory';
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
  /** 上报关键教学事件。由 Research.tsx 注入，内部已处理幂等键与重试。 */
  onReportKeyMoment?: ReportKeyMoment;
  /** 测试失败后回到更早阶段修订解构结果。 */
  onReviseEarlierStage?: (stage: 'observe' | 'decompose') => void;
  onFinalSubmit?: () => void | Promise<void>;
  completing?: boolean;
  completed?: boolean;
}

export interface ProjectBuildAssistantContext {
  currentModule?: string;
  currentCode?: string;
  testFeedback?: string;
  artifactSummary: string;
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

interface StudentBuildUnit {
  id: string;
  card: StudentFunctionCard;
  node: BlueprintNode;
}

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
  const observationKey = `cognisync:project-observation-cards:v2:${taskId}`;
  const progressKey = `cognisync:project-module-progress:v1:${taskId}`;
  const [cards] = useState<StudentFunctionCard[]>(() => readStoredList(functionKey));
  const [observations] = useState<StudentObservationCard[]>(() => readStoredList(observationKey));
  const [progress, setProgress] = useState<Record<string, StudentModuleProgress>>(() => readStoredObject(progressKey, {}));
  // 新任务不再读取学生绘制的路径来决定建构顺序。功能卡自身的稳定顺序就是
  // 当前过渡工作区的顺序；教师蓝图依赖只服务测试装配和诊断，不再锁住学生。
  // 旧 path 数据仍由 workspace 快照原样保存，后续教师诊断可只读查看。
  const buildUnits = useMemo<StudentBuildUnit[]>(() => cards.flatMap(card => (
    getMappedBlueprintNodes(card, observations).map(node => ({
      id: `${card.id}::${node.id}`,
      card,
      node,
    }))
  )), [cards, observations]);
  const unmappedCards = useMemo(
    () => cards.filter(card => getMappedBlueprintNodes(card, observations).length === 0),
    [cards, observations],
  );
  const mappedCardCount = useMemo(
    () => cards.filter(card => getMappedBlueprintNodes(card, observations).length > 0).length,
    [cards, observations],
  );
  const [selectedId, setSelectedId] = useState(() => buildUnits[0]?.id ?? '');
  const [testMessage, setTestMessage] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  /**
   * 最近一次失败的模块。测试失败是「回到解构结果进行修订」的触发点
   * （见 docs/PROJECT_WORKBENCH_V02.md 第 7、30 行），此前界面只给一句
   * 文字提示，学生没有任何入口回去改功能卡或路径。
   */
  const [lastFailedUnitId, setLastFailedUnitId] = useState<string | null>(null);
  // 正在为哪个目标阶段写修订证据。非空即禁用整组按钮，避免连点产生多条事件
  // （每次点击都会生成新的 request_id，后端幂等键拦不住）。
  const [revisingStage, setRevisingStage] = useState<'observe' | 'decompose' | null>(null);
  const [revisionError, setRevisionError] = useState('');
  const [diagnosticRun, setDiagnosticRun] = useState(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [demonstration, setDemonstration] = useState<{ nodeId: string; run: number; label: string; preview?: PythonModulePreview } | null>(null);
  const selectedUnit = buildUnits.find(unit => unit.id === selectedId) ?? buildUnits[0];
  const selectedCard = selectedUnit?.card;
  const selectedNode = selectedUnit?.node;

  const progressForUnit = (unit: StudentBuildUnit | undefined) => {
    if (!unit) return undefined;
    const direct = progress[unit.id];
    if (direct) return direct;
    const legacy = progress[unit.card.id];
    return legacy?.blueprintNodeId === unit.node.id ? legacy : undefined;
  };

  const unitIsComplete = (unit: StudentBuildUnit) => (
    FRAMEWORK_NODE_IDS.has(unit.node.id) || Boolean(progressForUnit(unit)?.verified)
  );

  useEffect(() => {
    window.localStorage.setItem(progressKey, JSON.stringify(progress));
  }, [progress, progressKey]);

  useEffect(() => () => disposePythonModuleRunner(), []);

  useEffect(() => {
    if (!buildUnits.some(unit => unit.id === selectedId)) setSelectedId(buildUnits[0]?.id ?? '');
  }, [buildUnits, selectedId]);

  const selectedCheckpointIndex = Math.max(0, buildUnits.findIndex(unit => unit.id === selectedUnit?.id));
  const checkpointCapabilities = useMemo(() => {
    const ids = new Set<string>(FRAMEWORK_NODE_IDS);
    buildUnits.slice(0, selectedCheckpointIndex + 1).forEach(unit => {
      const direct = progress[unit.id];
      const legacy = progress[unit.card.id];
      const item = direct ?? (legacy?.blueprintNodeId === unit.node.id ? legacy : undefined);
      if (item?.verified || FRAMEWORK_NODE_IDS.has(unit.node.id)) ids.add(unit.node.id);
    });
    return ids;
  }, [buildUnits, progress, selectedCheckpointIndex]);

  const currentProgress = progressForUnit(selectedUnit);
  const completedCardCount = buildUnits.filter(unitIsComplete).length;
  const currentCode = selectedNode && selectedCard
    ? currentProgress?.code ?? MODULE_TEMPLATES[selectedNode.id] ?? selectedNode.functionTemplate
    : '';

  useEffect(() => {
    const latestAttempt = currentProgress?.testAttempts?.[currentProgress.testAttempts.length - 1];
    onAssistantContextChange?.({
      currentModule: selectedCard?.responsibility,
      currentCode,
      testFeedback: testMessage || (latestAttempt
        ? `${latestAttempt.passed ? 'passed' : 'failed'} · ${latestAttempt.resultCode}`
        : undefined),
      artifactSummary: [
        selectedCard ? `当前功能：${selectedCard.responsibility}` : '',
        selectedNode ? `学生确认契约：${isZh ? selectedNode.titleZh : selectedNode.titleEn}` : '',
        selectedCard?.boundaryReason ? `功能边界：${selectedCard.boundaryReason}` : '',
        selectedCard ? `理解责任：${selectedCard.responsibilityOwner === 'ai-supported' ? 'AI 可协助、学生验证' : '学生核心责任'}` : '',
        selectedCard ? `输入：${selectedCard.input}；输出：${selectedCard.output}` : '',
        selectedCard ? `验证方式：${selectedCard.verification}` : '',
        `函数进度：${completedCardCount}/${buildUnits.length}`,
      ].filter(Boolean).join('\n'),
    });
  }, [buildUnits.length, completedCardCount, currentCode, currentProgress?.testAttempts, isZh, onAssistantContextChange, selectedCard, selectedNode, testMessage]);

  const updateCode = (code: string) => {
    if (!selectedCard || !selectedNode || !selectedUnit || FRAMEWORK_NODE_IDS.has(selectedNode.id)) return;
    setProgress(current => {
      const next = { ...current };
      buildUnits.forEach(unit => {
        const laterSameCard = unit.card.id === selectedCard.id
          && buildUnits.indexOf(unit) > buildUnits.indexOf(selectedUnit);
        if (laterSameCard && next[unit.id]) {
          next[unit.id] = { ...next[unit.id], verified: false };
        }
      });
      next[selectedUnit.id] = {
        ...current[selectedUnit.id],
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

  const verifiedCount = useMemo(
    () => Object.values(progress).filter((item: StudentModuleProgress) => item.verified).length,
    [progress],
  );

  /**
   * 测试失败后回到更早阶段修订。
   *
   * 先上报一次 `structure_change`，把「这次修订是由哪个模块的失败触发的」
   * 记进证据链——这正是 CROSS_STAGE_REVISION 白名单要支持的教学主线。
   * 上报用 `test_revision` 作为修改来源，与学生自发的结构调整区分开。
   *
   * **上报失败就不跳转。** 此前这里忽略返回值，无论成功与否都清掉
   * `lastFailedUnitId` 并切换阶段：一旦网络失败，「测试失败 → 回头修订解构」
   * 这条最能说明学生认知调整的链路就断了，而且失败上下文（是哪个模块、
   * 什么错误码）随着面板消失再也拼不回来。学生也不会知道要重来一次。
   *
   * 各阶段组件在返回时会重新挂载并重读 localStorage，因此修订后回到建构阶段
   * 能看到最新内容，不需要额外的同步机制。
   */
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
            trigger: 'test_failure',
            revisingStage: stage,
            failedUnitId,
            failedNodeId: failed.blueprintNodeId,
            lastResultCode: failed.testAttempts?.[failed.testAttempts.length - 1]?.resultCode,
          },
          artifacts: [moduleCodeArtifact(
            failedUnitId,
            failed,
            'test_revision',
            `revising ${stage} after failed test`,
          )],
        });

        if (!recorded) {
          // 停在原地：保留失败模块、测试上下文和学生代码，让学生能重试。
          setRevisionError(isZh
            ? '这次修订还没有记录成功，暂时不能切换阶段。你的代码和测试结果都还在，请检查网络后再点一次。'
            : 'This revision was not recorded yet, so the stage was not switched. Your code and test result are kept — check your connection and try again.');
          return;
        }
      } catch {
        setRevisionError(isZh
          ? '这次修订还没有记录成功，暂时不能切换阶段。你的代码和测试结果都还在，请检查网络后再点一次。'
          : 'This revision was not recorded yet, so the stage was not switched. Your code and test result are kept — check your connection and try again.');
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
    if (!selectedCard || !selectedNode || !selectedUnit || testRunning) return;
    if (FRAMEWORK_NODE_IDS.has(selectedNode.id)) {
      setTestMessage(isZh ? '该部分由平台提供，已接入装配器。' : 'This part is provided by the platform and already connected.');
      return;
    }
    setTestRunning(true);
    setTestMessage(isZh ? '正在真实运行当前 Python 函数；首次使用需要加载测试环境。' : 'Running the Python function. The first test needs to load the runtime.');
    try {
      const result = await runPythonModuleTest(selectedNode.id, currentCode);
      const now = new Date().toISOString();
      // 本次测试尝试。构建一次、同时用于本地进度与事件上报——
      // 两处各自生成会得到不同的 attempt id，导出时无法把事件与工作区里的
      // 那一次尝试对应起来。
      const attempt = {
        id: createRequestId(),
        passed: result.passed,
        resultCode: result.resultCode,
        durationMs: result.durationMs,
        createdAt: now,
      };

      setProgress(current => {
        const previous = current[selectedUnit.id];
        return {
          ...current,
          [selectedUnit.id]: {
            ...previous,
            cardId: selectedCard.id,
            blueprintNodeId: selectedNode.id,
            code: currentCode,
            verified: result.passed,
            updatedAt: now,
            testAttempts: [...(previous?.testAttempts ?? []).slice(-11), attempt],
          },
        };
      });
      setTestMessage(formatPythonModuleTestResult(result, language));

      // 模块测试是关键时刻：通过与失败都要留痕。只记结果码、耗时与本次尝试 ID，
      // 不记录运行帧或中间输出。
      //
      // attemptId 放在 detail 而不是产物 content 里：它每次都不同，进了 content
      // 就会让同一段未修改的代码每跑一次测试都多出一个版本（见 moduleCodeArtifact）。
      // 放在 detail 里同样能把这条事件与工作区快照中的那次尝试对应起来。
      void onReportKeyMoment?.({
        stage: 'build',
        eventType: 'module_test',
        detail: {
          unitId: selectedUnit.id,
          cardId: selectedCard.id,
          blueprintNodeId: selectedNode.id,
          attemptId: attempt.id,
          passed: result.passed,
          resultCode: result.resultCode,
          durationMs: result.durationMs,
        },
        artifacts: [moduleCodeArtifact(
          selectedUnit.id,
          {
            cardId: selectedCard.id,
            blueprintNodeId: selectedNode.id,
            code: currentCode,
            verified: result.passed,
            updatedAt: now,
            testAttempts: [attempt],
          },
          'structure_edit',
          result.passed ? undefined : `test failed: ${result.resultCode}`,
        )],
      });

      setLastFailedUnitId(result.passed ? null : selectedUnit.id);

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

  if (buildUnits.length === 0) {
    return (
      <section className="project-build-workspace is-empty">
        <Layers3 size={35} />
        <h3>{isZh ? '还没有可建构的功能' : 'No functions are ready to build'}</h3>
        <p>{mappedCardCount > 0
          ? (isZh ? '当前功能卡暂时无法形成建构单元，请返回检查功能描述。' : 'The current cards could not form build units. Review their descriptions.')
          : (isZh ? '请先回到功能卡，用自己的观察命名功能并简述实现。' : 'Return to function cards, name functions from your observations, and describe how they work.')}</p>
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to function cards'}</button>
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
            checkpointTotal={buildUnits.length}
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
            <div><span>03 / BUILD & VERIFY</span><h3>{isZh ? '逐个实现并运行验证' : 'Build and verify one function at a time'}</h3></div>
            <strong>{completedCardCount}<small>/{buildUnits.length}</small></strong>
          </header>

          {unmappedCards.length > 0 && (
            <div className="build-unmapped-notice">
              <CircleAlert size={15} />
              <span>{isZh
                ? `${unmappedCards.length} 张历史功能卡被标记为不参与建构，可返回功能卡修改。`
                : `${unmappedCards.length} legacy cards are excluded from building and can be revised.`}</span>
              <button type="button" onClick={onBack}>{isZh ? '修改功能卡' : 'Review cards'}</button>
            </div>
          )}

          <nav className="student-module-rail" aria-label={isZh ? '函数建构列表' : 'Function build list'}>
            {buildUnits.map((unit, index) => {
              const verified = unitIsComplete(unit);
              return (
                <button key={unit.id} type="button" className={`${selectedUnit?.id === unit.id ? 'is-active' : ''} ${verified ? 'is-verified' : ''}`} onClick={() => { setSelectedId(unit.id); setTestMessage(''); }}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p title={`${unit.card.responsibility} · ${isZh ? unit.node.titleZh : unit.node.titleEn}`}>{unit.card.responsibility}<small>{isZh ? unit.node.titleZh : unit.node.titleEn}</small></p>
                  <i>{verified ? <Check size={14} /> : <CircleDot size={14} />}</i>
                </button>
              );
            })}
          </nav>

          {selectedCard && selectedNode && selectedUnit && (
            <article className="module-editor-card">
              <header>
                <div>
                  <span>{isZh ? '你的功能卡 × 你确认的契约' : 'YOUR CARD × CONFIRMED CONTRACT'}</span>
                  <h4>{selectedCard.responsibility}</h4>
                  <small>{isZh ? selectedNode.titleZh : selectedNode.titleEn}</small>
                </div>
                <span className={currentProgress?.verified || FRAMEWORK_NODE_IDS.has(selectedNode.id) ? 'is-complete' : ''}>
                  {FRAMEWORK_NODE_IDS.has(selectedNode.id) ? (isZh ? '平台提供' : 'PROVIDED') : currentProgress?.verified ? (isZh ? '已验证' : 'VERIFIED') : (isZh ? '待实现' : 'TO BUILD')}
                </span>
              </header>

              <div className="module-contract-grid">
                <div><small>OBSERVE</small><span>{selectedCard.observationText}</span></div>
                <div><small>{isZh ? '实现描述' : 'HOW'}</small><span>{selectedCard.implementation || [selectedCard.input, selectedCard.output].filter(Boolean).join(' → ') || (isZh ? '尚未填写' : 'Not described yet')}</span></div>
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
                <span>{testMessage || (isZh ? '可以从任意函数开始；运行后根据反馈继续修改。' : 'Start with any function, run it, and revise from the feedback.')}</span>
                <button type="button" onClick={() => void verifyCurrentModule()} disabled={testRunning}>
                  {testRunning ? <LoaderCircle size={15} className="is-spinning" /> : <Play size={15} />}
                  {testRunning ? (isZh ? '正在运行' : 'Running') : (isZh ? '运行模块测试' : 'Run module test')}
                </button>
              </footer>
            </article>
          )}
        </div>
      </div>

      {lastFailedUnitId && (
        <div className="build-revision-prompt" role="status">
          <span>
            {isZh
              ? '测试没通过。如果问题出在拆解本身，可以回到更早的阶段修订你的判断，再回来继续。'
              : 'The test did not pass. If the problem is in your decomposition, revise it and come back.'}
          </span>
          {revisionError ? (
            <p className="build-revision-error" role="alert">{revisionError}</p>
          ) : null}
          <div className="build-revision-actions">
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('observe')}>
              {revisingStage === 'observe' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '补充观察' : 'Revise observations')}
            </button>
            <button type="button" disabled={revisingStage !== null} onClick={() => void reviseEarlierStage('decompose')}>
              {revisingStage === 'decompose' ? (isZh ? '正在记录…' : 'Recording…') : (isZh ? '修订功能卡' : 'Revise function cards')}
            </button>
            <button type="button" disabled={revisingStage !== null} onClick={() => { setRevisionError(''); setLastFailedUnitId(null); }}>
              {isZh ? '继续在这里改' : 'Keep editing here'}
            </button>
          </div>
        </div>
      )}

      <footer className="build-workspace-footer">
        <button type="button" onClick={onBack}>{isZh ? '返回功能卡' : 'Back to function cards'}</button>
        <span>{isZh ? '从运行观察和功能命名直接进入函数建构与验证' : 'Move directly from observations and function names into building and verification.'}</span>
        {onFinalSubmit && (
          <button
            type="button"
            className="build-final-submit"
            onClick={() => void onFinalSubmit()}
            disabled={completing || completed || verifiedCount === 0}
            title={verifiedCount === 0
              ? (isZh ? '至少通过一个模块测试后再提交' : 'Pass at least one module test before submitting')
              : undefined}
          >
            {completed
              ? (isZh ? '已提交' : 'Submitted')
              : completing
                ? (isZh ? '提交中' : 'Submitting')
                : (isZh ? '提交项目' : 'Submit project')}
          </button>
        )}
      </footer>
    </section>
  );
};
