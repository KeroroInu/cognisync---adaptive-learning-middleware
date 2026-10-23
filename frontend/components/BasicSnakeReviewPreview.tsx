import React, { useEffect, useRef, useState } from 'react';
import { BasicSnakeBoard } from './BasicSnakeBoard';
import type { BasicSnakeState, SnakeKey } from '../data/basicSnake';
import { runBasicSnake } from '../services/basicSnakeRunner';
import { disposePythonModuleRunner } from '../services/pythonModuleRunner';
import '../views/ClassroomSnakeWorkspace.css';

/** Frozen new-runtime work must never be passed to the legacy fallback assembler. */
export default function BasicSnakeReviewPreview({ code, onTransition, onOutput }: {
  code: string; onTransition: (before: BasicSnakeState, after: BasicSnakeState) => void;
  onOutput: (source: string, lines: string[]) => void;
}) {
  const [state, setState] = useState<BasicSnakeState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; disposePythonModuleRunner(); }; }, []);
  const run = async (key?: SnakeKey) => {
    if (lock.current || (key && (!state || state.game_over))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await runBasicSnake(code, key ? state : null, key);
      if (!alive.current) return;
      setState(result.state); setError(result.error); onOutput('冻结作品', [...result.output, ...(result.error ? [result.error] : [])]);
      if (key && state && result.state) onTransition(state, result.state);
    } catch (cause) { if (alive.current) { setState(null); setError(cause instanceof Error ? cause.message : '运行失败'); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="basic-snake basic-snake-frozen" onKeyDown={event => {
    const key = event.key.toLowerCase() as SnakeKey;
    if (!event.repeat && !event.ctrlKey && !event.metaKey && ['w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); void run(key); }
  }}><strong>冻结作品 · 10 × 10 · 得分 {state?.score ?? '—'}</strong>
    <BasicSnakeBoard state={state} running={busy} />
    {error && <p role="alert">{error}</p>}
    {state?.game_over && <p>{state.won ? '棋盘已填满' : '游戏结束'}</p>}
    <div className="basic-snake-controls"><button disabled={busy} onClick={() => void run()}>运行冻结代码 / 重置</button>{(['w', 'a', 's', 'd'] as SnakeKey[]).map(key => <button key={key} disabled={busy || !state || state.game_over} onClick={() => void run(key)}>{key.toUpperCase()}</button>)}</div>
  </section>;
}
