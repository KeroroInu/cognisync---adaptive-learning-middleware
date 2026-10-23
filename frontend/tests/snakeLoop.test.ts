import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSnakeLoop } from '../services/snakeLoop';

afterEach(() => vi.useRealTimers());
describe('continuous Snake loop', () => {
  it('moves without input, pauses and resumes without duplicate timers', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => true);
    const loop = createSnakeLoop(tick, vi.fn());
    loop.start(); loop.start();
    await vi.advanceTimersByTimeAsync(1080);
    expect(tick).toHaveBeenCalledTimes(3);
    loop.stop(); await vi.advanceTimersByTimeAsync(1080);
    expect(tick).toHaveBeenCalledTimes(3);
    loop.start(); await vi.advanceTimersByTimeAsync(360);
    expect(tick).toHaveBeenCalledTimes(4);
    loop.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for slow Python, including after pause/resume', async () => {
    vi.useFakeTimers();
    let finish!: (value: boolean) => void;
    const tick = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const loop = createSnakeLoop(tick, vi.fn());
    loop.start(); await vi.advanceTimersByTimeAsync(360);
    loop.stop(); loop.start(); await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(1);
    finish(true); await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    loop.stop(); finish(true); await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
  });
  it.each(['end', 'error'])('stops on %s with no runaway loop', async kind => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => { if (kind === 'error') throw new Error('Python failed'); return false; });
    const playing = vi.fn();
    const loop = createSnakeLoop(tick, playing);
    loop.start(); await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(loop.playing).toBe(false);
    expect(playing).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
