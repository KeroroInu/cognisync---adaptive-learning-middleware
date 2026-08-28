import { describe, expect, it } from 'vitest';

import {
  objectVisualType,
  sceneObjectClassName,
  sceneObjectStyle,
  usesLegacyPresentation,
} from '../data/sceneRenderer';
import { validateSceneState, type PythonGameObject, type PythonGameState } from '../services/pythonModuleRunner';

const BASE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
};

const validateObject = (raw: Record<string, unknown>): PythonGameObject => {
  const state = validateSceneState({ ...BASE, objects: [raw] });
  return state.objects![0];
};

/**
 * 渲染层只接收校验过的对象，因此这里先跑一遍校验器再渲染：
 * 用例同时覆盖「非法字段进不来」和「合法字段画得出来」。
 */
describe('legacy objects keep their v1 look', () => {
  const legacy: PythonGameObject = { id: 'o1', type: 'obstacle', position: [2, 3], solid: true };

  it('produces no inline style at all', () => {
    expect(usesLegacyPresentation(legacy)).toBe(true);
    expect(sceneObjectStyle(legacy)).toEqual({});
  });

  it('keeps the fixed skin class for the six known types', () => {
    ['obstacle', 'wall', 'bomb', 'portal', 'bonus', 'shield'].forEach(type => {
      expect(sceneObjectClassName({ ...legacy, type })).toBe(`construction-object is-${type}`);
    });
  });
});

describe('unknown types render without a new component', () => {
  it('falls back to the custom skin', () => {
    expect(objectVisualType('teleport_beacon')).toBe('custom');
    expect(sceneObjectClassName({ id: 'x', type: 'lava-pit', position: [0, 0] }))
      .toBe('construction-object is-custom');
  });

  it('draws an unknown type purely from shape, color and size', () => {
    const object = validateObject({
      id: 'x', type: 'lava-pit', position: [1, 1],
      shape: 'circle', color: '#ff5533', size: [1.5, 1.5], opacity: 0.8,
    });
    const style = sceneObjectStyle(object);
    expect(style.borderRadius).toBe('50%');
    expect(style.background).toBe('#ff5533');
    expect(style.width).toBe('150%');
    expect(style.opacity).toBe(0.8);
    expect(sceneObjectClassName(object)).toContain('has-shape-circle');
  });
});

describe('controlled presentation fields', () => {
  it('resolves registry color names', () => {
    const object = validateObject({ id: 'x', type: 'bonus', position: [1, 1], color: 'lime', strokeColor: 'ink' });
    expect(sceneObjectStyle(object).background).toBe('#bdf52f');
    expect(sceneObjectStyle(object).border).toBe('2px solid #161713');
  });

  it('centres sized objects and applies rotation in one transform', () => {
    const object = validateObject({ id: 'x', type: 'wall', position: [1, 1], size: [2, 0.5], rotation: 45 });
    const style = sceneObjectStyle(object);
    expect(style.transform).toBe('translate(-50%, -50%) rotate(45deg)');
    expect(style.width).toBe('200%');
    expect(style.height).toBe('50%');
  });

  it('keeps every student object under the game-over overlay', () => {
    const object = validateObject({ id: 'x', type: 'wall', position: [1, 1], zIndex: 9 });
    // 遮罩固定 z-index 20
    expect(sceneObjectStyle(object).zIndex).toBe(10);
  });

  it('renders text shapes without a box', () => {
    const object = validateObject({ id: 'x', type: 'custom', position: [1, 1], shape: 'text', color: 'amber', label: '+10' });
    const style = sceneObjectStyle(object);
    expect(style.background).toBe('transparent');
    expect(style.border).toBe('0');
    expect(style.color).toBe('#e7a72d');
    expect(object.label).toBe('+10');
  });

  it('only emits the four controlled animation classes', () => {
    (['pulse', 'blink', 'spin'] as const).forEach(animation => {
      const object = validateObject({ id: 'x', type: 'bomb', position: [1, 1], animation });
      expect(sceneObjectClassName(object)).toContain(`is-anim-${animation}`);
    });
    const none = validateObject({ id: 'x', type: 'bomb', position: [1, 1], animation: 'none' });
    expect(sceneObjectClassName(none)).not.toContain('is-anim');
  });
});

describe('unsafe presentation values never reach the renderer', () => {
  it('rejects colors that could carry an expression or external resource', () => {
    ['rgb(1,2,3)', 'url(https://x/y.png)', 'var(--brand-lime)', 'red;background:url(x)'].forEach(color => {
      expect(() => validateObject({ id: 'x', type: 'wall', position: [1, 1], color })).toThrow('invalid-game-state');
    });
  });

  it('rejects shapes and animations outside the controlled sets', () => {
    expect(() => validateObject({ id: 'x', type: 'wall', position: [1, 1], shape: 'sprite' })).toThrow();
    expect(() => validateObject({ id: 'x', type: 'wall', position: [1, 1], animation: 'explode' })).toThrow();
  });

  it('rejects out-of-range numbers instead of silently clamping', () => {
    [
      { opacity: 0 },
      { opacity: 2 },
      { rotation: 720 },
      { zIndex: 10 },
      { zIndex: 1.5 },
      { size: [0, 1] },
      { size: [5, 1] },
      { size: [1] },
    ].forEach(patch => {
      expect(() => validateObject({ id: 'x', type: 'wall', position: [1, 1], ...patch })).toThrow();
    });
  });

  it('does not accept markup or handlers smuggled through a label', () => {
    const object = validateObject({ id: 'x', type: 'wall', position: [1, 1], label: '<img onerror=1>' });
    // label 会被截断到 4 个字符，并且是作为文本节点渲染，不是 innerHTML
    expect(object.label).toBe('<img');
  });
});
