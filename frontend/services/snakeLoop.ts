/** A yielding while loop: one completed Python step per tick, never a backlog. */
export function createSnakeLoop(tick: () => Promise<boolean>, onPlaying: (playing: boolean) => void, interval = 360) {
  let generation = 0;
  let playing = false;
  let wake: (() => void) | undefined;
  let pending: Promise<boolean> | undefined;
  const stop = () => {
    generation += 1;
    playing = false;
    wake?.();
    wake = undefined;
    onPlaying(false);
  };
  const start = () => {
    if (playing) return;
    const version = ++generation;
    playing = true;
    onPlaying(true);
    void (async () => {
      try {
        while (playing && generation === version) {
          // Yield to the browser so drawing, input and pause stay responsive.
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { wake = undefined; resolve(); }, interval);
            wake = () => { clearTimeout(timer); resolve(); };
          });
          // A pause/resume cannot overlap an older in-flight Python call.
          if (pending) await pending;
          if (!playing || generation !== version) break;
          pending = tick();
          const keepGoing = await pending;
          pending = undefined;
          if (generation !== version) break;
          if (!keepGoing) { stop(); break; }
        }
      } catch {
        pending = undefined;
        if (generation === version) stop();
      }
    })();
  };
  const settled = async () => { try { await pending; } catch { /* tick reports its own error */ } };
  return { start, stop, settled, get generation() { return generation; }, get playing() { return playing; } };
}
