import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../types';

interface Props {
  language: Language;
}

const BOARD_COLUMNS = 18;
const BOARD_ROWS = 12;
const SNAKE_LENGTH = 8;
const foodCell = 8 * BOARD_COLUMNS + 8;

const snakePath = [
  ...Array.from({ length: 14 }, (_, index) => 3 * BOARD_COLUMNS + index + 2),
  ...Array.from({ length: 6 }, (_, index) => (index + 4) * BOARD_COLUMNS + 15),
  ...Array.from({ length: 13 }, (_, index) => 9 * BOARD_COLUMNS + 14 - index),
  ...Array.from({ length: 5 }, (_, index) => (8 - index) * BOARD_COLUMNS + 2),
];

export const RetroLearningTerminal: React.FC<Props> = ({ language }) => {
  const isZh = language === 'zh';
  const [snakeFrame, setSnakeFrame] = useState(0);
  const [rotation, setRotation] = useState({ x: -2, y: 4 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, rotationX: 0, rotationY: 0 });

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return undefined;

    const timer = window.setInterval(() => {
      setSnakeFrame(current => (current + 1) % snakePath.length);
    }, 180);

    return () => window.clearInterval(timer);
  }, []);

  const snakeCells = useMemo(() => {
    const cells = new Set<number>();
    for (let offset = 0; offset < SNAKE_LENGTH; offset += 1) {
      cells.add(snakePath[(snakeFrame - offset + snakePath.length) % snakePath.length]);
    }
    return cells;
  }, [snakeFrame]);

  const snakeHead = snakePath[snakeFrame];

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotationX: rotation.x,
      rotationY: rotation.y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || dragRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    setRotation({
      x: Math.max(-16, Math.min(16, dragRef.current.rotationX - deltaY * 0.1)),
      y: Math.max(-22, Math.min(22, dragRef.current.rotationY + deltaX * 0.1)),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current.pointerId = -1;
    setIsDragging(false);
  };

  const resetRotation = () => setRotation({ x: -2, y: 4 });

  return (
    <div className="retro-terminal-scene" aria-label={isZh ? '贪吃蛇学习项目与画像卡片展示' : 'Snake learning project and learner cards'}>
      <div className="terminal-scene-label">
        <span>COGNISYNC DECONSTRUCTION LAB / 01</span>
        <span>{isZh ? '项目：贪吃蛇' : 'PROJECT: SNAKE'}</span>
      </div>

      <div
        className={`retro-computer ${isDragging ? 'retro-computer-dragging' : ''}`}
        style={{
          '--terminal-rotate-x': `${rotation.x}deg`,
          '--terminal-rotate-y': `${rotation.y}deg`,
        } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={resetRotation}
        role="img"
        aria-label={isZh ? '可拖动旋转的复古学习电脑，双击复位' : 'Draggable retro learning computer, double-click to reset'}
      >
        <div className="retro-monitor">
          <div className="retro-screen-frame">
            <div className="retro-screen">
              <div className="retro-screen-topline">
                <span>COGNISYNC_OS</span>
                <span>READY ●</span>
              </div>
              <div className="snake-title-row">
                <div>
                  <span>PROJECT_001</span>
                  <strong>{isZh ? '贪吃蛇' : 'SNAKE'}</strong>
                </div>
                <div className="snake-score">
                  <span>SCORE</span>
                  <strong>0040</strong>
                </div>
              </div>
              <div
                className="snake-board"
                style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS}, 1fr)`, gridTemplateRows: `repeat(${BOARD_ROWS}, 1fr)` }}
                aria-hidden="true"
              >
                {Array.from({ length: BOARD_COLUMNS * BOARD_ROWS }, (_, index) => {
                  const classNames = [
                    'snake-cell',
                    snakeCells.has(index) ? 'snake-body' : '',
                    index === snakeHead ? 'snake-head' : '',
                    index === foodCell ? 'snake-food' : '',
                  ].filter(Boolean).join(' ');
                  return <span className={classNames} key={index} />;
                })}
              </div>
              <div className="retro-screen-footer">
                <span>OBSERVE → DECONSTRUCT → REBUILD</span>
                <span>LEVEL 01</span>
              </div>
            </div>
          </div>

          <div className="retro-drive-row">
            <span className="retro-brand">CS—26</span>
            <span className="retro-drive" />
            <span className="retro-led" />
          </div>

          <div className="terminal-stickers" aria-hidden="true">
            <div className="terminal-sticker terminal-sticker-profile">
              <span>LEARNER / 01</span>
              <strong>{isZh ? '结构探索者' : 'STRUCTURE SCOUT'}</strong>
              <small>{isZh ? '起始画像 · 非能力评级' : 'STARTING PROFILE'}</small>
            </div>
            <div className="terminal-sticker terminal-sticker-project">
              <span>PROJECT CARD</span>
              <strong>SNAKE</strong>
              <small>DECONSTRUCT / REBUILD / VERIFY</small>
            </div>
            <div className="terminal-sticker terminal-sticker-next">
              <span>NEXT</span>
              <strong>→ 03</strong>
            </div>
          </div>
        </div>

        <div className="retro-keyboard">
          <div className="retro-keyboard-ledge" />
          <div className="retro-keys" aria-hidden="true">
            {Array.from({ length: 34 }, (_, index) => (
              <span key={index} className={index === 29 ? 'retro-space-key' : ''} />
            ))}
          </div>
        </div>
      </div>

      <p className="terminal-scene-note">
        {isZh ? '拖动电脑旋转 · 双击复位 · 从完整项目出发，由解构走向建构' : 'Drag to rotate · Double-click to reset · Move from deconstruction to reconstruction'}
      </p>
    </div>
  );
};
