import React, { useState } from 'react';
import type { BasicSnakeState, Cell } from '../data/basicSnake';

const cells = Array.from({ length: 100 }, (_, i) => i);
export function BasicSnakeBoard({ state, stale = false, running = false, onCellClick }: {
  state: BasicSnakeState | null; stale?: boolean; running?: boolean; onCellClick?: (cell: Cell) => void;
}) {
  const [selected, setSelected] = useState(0);
  const snake = new Map(state?.snake.map(([r, c], index) => [r * 10 + c, index]) ?? []);
  const food = state?.food ? state.food[0] * 10 + state.food[1] : -1;
  const obstacles = new Set(state?.obstacles?.map(([r, c]) => r * 10 + c) ?? []);
  const path = new Set(state?.path?.map(([r, c]) => r * 10 + c) ?? []);
  const interactive = !!state && !stale && !running && !!onCellClick;
  return <div className="basic-snake-board-slot"><div className={`basic-snake-board${stale ? ' stale' : ''}${interactive ? ' interactive' : ''}`} aria-label="10 行 10 列棋盘" role="grid" tabIndex={interactive ? 0 : undefined}
    aria-describedby={interactive ? 'snake-board-help' : undefined}
    aria-activedescendant={interactive ? `snake-cell-${selected}` : undefined}
    onKeyDown={event => {
      if (!interactive) return;
      const row = Math.floor(selected / 10), col = selected % 10;
      const next = { ArrowUp: (Math.max(0, row - 1) * 10 + col), ArrowDown: (Math.min(9, row + 1) * 10 + col), ArrowLeft: (row * 10 + Math.max(0, col - 1)), ArrowRight: (row * 10 + Math.min(9, col + 1)) }[event.key];
      if (next !== undefined) { event.preventDefault(); setSelected(next); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCellClick?.([row, col]); }
    }}>
    {cells.map(id => <div key={id} id={`snake-cell-${id}`} role="gridcell" aria-selected={interactive && selected === id} aria-label={`第 ${Math.floor(id / 10) + 1} 行，第 ${id % 10 + 1} 列${snake.has(id) ? '，蛇身' : food === id ? '，食物' : obstacles.has(id) ? '，障碍' : ''}`}
      data-cell={`${Math.floor(id / 10)},${id % 10}`}
      className={`basic-snake-cell${path.has(id) ? ' path' : ''}${obstacles.has(id) ? ' obstacle' : ''}${snake.has(id) ? (snake.get(id) === 0 ? ' head' : ' body') : ''}${food === id ? ' food' : ''}${interactive && selected === id ? ' selected' : ''}`}
      onClick={interactive ? () => { setSelected(id); onCellClick([Math.floor(id / 10), id % 10]); } : undefined} />)}
    {!state && <div className="basic-snake-board-message">{running ? '载入 Python…' : '运行你的代码，点亮棋盘'}</div>}
  </div>{interactive && <span className="basic-snake-board-help" id="snake-board-help">点击格子；键盘方向键选格，回车确认。点击后的变化由你的代码决定。</span>}</div>;
}
