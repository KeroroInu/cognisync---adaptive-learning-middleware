import { describe, expect, it } from 'vitest';

import {
  CREATIVE_CAPABILITY_GAPS,
  CREATIVE_CAPABILITY_VERSION,
  CREATIVE_EVENT_TYPES,
  CREATIVE_HELPERS,
  CREATIVE_HELPER_NAMES,
  CREATIVE_HOOK_EVENT_TYPES,
  CREATIVE_STATE_KEYS,
  CREATIVE_STATE_KEYS_V1,
  SCENE_ANIMATIONS,
  SCENE_DATA_KEY_PATTERN,
  SCENE_LIMITS,
  SCENE_SHAPES,
  SCENE_TYPE_PATTERN,
  TIMER_ID_PATTERN,
  isSafeSceneColor,
  resolveSceneColor,
} from '../data/creativeCapabilities';
import { CREATIVE_SAFE_BUILTIN_NAMES } from '../services/pythonModuleRunner';
import { SNAKE_CREATIVE_HOOKS } from '../data/snakeCreativeFunctions';

/**
 * 这些用例锁定的是**契约**，不是实现细节。
 * 任何一条失败都意味着历史创意卡可能被判非法，或者 Agent 会拿到与沙箱
 * 不一致的能力描述——两者都会直接影响正在进行的准实验数据。
 */
describe('creative capability contract v2', () => {
  it('keeps the seven published events and their order', () => {
    expect([...CREATIVE_EVENT_TYPES]).toEqual([
      'start', 'key', 'before_move', 'move', 'eat', 'loop', 'end',
    ]);
  });

  it('maps every legacy hook to a published event type', () => {
    const runtimeHooks = SNAKE_CREATIVE_HOOKS
      .map(option => option.id)
      .filter(id => id !== 'any');
    expect(Object.keys(CREATIVE_HOOK_EVENT_TYPES).sort()).toEqual([...runtimeHooks].sort());
    Object.values(CREATIVE_HOOK_EVENT_TYPES).forEach(eventType => {
      expect(CREATIVE_EVENT_TYPES).toContain(eventType);
    });
  });

  it('never drops a v1 state key', () => {
    // 删掉任何一个都会让历史卡在 CREATIVE_UNSUPPORTED_STATE 上失败
    expect([...CREATIVE_STATE_KEYS_V1]).toEqual([
      'snake', 'direction', 'food', 'score', 'game_over', 'interval', 'objects',
    ]);
    CREATIVE_STATE_KEYS_V1.forEach(key => expect(CREATIVE_STATE_KEYS).toContain(key));
  });

  it('adds v2 keys on top of v1 instead of replacing them', () => {
    expect(CREATIVE_STATE_KEYS.length).toBeGreaterThan(CREATIVE_STATE_KEYS_V1.length);
    expect(CREATIVE_STATE_KEYS).toContain('timers');
  });

  it('declares a capability version that research records can pin to', () => {
    expect(CREATIVE_CAPABILITY_VERSION).toBe('creative-v2');
  });
});

describe('creative helper registry', () => {
  it('exposes the first capability batch with unique names', () => {
    expect(CREATIVE_HELPER_NAMES).toEqual([
      'randint', 'choice', 'random_empty_cell', 'add_object', 'remove_object',
      'move_object', 'find_objects', 'set_timer', 'timer_ready',
    ]);
    expect(new Set(CREATIVE_HELPER_NAMES).size).toBe(CREATIVE_HELPER_NAMES.length);
  });

  it('never shadows a safe builtin', () => {
    // 帮助函数与内置名冲突会让学生代码行为依赖注入顺序
    CREATIVE_HELPER_NAMES.forEach(name => {
      expect(CREATIVE_SAFE_BUILTIN_NAMES).not.toContain(name);
    });
  });

  it('only reads and writes declared state keys', () => {
    CREATIVE_HELPERS.forEach(helper => {
      [...helper.reads, ...helper.writes].forEach(key => {
        expect(CREATIVE_STATE_KEYS).toContain(key);
      });
    });
  });

  it('marks exactly the random-consuming helpers', () => {
    const random = CREATIVE_HELPERS.filter(helper => helper.usesRandom).map(helper => helper.name);
    expect(random).toEqual(['randint', 'choice', 'random_empty_cell']);
  });

  it('gives every helper a signature and bilingual summary', () => {
    CREATIVE_HELPERS.forEach(helper => {
      expect(helper.signature.startsWith(`${helper.name}(`)).toBe(true);
      expect(helper.summaryZh.length).toBeGreaterThan(4);
      expect(helper.summaryEn.length).toBeGreaterThan(4);
    });
  });
});

describe('scene object schema', () => {
  it('keeps v1 object fields renderable without any new field', () => {
    const legacyObject = {
      id: 'obstacle-1',
      type: 'obstacle',
      position: [3, 4],
      label: '石',
      solid: true,
      active: true,
      data: { hits: 2 },
    };
    expect(SCENE_TYPE_PATTERN.test(legacyObject.type)).toBe(true);
    expect(legacyObject.label.length).toBeLessThanOrEqual(SCENE_LIMITS.maxLabelChars);
    expect(SCENE_DATA_KEY_PATTERN.test('hits')).toBe(true);
  });

  it('accepts an unknown type so new ideas need no new component', () => {
    expect(SCENE_TYPE_PATTERN.test('teleport_beacon')).toBe(true);
    expect(SCENE_TYPE_PATTERN.test('lava-pit')).toBe(true);
  });

  it('rejects type strings that could break out of a class name', () => {
    ['Obstacle', 'obs tacle', 'obstacle"', '<script>', 'a'.repeat(25), ''].forEach(type => {
      expect(SCENE_TYPE_PATTERN.test(type)).toBe(false);
    });
  });

  it('allows only hex and registry colors', () => {
    ['#fff', '#BDF52F', 'lime', 'clay'].forEach(color => {
      expect(isSafeSceneColor(color)).toBe(true);
    });
    [
      'rgb(1,2,3)',
      'var(--brand-lime)',
      'url(https://example.com/a.png)',
      'red; background: url(x)',
      '#12345',
      '',
      42,
      null,
    ].forEach(color => {
      expect(isSafeSceneColor(color)).toBe(false);
    });
  });

  it('resolves named colors and passes hex through untouched', () => {
    expect(resolveSceneColor('lime')).toBe('#bdf52f');
    expect(resolveSceneColor('#123456')).toBe('#123456');
  });

  it('restricts shapes and animations to the controlled sets', () => {
    expect([...SCENE_SHAPES]).toEqual(['rect', 'circle', 'line', 'text']);
    expect([...SCENE_ANIMATIONS]).toEqual(['none', 'pulse', 'blink', 'spin']);
  });

  it('keeps the v1 object budget so low-end classroom machines stay usable', () => {
    expect(SCENE_LIMITS.maxObjects).toBe(48);
    expect(SCENE_LIMITS.boardSize).toBe(12);
    expect(SCENE_LIMITS.maxLabelChars).toBe(4);
    expect(SCENE_LIMITS.minInterval).toBe(0.08);
    expect(SCENE_LIMITS.maxInterval).toBe(2);
  });

  it('bounds every new v2 numeric field', () => {
    expect(SCENE_LIMITS.minOpacity).toBeGreaterThan(0);
    expect(SCENE_LIMITS.maxOpacity).toBe(1);
    expect(SCENE_LIMITS.maxZIndex).toBeLessThan(10);
    expect(SCENE_LIMITS.maxSize).toBeLessThanOrEqual(SCENE_LIMITS.boardSize);
    expect(SCENE_LIMITS.maxTimers).toBeLessThanOrEqual(SCENE_LIMITS.maxObjects);
  });

  it('accepts sane timer ids only', () => {
    expect(TIMER_ID_PATTERN.test('bomb_fuse')).toBe(true);
    expect(TIMER_ID_PATTERN.test('t-1')).toBe(true);
    ['', 'a'.repeat(33), 'bad id', '__proto__'].forEach(id => {
      expect(TIMER_ID_PATTERN.test(id)).toBe(false);
    });
  });
});

describe('declared capability gaps', () => {
  it('states the gaps the agent must not paper over', () => {
    ['network', 'file-system', '3d', 'realtime-multiplayer'].forEach(gap => {
      expect(CREATIVE_CAPABILITY_GAPS).toContain(gap);
    });
  });
});
