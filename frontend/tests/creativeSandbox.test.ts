import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  advanceCreativeTimers,
  buildCreativeHarnessSource,
  getCreativeSeed,
  setCreativeSeed,
  type PythonCreativeHookEvent,
  type PythonGameState,
} from '../services/pythonModuleRunner';

/**
 * 沙箱能力的**真实执行**测试。
 *
 * 这里运行的就是浏览器 Worker 里那份沙箱源码（`buildCreativeHarnessSource`），
 * 只是把最后一行的载荷打印出来，用本机 CPython 执行。Pyodide 与 CPython 在
 * 这些标准库语义上一致，因此它能真正验证帮助函数行为、确定性随机和安全拦截，
 * 而不是只断言「我拼出的字符串里出现了这些字样」。
 *
 * 没有 python3 时整组跳过，不把环境缺失伪装成通过。
 */
const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const BASE_STATE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
  interval: 0.36,
  objects: [],
};

const EVENT: PythonCreativeHookEvent = { type: 'loop', hook: 'loop' };

interface HarnessResult {
  passed: boolean;
  resultCode: string;
  detail: string;
  state?: PythonGameState;
  output?: string[];
}

const runSandbox = (
  code: string,
  state: PythonGameState = BASE_STATE,
  seed = 12345,
  sequence = 0,
): HarnessResult => {
  const source = buildCreativeHarnessSource(code, state, EVENT, seed, sequence);
  // 沙箱源码最后一行是载荷表达式（Pyodide 取表达式值）；CPython 下打印出来即可。
  const runnable = `${source}\nprint(_creative_payload)\n`;
  const file = join(mkdtempSync(join(tmpdir(), 'cognisync-sandbox-')), 'harness.py');
  writeFileSync(file, runnable, 'utf-8');
  const stdout = execFileSync('python3', [file], { encoding: 'utf-8' });
  return JSON.parse(stdout.trim().split('\n').pop() as string) as HarnessResult;
};

describe.skipIf(!hasPython)('creative sandbox helpers run for real', () => {
  it('injects every helper without import', () => {
    const result = runSandbox(`def creative_feature(event, state):
    names = [randint, choice, random_empty_cell, add_object, remove_object, move_object, find_objects, set_timer, timer_ready]
    state['score'] = len(names)
    return state`);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.score).toBe(9);
  });

  it('produces the same random sequence for the same seed', () => {
    const code = `def creative_feature(event, state):
    state['score'] = randint(0, 1000000)
    return state`;
    const first = runSandbox(code, BASE_STATE, 4242, 0);
    const second = runSandbox(code, BASE_STATE, 4242, 0);
    const other = runSandbox(code, BASE_STATE, 99, 0);
    expect(first.state?.score).toBe(second.state?.score);
    expect(first.state?.score).not.toBe(other.state?.score);
  });

  it('advances the sequence so repeated calls in one run differ', () => {
    const code = `def creative_feature(event, state):
    state['score'] = randint(0, 1000000)
    return state`;
    const tick0 = runSandbox(code, BASE_STATE, 4242, 0);
    const tick1 = runSandbox(code, BASE_STATE, 4242, 1);
    expect(tick0.state?.score).not.toBe(tick1.state?.score);
  });

  it('keeps random_empty_cell off the snake, food, solid objects and board edge', () => {
    const state: PythonGameState = {
      ...BASE_STATE,
      objects: [{ id: 'w1', type: 'wall', position: [1, 1], solid: true }],
    };
    const result = runSandbox(`def creative_feature(event, state):
    picks = []
    for _ in range(60):
        cell = random_empty_cell(state)
        picks.append(cell)
    blocked = [list(p) for p in state['snake']] + [list(state['food']), [1, 1]]
    bad = [c for c in picks if c is None or c in blocked or not (0 <= c[0] < 12 and 0 <= c[1] < 12)]
    state['score'] = len(bad)
    return state`, state);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.score).toBe(0);
  });

  it('returns None from random_empty_cell when the board is full', () => {
    const full: PythonGameState = {
      ...BASE_STATE,
      snake: Array.from({ length: 144 }, (_, index) => [index % 12, Math.floor(index / 12)]),
    };
    const result = runSandbox(`def creative_feature(event, state):
    state['score'] = 1 if random_empty_cell(state) is None else 0
    return state`, full);
    expect(result.state?.score).toBe(1);
  });

  it('adds objects with generated ids and rejects invalid specs without writing', () => {
    const result = runSandbox(`def creative_feature(event, state):
    first = add_object(state, {'type': 'bomb', 'position': [2, 3]})
    second = add_object(state, {'type': 'bomb', 'position': [4, 3]})
    rejected = [
        add_object(state, {'type': 'bomb', 'position': [99, 3]}),
        add_object(state, {'type': 'Bomb', 'position': [1, 1]}),
        add_object(state, {'type': 'bomb', 'position': 'nope'}),
        add_object(state, 'not-a-dict'),
    ]
    state['score'] = len([item for item in rejected if item is None])
    print(first['id'], second['id'])
    return state`);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.objects).toHaveLength(2);
    expect(result.state?.score).toBe(4);
    expect(result.output?.[0]).toBe('bomb-1 bomb-2');
  });

  it('stops adding objects at the scene limit', () => {
    const result = runSandbox(`def creative_feature(event, state):
    added = 0
    for index in range(60):
        if add_object(state, {'type': 'wall', 'position': [index % 12, index // 12]}) is not None:
            added += 1
    state['score'] = added
    return state`);
    expect(result.state?.score).toBe(48);
    expect(result.state?.objects).toHaveLength(48);
  });

  it('moves, finds and removes objects', () => {
    const result = runSandbox(`def creative_feature(event, state):
    add_object(state, {'id': 'b1', 'type': 'bomb', 'position': [2, 2]})
    add_object(state, {'id': 'w1', 'type': 'wall', 'position': [3, 3]})
    moved = move_object(state, 'b1', [5, 6])
    off_board = move_object(state, 'b1', [50, 6])
    missing = move_object(state, 'nope', [1, 1])
    bombs = find_objects(state, 'bomb')
    removed = remove_object(state, 'w1')
    removed_twice = remove_object(state, 'w1')
    state['score'] = int(moved) + int(not off_board) + int(not missing) + len(bombs) + int(removed) + int(not removed_twice)
    return state`);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.score).toBe(6);
    expect(result.state?.objects).toEqual([
      { id: 'b1', type: 'bomb', position: [5, 6] },
    ]);
  });

  it('counts timers down through the platform, not student code', () => {
    const armed = runSandbox(`def creative_feature(event, state):
    set_timer(state, 'fuse', 2)
    state['score'] = 1 if timer_ready(state, 'fuse') else 0
    return state`);
    expect(armed.state?.timers).toEqual({ fuse: 2 });
    expect(armed.state?.score).toBe(0);

    // 平台推进两帧后才 ready
    const afterOne = advanceCreativeTimers(armed.state as PythonGameState);
    const afterTwo = advanceCreativeTimers(afterOne);
    expect(afterTwo.timers).toEqual({ fuse: 0 });

    const ready = runSandbox(`def creative_feature(event, state):
    state['score'] = 1 if timer_ready(state, 'fuse') else 0
    return state`, afterTwo as PythonGameState);
    expect(ready.state?.score).toBe(1);
  });

  it('rejects unsafe timer ids and out-of-range ticks', () => {
    const result = runSandbox(`def creative_feature(event, state):
    results = [
        set_timer(state, 'ok_1', 3),
        set_timer(state, '__proto__', 3),
        set_timer(state, 'bad id', 3),
        set_timer(state, 'neg', -1),
        set_timer(state, 'huge', 999999999),
    ]
    state['score'] = len([item for item in results if item])
    return state`);
    expect(result.state?.score).toBe(1);
    expect(result.state?.timers).toEqual({ ok_1: 3 });
  });

  it('caps the number of timers', () => {
    const result = runSandbox(`def creative_feature(event, state):
    accepted = 0
    for index in range(30):
        if set_timer(state, 'timer-' + str(index), 5):
            accepted += 1
    state['score'] = accepted
    return state`);
    expect(result.state?.score).toBe(16);
  });

  it('still blocks imports, file access and dunder attributes', () => {
    expect(runSandbox(`import os
def creative_feature(event, state):
    return state`).resultCode).toBe('CREATIVE_RESTRICTED');
    expect(runSandbox(`def creative_feature(event, state):
    open('/etc/passwd')
    return state`).resultCode).toBe('CREATIVE_RESTRICTED');
    expect(runSandbox(`def creative_feature(event, state):
    return state.__class__`).resultCode).toBe('CREATIVE_RESTRICTED');
  });

  it('does not let helpers become an escape hatch to the host', () => {
    // find_objects 返回的是状态里的普通字典：能 .get()、能改字段，
    // 但没有宿主对象、没有类型反射入口（沙箱也不提供 isinstance/type）。
    const result = runSandbox(`def creative_feature(event, state):
    add_object(state, {'type': 'wall', 'position': [1, 1]})
    item = find_objects(state)[0]
    item['label'] = 'X'
    state['score'] = len(item.get('type'))
    return state`);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.score).toBe(4);
    expect(result.state?.objects?.[0].label).toBe('X');
  });

  it('keeps the builtin whitelist closed', () => {
    // 这条锁定的是既有边界：沙箱不提供 isinstance/type/dir 等反射入口。
    // 想放开必须是明确的能力决策，并同步更新 Agent 的能力描述。
    const result = runSandbox(`def creative_feature(event, state):
    state['score'] = 1 if isinstance(state, dict) else 0
    return state`);
    expect(result.resultCode).toBe('RUNTIME_ERROR');
    expect(result.detail).toContain('isinstance');
  });

  it('rejects a state key that the runner cannot render', () => {
    const result = runSandbox(`def creative_feature(event, state):
    state['weather'] = 'rain'
    return state`);
    expect(result.resultCode).toBe('CREATIVE_UNSUPPORTED_STATE');
    // 必须指出具体是哪个字段，否则学生只能逐行猜
    expect(result.detail).toContain('weather');
  });

  it('names every unsupported key, which is how the bomb_count counter fails', () => {
    // 真实课堂案例：学生把倒计时存进自造的顶层字段，代码看起来没问题却永远不生效
    const result = runSandbox(`def creative_feature(event, state):
    state['bomb_count'] = 0
    return state`);
    expect(result.resultCode).toBe('CREATIVE_UNSUPPORTED_STATE');
    expect(result.detail).toContain('bomb_count');
  });

  it.each([
    ["state['bomb_time'] = 3", 'assign'],
    ["state['bomb_time'] += 1", 'augmented assign'],
    ["state['bomb_time']: int = 3", 'annotated assign'],
    ["state.setdefault('bomb_time', 3)", 'setdefault'],
    ["state.update({'bomb_time': 3})", 'dict update'],
    ["state.update(bomb_time=3)", 'keyword update'],
  ])('rejects a literal unsupported state write before an unreachable branch runs: %s (%s)', (write) => {
    const result = runSandbox(`def creative_feature(event, state):
    if event.get('type') == 'move' and state['snake'][0] == [3, 3]:
        ${write}
    add_object(state, {'type': 'bomb', 'position': [3, 3]})
    return state`);
    expect(result.resultCode).toBe('CREATIVE_UNSUPPORTED_STATE');
    expect(result.detail).toContain('bomb_time');
  });

  it('does not pretend an unknown event name is a valid dormant branch', () => {
    const result = runSandbox(`def creative_feature(event, state):
    if event.get('type') == 'timer':
        state['score'] += 1
    add_object(state, {'type': 'bomb', 'position': [3, 3]})
    return state`);
    expect(result.resultCode).toBe('CREATIVE_UNKNOWN_EVENT');
    expect(result.detail).toContain('event.type=timer');
    expect(result.detail).toContain('start');
    expect(result.detail).toContain('end');
  });

  it('validates literal event sets and the internal hook vocabulary', () => {
    expect(runSandbox(`def creative_feature(event, state):
    if event['type'] in ('eat', 'timer'):
        pass
    state['score'] = 1
    return state`).resultCode).toBe('CREATIVE_UNKNOWN_EVENT');

    const badHook = runSandbox(`def creative_feature(event, state):
    if event.get('hook') == 'timer':
        pass
    state['score'] = 1
    return state`);
    expect(badHook.resultCode).toBe('CREATIVE_UNKNOWN_EVENT');
    expect(badHook.detail).toContain('event.hook=timer');
    expect(badHook.detail).toContain('food_eaten');
  });

  it('accepts every published event type and hook name', () => {
    const eventTypes = ['start', 'key', 'before_move', 'move', 'eat', 'loop', 'end'];
    const hooks = ['game_start', 'key_input', 'before_move', 'after_move', 'food_eaten', 'loop', 'game_end'];
    eventTypes.forEach(name => {
      expect(runSandbox(`def creative_feature(event, state):
    if event.get('type') == '${name}':
        pass
    state['score'] = 1
    return state`).resultCode).toBe('PASSED');
    });
    hooks.forEach(name => {
      expect(runSandbox(`def creative_feature(event, state):
    if event.get('hook') == '${name}':
        pass
    state['score'] = 1
    return state`).resultCode).toBe('PASSED');
    });
  });

  it('leaves dynamic state keys to the existing runtime check without a static false positive', () => {
    const result = runSandbox(`def creative_feature(event, state):
    key = 'bomb_time'
    if event.get('type') == 'move':
        state[key] = 3
    state['score'] = 1
    return state`);
    expect(result.resultCode).toBe('PASSED');
    expect(result.state?.score).toBe(1);
  });

  it('accepts timers as a first-class v2 state key', () => {
    expect(runSandbox(`def creative_feature(event, state):
    set_timer(state, 'x', 1)
    return state`).resultCode).toBe('PASSED');
  });
});

describe('creative timers advance deterministically on the main thread', () => {
  it('never counts below zero and leaves other fields untouched', () => {
    const state: PythonGameState = { ...BASE_STATE, timers: { a: 2, b: 0 } };
    const next = advanceCreativeTimers(state);
    expect(next.timers).toEqual({ a: 1, b: 0 });
    expect(next.snake).toBe(state.snake);
  });

  it('returns the same object when there is nothing to advance', () => {
    const state: PythonGameState = { ...BASE_STATE };
    expect(advanceCreativeTimers(state)).toBe(state);
    expect(advanceCreativeTimers({ ...state, timers: {} }).timers).toEqual({});
  });
});

describe('creative seed control', () => {
  it('resets the sequence and normalises the seed', () => {
    expect(setCreativeSeed(777)).toBe(777);
    expect(getCreativeSeed()).toBe(777);
    expect(setCreativeSeed(-5)).toBe(5);
    expect(setCreativeSeed(Number.NaN)).toBe(20260828);
  });
});
