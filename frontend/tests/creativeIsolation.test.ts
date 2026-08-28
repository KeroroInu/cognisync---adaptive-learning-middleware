import { describe, expect, it, vi } from 'vitest';

import {
  applyCreativeCards,
  validateSceneState,
  type CreativeExecutionResult,
  type PythonGameState,
} from '../services/pythonModuleRunner';
import type { StudentCreativeFunction } from '../data/snakeCreativeFunctions';

/**
 * 主线程永远不信任 Worker 返回值：学生代码可以返回任何东西。
 * 这组用例锁定「什么会被拒绝」和「一张卡失败时其余卡片与基础游戏怎样继续」。
 */
const VALID: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
};

const state = (patch: Record<string, unknown>) => ({ ...VALID, ...patch });

describe('validateSceneState rejects unsafe worker output', () => {
  it('accepts the minimal valid state', () => {
    expect(validateSceneState(VALID)).toEqual(VALID);
  });

  it('rejects non-objects and missing core fields', () => {
    [null, undefined, 'state', 42, [], {}].forEach(value => {
      expect(() => validateSceneState(value)).toThrow('invalid-game-state');
    });
    expect(() => validateSceneState(state({ snake: [] }))).toThrow();
    expect(() => validateSceneState(state({ direction: 'sideways' }))).toThrow();
    expect(() => validateSceneState(state({ game_over: 'yes' }))).toThrow();
  });

  it('rejects coordinates that are not integer pairs', () => {
    [[[1]], [[1, 2, 3]], [['a', 2]], [[1.5, 2]], [[1, 9999]]].forEach(snake => {
      expect(() => validateSceneState(state({ snake }))).toThrow();
    });
    expect(() => validateSceneState(state({ food: [1] }))).toThrow();
  });

  it('bounds the snake length and score', () => {
    const long = Array.from({ length: 401 }, (_, index) => [index % 12, 0]);
    expect(() => validateSceneState(state({ snake: long }))).toThrow();
    expect(() => validateSceneState(state({ score: -1 }))).toThrow();
    expect(() => validateSceneState(state({ score: 1_000_001 }))).toThrow();
    expect(() => validateSceneState(state({ score: 1.5 }))).toThrow();
  });

  it('keeps the interval inside the playable range', () => {
    expect(validateSceneState(state({ interval: 0.5 })).interval).toBe(0.5);
    [0.01, 5, Number.NaN, Number.POSITIVE_INFINITY, '0.3'].forEach(interval => {
      expect(() => validateSceneState(state({ interval }))).toThrow();
    });
  });

  it('caps the object count and keeps ids and types renderable', () => {
    const many = Array.from({ length: 49 }, (_, index) => ({
      id: `o${index}`, type: 'wall', position: [index % 12, 0],
    }));
    expect(() => validateSceneState(state({ objects: many }))).toThrow();

    ['wall!', '<script>', 'x'.repeat(25), 'wall type'].forEach(type => {
      expect(() => validateSceneState(state({ objects: [{ id: 'a', type, position: [1, 1] }] }))).toThrow();
    });

    // 大小写是宽容处理而不是拒绝：type 只用于选择样式，统一小写即可
    const normalised = validateSceneState(state({ objects: [{ id: 'a', type: 'Wall', position: [1, 1] }] }));
    expect(normalised.objects?.[0].type).toBe('wall');
  });

  it('rejects objects outside the board', () => {
    [[-1, 0], [12, 0], [0, 12]].forEach(position => {
      expect(() => validateSceneState(state({ objects: [{ id: 'a', type: 'wall', position }] }))).toThrow();
    });
  });

  it('truncates labels instead of letting long text into the board', () => {
    const validated = validateSceneState(state({
      objects: [{ id: 'a', type: 'wall', position: [1, 1], label: '很长的一段文字' }],
    }));
    expect(validated.objects?.[0].label).toBe('很长的一');
  });

  it('bounds object data entries', () => {
    const tooMany = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, 1]));
    expect(() => validateSceneState(state({
      objects: [{ id: 'a', type: 'wall', position: [1, 1], data: tooMany }],
    }))).toThrow();

    expect(() => validateSceneState(state({
      objects: [{ id: 'a', type: 'wall', position: [1, 1], data: { ok: 'x'.repeat(81) } }],
    }))).toThrow();

    expect(() => validateSceneState(state({
      objects: [{ id: 'a', type: 'wall', position: [1, 1], data: { nested: { a: 1 } } }],
    }))).toThrow();
  });

  it('validates v2 timers', () => {
    expect(validateSceneState(state({ timers: { fuse: 3 } })).timers).toEqual({ fuse: 3 });
    [
      { timers: [] },
      // Worker 的返回值经过 JSON.parse，__proto__ 会成为**自有属性**，
      // 用对象字面量写这一条测不到真实威胁模型
      { timers: JSON.parse('{"__proto__": 1}') },
      { timers: { 'bad id': 1 } },
      { timers: { ok: -1 } },
      { timers: { ok: 1.5 } },
      { timers: { ok: 100_001 } },
      { timers: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`t${i}`, 1])) },
    ].forEach(patch => {
      expect(() => validateSceneState(state(patch))).toThrow();
    });
  });

  it('drops fields the runner does not own', () => {
    const validated = validateSceneState({ ...VALID, weather: 'rain' } as unknown);
    expect('weather' in validated).toBe(false);
  });
});

// ── 逐卡异常隔离 ─────────────────────────────────────────────────────────────

const card = (id: string, patch: Partial<StudentCreativeFunction> = {}): StudentCreativeFunction => ({
  id,
  title: id,
  hook: 'any',
  code: 'def creative_feature(event, state):\n    return state',
  enabled: true,
  verified: true,
  updatedAt: '2026-08-28T00:00:00.000Z',
  ...patch,
});

const ok = (patch: Partial<PythonGameState>): CreativeExecutionResult => ({
  passed: true,
  resultCode: 'PASSED',
  detail: '',
  state: { ...VALID, ...patch },
});

describe('per-card isolation', () => {
  it('keeps later cards running after one throws', async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('execution-timeout'))
      .mockResolvedValueOnce(ok({ score: 30 }));

    const result = await applyCreativeCards(
      [card('a'), card('b')], 'loop', VALID, {}, execute,
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual([{ cardId: 'a', resultCode: 'execution-timeout', detail: '' }]);
    expect(result.state.score).toBe(30);
  });

  it('discards the state of a card that failed inside python', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({
        passed: false,
        resultCode: 'RUNTIME_ERROR',
        detail: 'ZeroDivisionError: division by zero',
        state: { ...VALID, score: 999 },
      })
      .mockResolvedValueOnce(ok({ score: 10 }));

    const result = await applyCreativeCards([card('a'), card('b')], 'loop', VALID, {}, execute);

    expect(result.errors[0].resultCode).toBe('RUNTIME_ERROR');
    expect(result.state.score).toBe(10);
  });

  it('rejects a card whose state fails main-thread validation', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ passed: true, resultCode: 'PASSED', detail: '', state: { ...VALID, score: -5 } })
      .mockResolvedValueOnce(ok({ score: 20 }));

    const result = await applyCreativeCards([card('a'), card('b')], 'loop', VALID, {}, execute);

    expect(result.errors).toEqual([{ cardId: 'a', resultCode: 'CREATIVE_STATE', detail: '' }]);
    // 后一张卡拿到的是最后一次通过校验的状态，而不是被拒绝的那份
    expect(execute.mock.calls[1][1].score).toBe(0);
    expect(result.state.score).toBe(20);
  });

  it('never lets one failing card stop the base game state', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('python-worker-error'));
    const result = await applyCreativeCards([card('a'), card('b')], 'loop', VALID, {}, execute);
    expect(result.errors).toHaveLength(2);
    expect(result.state).toEqual(VALID);
  });

  it('skips cards that are disabled or not verified', async () => {
    const execute = vi.fn().mockResolvedValue(ok({ score: 1 }));
    await applyCreativeCards(
      [card('a', { enabled: false }), card('b', { verified: false }), card('c')],
      'loop', VALID, {}, execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('only runs cards bound to this hook unless the code routes events itself', async () => {
    const execute = vi.fn().mockResolvedValue(ok({ score: 1 }));
    await applyCreativeCards(
      [
        card('matching', { hook: 'food_eaten' }),
        card('other', { hook: 'game_start' }),
        card('router', {
          hook: 'game_start',
          code: "def creative_feature(event, state):\n    if event.get('type') == 'eat':\n        pass\n    return state",
        }),
      ],
      'food_eaten', VALID, {}, execute,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('collects per-card terminal output', async () => {
    const execute = vi.fn().mockResolvedValue({ ...ok({ score: 1 }), output: ['hello'] });
    const result = await applyCreativeCards([card('a')], 'loop', VALID, {}, execute);
    expect(result.outputs).toEqual([{ cardId: 'a', hook: 'loop', lines: ['hello'] }]);
  });

  it('passes the published event type to every card', async () => {
    const execute = vi.fn().mockResolvedValue(ok({ score: 1 }));
    await applyCreativeCards([card('a')], 'food_eaten', VALID, { scoreBefore: 0, scoreAfter: 10 }, execute);
    expect(execute.mock.calls[0][2]).toMatchObject({
      type: 'eat',
      hook: 'food_eaten',
      scoreBefore: 0,
      scoreAfter: 10,
    });
  });
});
