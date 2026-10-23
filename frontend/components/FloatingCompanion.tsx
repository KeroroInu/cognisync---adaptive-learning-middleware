import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Companion } from './Companion';
import { useDropletMotion } from './useDropletMotion';
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

export type CompanionAction = { id: string; label: string; icon?: React.ReactNode; disabled?: boolean; title?: string; onSelect: () => void };

export function FloatingCompanion({ userId, open, busy = false, actions, contextKey }: {
  userId: string; open: boolean; busy?: boolean; actions: CompanionAction[]; contextKey: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const bubbles = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const key = `cognisync:companion:v1:${userId}`;
  const [position, setPosition] = useState(() => readPosition(key));
  const latestPosition = useRef(position);
  latestPosition.current = position;
  const [dragging, setDragging] = useState(false);
  const fluid = useDropletMotion();
  const gesture = useRef<{ id: number; start: Point; origin: Point; last: Point; time: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const persist = (point: Point) => { try { localStorage.setItem(key, JSON.stringify(point)); } catch { /* no learning data here */ } };
  useEffect(() => { setPosition(readPosition(key)); }, [key]);
  useEffect(() => { setExpanded(false); }, [key, contextKey]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !bubbles.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); button.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded]);
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
    fluid.release();
    persist(latestPosition.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (typeof document === 'undefined') return null;
  const above = position.y > window.innerHeight - position.y - SIZE;
  return createPortal(<><button ref={button} type="button" className={`floating-companion${dragging ? ' is-dragging' : ''}${open ? ' is-open' : ''}${expanded ? ' has-bubbles' : ''}`}
    style={{ left: position.x, top: position.y }} aria-label="贪贪：展开工具" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined}
    title="我是贪贪，点我提问或打开工具包；拖动换个位置"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: position, last: position, time: performance.now(), moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
      if (!active.moved && Math.hypot(dx, dy) < 6) return;
      active.moved = true; setDragging(true); setExpanded(false);
      const next = clamp({ x: active.origin.x + dx, y: active.origin.y + dy });
      const now = performance.now();
      fluid.nudge(next.x - active.last.x, next.y - active.last.y, now - active.time);
      active.last = next; active.time = now;
      latestPosition.current = next;
      setPosition(next);
    }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event, true)}
    onClick={event => { if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; } setExpanded(value => !value); }}
    onKeyDown={event => {
      const offsets: Record<string, Point> = { ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 }, ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 } };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault(); event.stopPropagation();
      setExpanded(false);
      const next = clamp({ x: position.x + offset.x, y: position.y + offset.y });
      setPosition(next); persist(next);
    }}>
    <span className="companion-fluid" ref={fluid.surface}><Companion busy={busy} /></span>
    <span className="companion-hint" aria-hidden="true">{busy ? '想一想…' : open ? '我在呢' : '点我一下'}</span>
  </button>
  {expanded && <div ref={bubbles} id={menuId} role="group" aria-label="贪贪的工具" className="companion-bubbles" style={{
    left: Math.max(8, Math.min(position.x + SIZE / 2 - 80, window.innerWidth - 168)),
    ...(above ? { bottom: window.innerHeight - position.y + 8 } : { top: position.y + SIZE + 8 }),
    maxHeight: Math.max(44, (above ? position.y : window.innerHeight - position.y - SIZE) - 16),
  }}>
    {actions.map(action => <button key={action.id} type="button" disabled={action.disabled} title={action.title}
      onClick={() => { setExpanded(false); button.current?.focus(); action.onSelect(); }}>
      {action.icon}<span>{action.label}</span>
    </button>)}
  </div>}
  </>, document.body);
}
