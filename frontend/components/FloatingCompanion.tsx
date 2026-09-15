import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Companion } from './Companion';
import './FloatingCompanion.css';

type Point = { x: number; y: number };
const SIZE = 68;
function clamp(point: Point): Point {
  return { x: Math.max(8, Math.min(point.x, window.innerWidth - SIZE - 8)), y: Math.max(8, Math.min(point.y, window.innerHeight - SIZE - 8)) };
}
function readPosition(key: string): Point {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) return clamp(value);
  } catch { /* Storage is optional; the assistant remains usable. */ }
  return clamp({ x: window.innerWidth - SIZE - 20, y: window.innerHeight - SIZE - 100 });
}

export function FloatingCompanion({ userId, open, busy = false, onActivate }: {
  userId: string; open: boolean; busy?: boolean; onActivate: () => void;
}) {
  const key = `cognisync:companion:v1:${userId}`;
  const [position, setPosition] = useState(() => readPosition(key));
  const latestPosition = useRef(position);
  latestPosition.current = position;
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const persist = (point: Point) => { try { localStorage.setItem(key, JSON.stringify(point)); } catch { /* no learning data here */ } };
  useEffect(() => { setPosition(readPosition(key)); }, [key]);
  useEffect(() => {
    const resize = () => setPosition(point => clamp(point));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function finish(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    suppressClick.current = active.moved || cancelled;
    gesture.current = null; setDragging(false);
    persist(latestPosition.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (typeof document === 'undefined') return null;
  return createPortal(<button type="button" className={`floating-companion${dragging ? ' is-dragging' : ''}${open ? ' is-open' : ''}`}
    style={{ left: position.x, top: position.y }} aria-label="小精灵：打开 AI 助手" aria-expanded={open}
    title="点击找我聊天；拖动换个位置（也可用方向键移动）"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
      if (!active.moved && Math.hypot(dx, dy) < 6) return;
      active.moved = true; setDragging(true);
      const next = clamp({ x: active.origin.x + dx, y: active.origin.y + dy });
      latestPosition.current = next;
      setPosition(next);
    }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event, true)}
    onClick={event => { if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; } onActivate(); }}
    onKeyDown={event => {
      const offsets: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault(); event.stopPropagation();
      const next = clamp({ x: position.x + offset.x, y: position.y + offset.y });
      setPosition(next); persist(next);
    }}>
    <Companion busy={busy} />
    <span className="companion-hint" aria-hidden="true">{busy ? '想一想…' : open ? '我在呢' : '找我聊聊'}</span>
  </button>, document.body);
}
