export interface Spring { value: number; velocity: number }

// Small, under-damped spring. Bound elapsed time after tab suspension.
export function stepSpring(spring: Spring, target: number, elapsed: number): Spring {
  let { value, velocity } = spring;
  const duration = Math.max(0, Math.min(elapsed, 0.032));
  const steps = Math.max(1, Math.ceil(duration / 0.008));
  const dt = duration / steps;
  for (let i = 0; i < steps; i++) {
    velocity += (240 * (target - value) - 16 * velocity) * dt;
    value += velocity * dt;
  }
  return { value, velocity };
}

export function dragDeformation(dx: number, dy: number, elapsedMs: number) {
  const duration = Math.max(8, elapsedMs);
  const speed = Math.hypot(dx, dy) / duration;
  return { stretch: Math.min(0.2, speed * 0.075), x: Math.max(-4, Math.min(4, -dx / duration * 2)), y: Math.max(-4, Math.min(4, -dy / duration * 2)), angle: Math.atan2(dy, dx) * 180 / Math.PI };
}
