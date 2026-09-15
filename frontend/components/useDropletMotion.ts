import { useEffect, useRef } from 'react';
import { dragDeformation, stepSpring } from '../utils/dropletSpring';

const resting = () => ({ stretch: { value: 0, velocity: 0 }, x: { value: 0, velocity: 0 }, y: { value: 0, velocity: 0 } });

export function useDropletMotion() {
  const surface = useRef<HTMLSpanElement>(null);
  const springs = useRef(resting());
  const target = useRef({ stretch: 0, x: 0, y: 0, angle: 0 });
  const frame = useRef(0);
  const lastFrame = useRef(0);
  const lastInput = useRef(0);
  const reduced = useRef(false);

  function reset() {
    cancelAnimationFrame(frame.current); frame.current = 0;
    springs.current = resting(); target.current = { stretch: 0, x: 0, y: 0, angle: 0 };
    if (surface.current) {
      surface.current.style.transform = '';
      surface.current.style.setProperty('--face-x', '0px');
      surface.current.style.setProperty('--face-y', '0px');
      surface.current.removeAttribute('data-moving');
    }
  }
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { reduced.current = preference.matches; if (preference.matches) reset(); };
    const visibility = () => { if (document.hidden) reset(); };
    change(); preference.addEventListener('change', change);
    document.addEventListener('visibilitychange', visibility);
    return () => { reset(); preference.removeEventListener('change', change); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  function tick(now: number) {
    if (!surface.current || reduced.current || document.hidden) { reset(); return; }
    const dt = (now - lastFrame.current) / 1000;
    lastFrame.current = now;
    // Holding still also returns the drop to rest; no idle requestAnimationFrame loop.
    if (now - lastInput.current > 65) target.current = { ...target.current, stretch: 0, x: 0, y: 0 };
    const state = springs.current;
    state.stretch = stepSpring(state.stretch, target.current.stretch, dt);
    state.x = stepSpring(state.x, target.current.x, dt);
    state.y = stepSpring(state.y, target.current.y, dt);
    const settled = (['stretch', 'x', 'y'] as const).every(key => Math.abs(state[key].value - target.current[key]) < 0.0005 && Math.abs(state[key].velocity) < 0.005);
    if (settled && target.current.stretch === 0) { reset(); return; }
    const scale = 1 + Math.max(-0.1, Math.min(0.24, state.stretch.value));
    const angle = target.current.angle;
    surface.current.style.transform = `rotate(${angle}deg) scale(${scale}, ${1 / scale}) rotate(${-angle}deg)`;
    surface.current.style.setProperty('--face-x', `${state.x.value}px`);
    surface.current.style.setProperty('--face-y', `${state.y.value}px`);
    surface.current.dataset.moving = 'true';
    frame.current = requestAnimationFrame(tick);
  }
  function nudge(dx: number, dy: number, elapsedMs: number) {
    if (reduced.current || document.hidden) return;
    target.current = dragDeformation(dx, dy, elapsedMs);
    lastInput.current = performance.now();
    if (!frame.current) { lastFrame.current = lastInput.current; frame.current = requestAnimationFrame(tick); }
  }
  function release() { target.current = { ...target.current, stretch: 0, x: 0, y: 0 }; }
  return { surface, nudge, release };
}
