import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Gamepad2,
  GripHorizontal,
  Maximize2,
  Minus,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import type { Language } from '../types';
import './SnakeProjectDemo.css';

interface Props {
  language: Language;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: 'floating' | 'viewer';
  showLauncher?: boolean;
}

type Direction = 'up' | 'down' | 'left' | 'right';
type GameStatus = 'idle' | 'running' | 'paused' | 'over';

interface Cell {
  x: number;
  y: number;
}

const BOARD_COLUMNS = 20;
const BOARD_ROWS = 16;
const TICK_MS = 150;

const INITIAL_SNAKE: Cell[] = [
  { x: 10, y: 8 },
  { x: 9, y: 8 },
  { x: 8, y: 8 },
  { x: 7, y: 8 },
];

const INITIAL_FOOD: Cell = { x: 14, y: 8 };

const DIRECTION_DELTA: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

const cellKey = (cell: Cell) => `${cell.x}:${cell.y}`;

const createFood = (snake: Cell[]): Cell => {
  const occupied = new Set(snake.map(cellKey));
  const available: Cell[] = [];

  for (let y = 0; y < BOARD_ROWS; y += 1) {
    for (let x = 0; x < BOARD_COLUMNS; x += 1) {
      if (!occupied.has(`${x}:${y}`)) available.push({ x, y });
    }
  }

  if (available.length === 0) return INITIAL_FOOD;
  return available[Math.floor(Math.random() * available.length)];
};

const getDefaultPosition = () => {
  if (typeof window === 'undefined') return { x: 24, y: 112 };
  return {
    x: Math.max(14, window.innerWidth - Math.min(720, window.innerWidth - 28) - 22),
    y: Math.max(82, Math.min(118, window.innerHeight * 0.14)),
  };
};

export const SnakeProjectDemo: React.FC<Props> = ({
  language,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  variant = 'floating',
  showLauncher = true,
}) => {
  const isZh = language === 'zh';
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(getDefaultPosition);
  const [snake, setSnake] = useState<Cell[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Cell>(INITIAL_FOOD);
  const [status, setStatus] = useState<GameStatus>('idle');
  const [score, setScore] = useState(0);

  const windowRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<Direction>('right');
  const dragRef = useRef({ pointerId: -1, offsetX: 0, offsetY: 0 });
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);

  const clampPosition = useCallback((x: number, y: number) => {
    const rect = windowRef.current?.getBoundingClientRect();
    const width = rect?.width ?? Math.min(700, window.innerWidth - 28);
    const height = minimized ? 58 : (rect?.height ?? 620);
    return {
      x: Math.min(Math.max(14, x), Math.max(14, window.innerWidth - width - 14)),
      y: Math.min(Math.max(76, y), Math.max(76, window.innerHeight - height - 14)),
    };
  }, [minimized]);

  useEffect(() => {
    const handleResize = () => setPosition(current => clampPosition(current.x, current.y));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  useEffect(() => {
    if (!open || variant !== 'viewer') return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setStatus(current => (current === 'running' ? 'paused' : current));
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, setOpen, variant]);

  useEffect(() => {
    if (status !== 'running' || !open || minimized) return undefined;

    const timer = window.setInterval(() => {
      setSnake(currentSnake => {
        const head = currentSnake[0];
        const delta = DIRECTION_DELTA[directionRef.current];
        const nextHead = { x: head.x + delta.x, y: head.y + delta.y };
        const hitBoundary =
          nextHead.x < 0 ||
          nextHead.x >= BOARD_COLUMNS ||
          nextHead.y < 0 ||
          nextHead.y >= BOARD_ROWS;
        const bodyToCheck = currentSnake.slice(0, -1);
        const hitSelf = bodyToCheck.some(cell => cell.x === nextHead.x && cell.y === nextHead.y);

        if (hitBoundary || hitSelf) {
          setStatus('over');
          return currentSnake;
        }

        const ateFood = nextHead.x === food.x && nextHead.y === food.y;
        const nextSnake = ateFood
          ? [nextHead, ...currentSnake]
          : [nextHead, ...currentSnake.slice(0, -1)];

        if (ateFood) {
          setScore(current => current + 10);
          setFood(createFood(nextSnake));
        }

        return nextSnake;
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [food, minimized, open, status]);

  const changeDirection = useCallback((nextDirection: Direction) => {
    if (OPPOSITE_DIRECTION[directionRef.current] === nextDirection) return;
    directionRef.current = nextDirection;
    if (status === 'idle' || status === 'paused') setStatus('running');
    boardRef.current?.focus({ preventScroll: true });
  }, [status]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keyMap: Record<string, Direction | undefined> = {
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
    const nextDirection = keyMap[event.key];
    if (!nextDirection) return;
    event.preventDefault();
    changeDirection(nextDirection);
  };

  const resetGame = () => {
    directionRef.current = 'right';
    setSnake(INITIAL_SNAKE);
    setFood(INITIAL_FOOD);
    setScore(0);
    setStatus('idle');
    window.setTimeout(() => boardRef.current?.focus({ preventScroll: true }), 0);
  };

  const toggleGame = () => {
    setStatus(current => (current === 'running' ? 'paused' : 'running'));
    boardRef.current?.focus({ preventScroll: true });
  };

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
  };

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    setPosition(clampPosition(
      event.clientX - dragRef.current.offsetX,
      event.clientY - dragRef.current.offsetY,
    ));
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current.pointerId = -1;
  };

  const snakeCells = useMemo(() => new Map(snake.map((cell, index) => [cellKey(cell), index])), [snake]);
  const statusLabel = status === 'running'
    ? (isZh ? '运行中' : 'RUNNING')
    : status === 'paused'
      ? (isZh ? '已暂停' : 'PAUSED')
      : status === 'over'
        ? (isZh ? '碰撞结束' : 'GAME OVER')
        : (isZh ? '等待开始' : 'READY');

  if (!open) {
    if (!showLauncher) return null;
    return (
      <button
        type="button"
        className="snake-demo-launcher"
        onClick={() => {
          setOpen(true);
          setMinimized(false);
          setPosition(current => clampPosition(current.x, current.y));
        }}
        aria-label={isZh ? '打开完整项目演示' : 'Open complete project demo'}
      >
        <span className="snake-demo-launcher-icon"><Gamepad2 size={20} /></span>
        <span>
          <strong>{isZh ? '完整项目演示' : 'Project demo'}</strong>
          <small>{isZh ? '贪吃蛇 · 可运行' : 'Snake · playable'}</small>
        </span>
      </button>
    );
  }

  const dialog = (
    <section
      ref={windowRef}
      className={`snake-demo-window ${minimized ? 'is-minimized' : ''} ${variant === 'viewer' ? 'is-viewer' : ''}`}
      style={variant === 'floating' ? { left: position.x, top: position.y } : undefined}
      role="dialog"
      aria-modal={variant === 'viewer' ? true : undefined}
      aria-label={isZh ? '贪吃蛇完整项目演示窗口' : 'Playable snake project demo'}
    >
      <div
        className="snake-demo-titlebar"
        onPointerDown={variant === 'floating' ? handleDragStart : undefined}
        onPointerMove={variant === 'floating' ? handleDragMove : undefined}
        onPointerUp={variant === 'floating' ? handleDragEnd : undefined}
        onPointerCancel={variant === 'floating' ? handleDragEnd : undefined}
      >
        <div className="snake-demo-window-title">
          <span className="snake-demo-drag-mark">
            {variant === 'floating' ? <GripHorizontal size={16} /> : <Gamepad2 size={16} />}
          </span>
          <span>
            <small>PROJECT_001 / COMPLETE BUILD</small>
            <strong>{isZh ? '贪吃蛇项目演示' : 'Snake project demo'}</strong>
          </span>
        </div>
        <div className="snake-demo-window-actions">
          <span className="snake-demo-live"><i />{isZh ? '可交互' : 'LIVE'}</span>
          {variant === 'floating' && (
            <button
              type="button"
              onClick={() => setMinimized(current => !current)}
              title={minimized ? (isZh ? '展开' : 'Expand') : (isZh ? '收起' : 'Minimize')}
            >
              {minimized ? <Maximize2 size={15} /> : <Minus size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setStatus(current => (current === 'running' ? 'paused' : current));
            }}
            title={isZh ? '关闭' : 'Close'}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="snake-demo-content">
          <div className="snake-demo-screen-shell">
            <div className="snake-demo-screen-head">
              <div>
                <span>{isZh ? '当前得分' : 'SCORE'}</span>
                <strong>{String(score).padStart(4, '0')}</strong>
              </div>
              <p>{statusLabel}</p>
              <div>
                <span>{isZh ? '当前速度' : 'SPEED'}</span>
                <strong>01</strong>
              </div>
            </div>

            <div
              ref={boardRef}
              className="snake-demo-board"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onClick={() => boardRef.current?.focus({ preventScroll: true })}
              style={{
                gridTemplateColumns: `repeat(${BOARD_COLUMNS}, 1fr)`,
                gridTemplateRows: `repeat(${BOARD_ROWS}, 1fr)`,
              }}
              aria-label={isZh ? '贪吃蛇游戏区域，使用方向键或WASD控制' : 'Snake board, use arrow keys or WASD'}
            >
              {Array.from({ length: BOARD_COLUMNS * BOARD_ROWS }, (_, index) => {
                const x = index % BOARD_COLUMNS;
                const y = Math.floor(index / BOARD_COLUMNS);
                const snakeIndex = snakeCells.get(`${x}:${y}`);
                const isFood = food.x === x && food.y === y;
                return (
                  <span
                    key={index}
                    className={`snake-demo-cell ${snakeIndex !== undefined ? 'is-snake' : ''} ${snakeIndex === 0 ? 'is-head' : ''} ${isFood ? 'is-food' : ''}`}
                  />
                );
              })}

              {status === 'over' && (
                <div className="snake-demo-gameover">
                  <span>{isZh ? '碰到边界或自己了' : 'Collision detected'}</span>
                  <strong>{isZh ? '这也是一个需要解构的规则' : 'A rule worth deconstructing'}</strong>
                  <button type="button" onClick={resetGame}>{isZh ? '重新观察' : 'Try again'}</button>
                </div>
              )}
            </div>

            <div className="snake-demo-observe-strip">
              <span>{isZh ? '观察焦点' : 'OBSERVE'}</span>
              <p>{isZh ? '方向输入如何改变状态？吃到食物后哪些数据发生变化？' : 'How does direction input change state? What changes after eating food?'}</p>
            </div>
          </div>

          <aside className="snake-demo-controls">
            <div className="snake-demo-control-copy">
              <span>RUN / OBSERVE</span>
              <h3>{isZh ? '先玩一玩，再拆开它。' : 'Play it. Then take it apart.'}</h3>
              <p>{isZh ? '点击棋盘后使用方向键或 WASD。先观察完整项目，不急着看答案。' : 'Click the board and use arrow keys or WASD. Observe the complete project before looking for answers.'}</p>
            </div>

            <div className="snake-demo-dpad" aria-label={isZh ? '方向控制' : 'Direction controls'}>
              <button type="button" className="is-up" onClick={() => changeDirection('up')} aria-label={isZh ? '向上' : 'Up'}><ArrowUp size={20} /></button>
              <button type="button" className="is-left" onClick={() => changeDirection('left')} aria-label={isZh ? '向左' : 'Left'}><ArrowLeft size={20} /></button>
              <span className="snake-demo-dpad-core" />
              <button type="button" className="is-right" onClick={() => changeDirection('right')} aria-label={isZh ? '向右' : 'Right'}><ArrowRight size={20} /></button>
              <button type="button" className="is-down" onClick={() => changeDirection('down')} aria-label={isZh ? '向下' : 'Down'}><ArrowDown size={20} /></button>
            </div>

            <div className="snake-demo-game-actions">
              <button type="button" className="is-primary" onClick={toggleGame} disabled={status === 'over'}>
                {status === 'running' ? <Pause size={16} /> : <Play size={16} />}
                {status === 'running' ? (isZh ? '暂停' : 'Pause') : (isZh ? '开始' : 'Start')}
              </button>
              <button type="button" onClick={resetGame}>
                <RotateCcw size={16} />
                {isZh ? '重置' : 'Reset'}
              </button>
            </div>

            <div className="snake-demo-keyboard-note">
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
              <span>
                {variant === 'floating'
                  ? (isZh ? '点击窗口标题可拖动到不遮挡的位置' : 'Drag the title bar out of your way')
                  : (isZh ? '完成观察后关闭窗口，系统会保留你的观察记录' : 'Close the viewer when finished; your observations stay saved')}
              </span>
            </div>
          </aside>
        </div>
      )}
    </section>
  );

  if (variant === 'viewer') {
    return <div className="snake-demo-backdrop">{dialog}</div>;
  }

  return dialog;
};
