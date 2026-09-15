import { describe, expect, it } from 'vitest';
import { dragDeformation, stepSpring } from '../utils/dropletSpring';

describe('local droplet spring', () => {
  it('limits fast pointer motion and lags behind the drag', () => {
    expect(dragDeformation(10000, 0, 0)).toMatchObject({ stretch: 0.2, x: -4, angle: 0 });
    expect(dragDeformation(0, 16, 16).y).toBeLessThan(0);
  });
  it('rebounds past rest and settles without a continuing frame loop', () => {
    let spring = { value: 0.2, velocity: 0 };
    let minimum = 0;
    for (let frame = 0; frame < 180; frame++) {
      spring = stepSpring(spring, 0, 1 / 60);
      minimum = Math.min(minimum, spring.value);
      expect(Math.abs(spring.value)).toBeLessThanOrEqual(0.2);
    }
    expect(minimum).toBeLessThan(-0.005);
    expect(Math.abs(spring.value)).toBeLessThan(0.0005);
    expect(Math.abs(spring.velocity)).toBeLessThan(0.005);
  });
  it('caps elapsed time after returning to a suspended tab', () => {
    const initial = { value: 0.1, velocity: 1 };
    expect(stepSpring(initial, 0, 20)).toEqual(stepSpring(initial, 0, 0.032));
  });
});
