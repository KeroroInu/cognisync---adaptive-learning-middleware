import type { Language } from '../types';
import type { SnakeCreativeHook, StudentCreativeFunction } from '../data/snakeCreativeFunctions';
import { CREATIVE_FUNCTION_NAME, usesCreativeEventRouting } from '../data/snakeCreativeFunctions';
import { CREATIVE_HELPERS, CREATIVE_HOOK_EVENT_TYPES, CREATIVE_STATE_KEYS, SCENE_LIMITS, SCENE_TYPE_PATTERN, TIMER_ID_PATTERN } from '../data/creativeCapabilities';

export interface PythonModuleTestResult {
  passed: boolean;
  resultCode: string;
  detail: string;
  durationMs: number;
  preview?: PythonModulePreview;
  output?: string[];
  /** 本次测试使用的随机种子，进入研究证据以便复现 */
  seed?: number;
}

export interface PythonModulePreview {
  snake?: number[][];
  food?: number[];
  direction?: 'up' | 'down' | 'left' | 'right';
  score?: number;
  over?: boolean;
  interval?: number;
  objects?: PythonGameObject[];
}

export interface PythonGameObject {
  id: string;
  type: string;
  position: number[];
  label?: string;
  solid?: boolean;
  active?: boolean;
  data?: Record<string, string | number | boolean>;
}

export interface PythonGameState {
  snake: number[][];
  direction: 'up' | 'down' | 'left' | 'right';
  food: number[];
  score: number;
  game_over: boolean;
  /** Optional game-loop interval in seconds. Creative hooks may adjust it. */
  interval?: number;
  /** Safe, renderer-owned objects for obstacles, bombs, portals, bonuses, etc. */
  objects?: PythonGameObject[];
  /** V2: per-tick countdown timers keyed by student-chosen ids. */
  timers?: Record<string, number>;
}

export interface PythonCreativeHookEvent {
  /** Student-facing event name: start/key/before_move/move/eat/loop/end. */
  type: string;
  /** Stable internal hook name retained for compatibility and research records. */
  hook: Exclude<SnakeCreativeHook, 'any'>;
  input?: PythonGameState['direction'] | null;
  scoreBefore?: number;
  scoreAfter?: number;
}

export interface PythonCreativeHookError {
  cardId: string;
  resultCode: string;
  detail: string;
}

export interface PythonCreativeHookResult {
  state: PythonGameState;
  errors: PythonCreativeHookError[];
  outputs: Array<{ cardId: string; hook: SnakeCreativeHook; lines: string[] }>;
}

export interface PythonMazeTestResult {
  passed: boolean;
  resultCode: string;
  detail: string;
  durationMs: number;
  path: number[][];
  output: string[];
}

export interface PythonMazeConfig {
  boardSize: number;
  start: number[];
  goal: number[];
  walls: number[][];
  maxSteps?: number;
}

interface WorkerResponse {
  type: 'runtime-loading' | 'executing' | 'result' | 'error';
  id?: string;
  result?: string;
  message?: string;
}

interface PendingRun {
  id: string;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  bootstrapTimer: ReturnType<typeof setTimeout>;
  executionTimer?: ReturnType<typeof setTimeout>;
}

const PYODIDE_BOOTSTRAP_TIMEOUT_MS = 45_000;
const PYTHON_EXECUTION_TIMEOUT_MS = 5_000;
let moduleWorker: Worker | null = null;
let pendingRun: PendingRun | null = null;
let runnerGeneration = 0;
let runQueue: Promise<void> = Promise.resolve();

const stopWorker = () => {
  moduleWorker?.terminate();
  moduleWorker = null;
};

const clearPendingTimers = (pending: PendingRun) => {
  clearTimeout(pending.bootstrapTimer);
  if (pending.executionTimer) clearTimeout(pending.executionTimer);
};

const rejectPending = (error: Error) => {
  if (!pendingRun) return;
  const pending = pendingRun;
  pendingRun = null;
  clearPendingTimers(pending);
  pending.reject(error);
};

const getWorker = () => {
  if (moduleWorker) return moduleWorker;
  moduleWorker = new Worker(new URL('../workers/pythonModuleWorker.ts', import.meta.url));
  moduleWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (!pendingRun || (message.id && message.id !== pendingRun.id)) return;
    if (message.type === 'executing') {
      clearTimeout(pendingRun.bootstrapTimer);
      pendingRun.executionTimer = setTimeout(() => {
        stopWorker();
        rejectPending(new Error('execution-timeout'));
      }, PYTHON_EXECUTION_TIMEOUT_MS);
      return;
    }
    if (message.type === 'result') {
      const pending = pendingRun;
      pendingRun = null;
      clearPendingTimers(pending);
      pending.resolve(message.result ?? '');
      return;
    }
    if (message.type === 'error') rejectPending(new Error(message.message || 'python-runtime-error'));
  };
  moduleWorker.onerror = () => {
    stopWorker();
    rejectPending(new Error('python-worker-error'));
  };
  return moduleWorker;
};

const executeSource = (source: string, generation: number) => new Promise<string>((resolve, reject) => {
  if (generation !== runnerGeneration) {
    reject(new Error('runner-disposed'));
    return;
  }
  const id = `python-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bootstrapTimer = setTimeout(() => {
    stopWorker();
    rejectPending(new Error('runtime-load-timeout'));
  }, PYODIDE_BOOTSTRAP_TIMEOUT_MS);
  pendingRun = { id, resolve, reject, bootstrapTimer };
  getWorker().postMessage({ id, source });
});

/** 单函数测试和游戏帧共用一个 Worker，队列串行执行，Pyodide 只加载一次。 */
const runPythonJson = <T,>(source: string): Promise<T> => {
  const generation = runnerGeneration;
  const operation = runQueue.then(async () => {
    const raw = await executeSource(source, generation);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error('invalid-python-result');
    }
  });
  runQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

const FUNCTION_NAMES: Record<string, string> = {
  'initial-state': 'create_initial_state',
  'direction-input': 'change_direction',
  movement: 'move_snake',
  'food-spawn': 'spawn_food',
  'eat-grow-score': 'apply_food_effect',
  collision: 'check_collision',
  'game-loop': 'step_game',
};

// 这些是浏览器内可执行的本地行为检查，不是教师蓝图中的正式隐藏用例。
// 教师测试输入、期望值与规则不会通过学生 API 下发；界面也只显示短问题。
const LOCAL_BEHAVIOR_CHECKS: Record<string, string> = {
  'initial-state': `
_state = _fn()
_require(isinstance(_state, (tuple, list)) and len(_state) == 3, 'INITIAL_RETURN')
_snake, _direction, _score = _state
_require(isinstance(_snake, (tuple, list)) and len(_snake) >= 2, 'INITIAL_SNAKE')
_require(all(isinstance(_point, (tuple, list)) and len(_point) == 2 for _point in _snake), 'INITIAL_COORDINATES')
_require(all(isinstance(_point[0], int) and isinstance(_point[1], int) and 0 <= _point[0] < 12 and 0 <= _point[1] < 12 for _point in _snake), 'INITIAL_BOUNDARY')
_require(_direction in ('up', 'down', 'left', 'right'), 'INITIAL_DIRECTION')
_require(_score == 0, 'INITIAL_SCORE')
_preview = {'snake': _snake, 'direction': _direction, 'score': _score}`,
  'direction-input': `
_next_direction = _fn('right', 'up')
_require(_next_direction == 'up', 'DIRECTION_CHANGE')
_require(_fn('right', 'left') == 'right', 'DIRECTION_OPPOSITE')
_require(_fn('up', 'down') == 'up', 'DIRECTION_OPPOSITE')
_preview = {'direction': _next_direction}`,
  movement: `
_moved = _fn([(2, 2), (1, 2), (0, 2)], 'right')
_require(isinstance(_moved, (tuple, list)), 'MOVEMENT_RETURN')
_require([tuple(_point) for _point in _moved] == [(3, 2), (2, 2), (1, 2)], 'MOVEMENT_STEP')
_preview = {'snake': _moved}`,
  'food-spawn': `
_snake = [(1, 1), (1, 2), (1, 3)]
for _index in range(6):
    _food = _fn(_snake, 8)
    _require(isinstance(_food, (tuple, list)) and len(_food) == 2, 'FOOD_RETURN')
    _x, _y = _food
    _require(isinstance(_x, int) and isinstance(_y, int) and 0 <= _x < 8 and 0 <= _y < 8, 'FOOD_BOUNDARY')
    _require(tuple(_food) not in [tuple(_point) for _point in _snake], 'FOOD_OVERLAP')
_preview = {'food': _food}`,
  'eat-grow-score': `
_snake = [(2, 2), (1, 2), (0, 2)]
_grown_result = _fn(list(_snake), (2, 2), 0)
_require(isinstance(_grown_result, (tuple, list)) and len(_grown_result) in (2, 3), 'EAT_RETURN')
_grown, _score = _grown_result[:2]
_require(len(_grown) == 4 and _score == 10, 'EAT_GROW_SCORE')
_same_result = _fn(list(_snake), (7, 7), 0)
_require(isinstance(_same_result, (tuple, list)) and len(_same_result) in (2, 3), 'EAT_RETURN')
_same, _same_score = _same_result[:2]
_require(len(_same) == 3 and _same_score == 0, 'EAT_NO_CHANGE')
_preview = {'snake': _grown, 'food': (2, 2), 'score': _score}`,
  collision: `
_collision = bool(_fn([(-1, 2), (0, 2), (1, 2)], 10))
_require(_collision, 'COLLISION_BOUNDARY')
_require(bool(_fn([(2, 2), (2, 3), (2, 2)], 10)), 'COLLISION_SELF')
_require(not bool(_fn([(3, 2), (2, 2), (1, 2)], 10)), 'COLLISION_NORMAL')
_preview = {'snake': [(0, 2), (1, 2), (2, 2)], 'over': _collision}`,
  'game-loop': `
_dependencies = ('create_initial_state', 'change_direction', 'move_snake', 'spawn_food', 'apply_food_effect', 'check_collision')
_require(all(callable(_namespace.get(_name)) for _name in _dependencies), 'LOOP_DEPENDENCIES')
_state = {'snake': [(6, 5), (5, 5), (4, 5)], 'direction': 'right', 'food': (10, 10), 'score': 0, 'game_over': False}
_next = _fn(_state, None)
_require(isinstance(_next, dict), 'LOOP_RETURN')
_require(all(_key in _next for _key in ('snake', 'direction', 'food', 'score', 'game_over')), 'LOOP_STATE')
_require([tuple(_point) for _point in _next['snake']] == [(7, 5), (6, 5), (5, 5)], 'LOOP_ONE_TICK')
_require(_next['direction'] == 'right' and _next['score'] == 0 and not bool(_next['game_over']), 'LOOP_STATE')
_preview = {'snake': _next['snake'], 'food': _next['food'], 'direction': _next['direction'], 'score': _next['score'], 'over': _next['game_over']}`,
};

const sourceBundle = (codeByNode: Record<string, string>) => Object.entries(codeByNode)
  .filter(([, code]) => Boolean(code.trim()))
  .map(([nodeId, code]) => `# --- ${nodeId} ---\n${code}`)
  .join('\n\n');

const createTestHarness = (
  blueprintNodeId: string,
  studentCode: string,
  codeByNode: Record<string, string>,
) => {
  const functionName = FUNCTION_NAMES[blueprintNodeId];
  const testCases = LOCAL_BEHAVIOR_CHECKS[blueprintNodeId];
  if (!functionName || !testCases) throw new Error('unsupported-module');
  const code = blueprintNodeId === 'game-loop'
    ? sourceBundle({ ...codeByNode, [blueprintNodeId]: studentCode })
    : studentCode;
  const indentedTests = testCases.split('\n').map(line => line ? `        ${line}` : line).join('\n');
  return `
import contextlib
import io
import json
_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': ''}
_preview = {}
_output_buffer = io.StringIO()
def _require(condition, code):
    if not condition:
        raise AssertionError(code)
try:
    with contextlib.redirect_stdout(_output_buffer), contextlib.redirect_stderr(_output_buffer):
        _namespace = {}
        exec(${JSON.stringify(code)}, _namespace)
        _fn = _namespace.get(${JSON.stringify(functionName)})
        _require(callable(_fn), 'FUNCTION_MISSING')
${indentedTests}
        _result = {'passed': True, 'resultCode': 'PASSED', 'detail': '', 'preview': _preview}
except SyntaxError as _error:
    _result = {'passed': False, 'resultCode': 'SYNTAX_ERROR', 'detail': f'line {_error.lineno}: {_error.msg}'}
except AssertionError as _error:
    _result = {'passed': False, 'resultCode': str(_error), 'detail': ''}
except Exception as _error:
    _result = {'passed': False, 'resultCode': 'RUNTIME_ERROR', 'detail': f'{type(_error).__name__}: {_error}'}
_result['output'] = _output_buffer.getvalue().splitlines()[:200]
json.dumps(_result, ensure_ascii=False)
`;
};

export const runPythonModuleTest = async (
  blueprintNodeId: string,
  studentCode: string,
  codeByNode: Record<string, string> = {},
) => {
  const startedAt = performance.now();
  const result = await runPythonJson<Omit<PythonModuleTestResult, 'durationMs'>>(
    createTestHarness(blueprintNodeId, studentCode, codeByNode),
  );
  return { ...result, durationMs: Math.round(performance.now() - startedAt) };
};

const createGameHarness = (
  command: 'reset' | 'step',
  codeByNode: Record<string, string>,
  state?: PythonGameState,
  userInput?: string | null,
) => `
import json
_bundle_source = ${JSON.stringify(sourceBundle(codeByNode))}
if globals().get('_game_bundle_source') != _bundle_source:
    _game_namespace = {}
    exec(_bundle_source, _game_namespace)
    globals()['_game_namespace'] = _game_namespace
    globals()['_game_bundle_source'] = _bundle_source
_namespace = globals()['_game_namespace']
_board_size = 12
def _point_list(value):
    return [[int(point[0]), int(point[1])] for point in value]
if ${JSON.stringify(command)} == 'reset':
    _initial = _namespace['create_initial_state']()
    _snake, _direction, _score = _initial
    _food_fn = _namespace.get('spawn_food')
    _food = _food_fn(_snake, _board_size) if callable(_food_fn) else (9, 5)
    _state = {'snake': _point_list(_snake), 'direction': _direction, 'food': list(_food), 'score': int(_score), 'game_over': False}
else:
    _state = json.loads(${JSON.stringify(JSON.stringify(state ?? null))})
    # 跨 Worker 消息的 JSON 会把 Python 元组变成列表；学生函数契约使用坐标
    # 二元组，进入函数前恢复表示，避免“单测通过、组合后却吃不到食物”。
    _state['snake'] = [tuple(_point) for _point in _state['snake']]
    _state['food'] = tuple(_state['food'])
    _input = json.loads(${JSON.stringify(JSON.stringify(userInput ?? null))})
    _loop = _namespace.get('step_game')
    if callable(_loop):
        _state = _loop(_state, _input)
    elif not _state.get('game_over'):
        _direction_fn = _namespace.get('change_direction')
        if _input and callable(_direction_fn):
            _state['direction'] = _direction_fn(_state['direction'], _input)
        _move_fn = _namespace.get('move_snake')
        if callable(_move_fn):
            _state['snake'] = _move_fn(_state['snake'], _state['direction'])
        _collision_fn = _namespace.get('check_collision')
        if callable(_collision_fn):
            _state['game_over'] = bool(_collision_fn(_state['snake'], _board_size))
        _eat_fn = _namespace.get('apply_food_effect')
        if callable(_eat_fn) and not _state['game_over']:
            _before_score = _state['score']
            _effect = _eat_fn(_state['snake'], _state['food'], _state['score'])
            _state['snake'], _state['score'] = _effect[:2]
            if _state['score'] > _before_score:
                _food_fn = _namespace.get('spawn_food')
                if callable(_food_fn):
                    _state['food'] = _food_fn(_state['snake'], _board_size)
    # objects 与 timers 在基础循环中原样保留：它们由创意钩子维护，
    # 基础七函数不认识这些字段，重建状态时丢掉会让计时器每帧被清空。
    _state = {'snake': _point_list(_state['snake']), 'direction': _state['direction'], 'food': list(_state['food']), 'score': int(_state['score']), 'game_over': bool(_state['game_over']), **({'interval': float(_state['interval'])} if 'interval' in _state else {}), **({'objects': _state['objects']} if 'objects' in _state else {}), **({'timers': _state['timers']} if 'timers' in _state else {})}
json.dumps(_state, ensure_ascii=False)
`;

const normalizeGameState = (value: unknown): PythonGameState => {
  if (!value || typeof value !== 'object') throw new Error('invalid-game-state');
  const state = value as Partial<PythonGameState>;
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  const validPoint = (point: unknown) => Array.isArray(point)
    && point.length === 2
    && point.every(coordinate => Number.isInteger(coordinate) && Math.abs(coordinate) <= 100);
  if (!Array.isArray(state.snake) || state.snake.length < 1 || state.snake.length > 400 || !state.snake.every(validPoint)) {
    throw new Error('invalid-game-state');
  }
  if (!validPoint(state.food) || !directions.includes(state.direction as Direction)) throw new Error('invalid-game-state');
  if (!Number.isInteger(state.score) || (state.score ?? -1) < 0 || (state.score ?? 0) > 1_000_000) throw new Error('invalid-game-state');
  if (typeof state.game_over !== 'boolean') throw new Error('invalid-game-state');
  if (state.interval !== undefined && (
    typeof state.interval !== 'number'
    || !Number.isFinite(state.interval)
    || state.interval < 0.08
    || state.interval > 2
  )) throw new Error('invalid-game-state');
  const rawObjects = state.objects ?? [];
  if (!Array.isArray(rawObjects) || rawObjects.length > SCENE_LIMITS.maxObjects) throw new Error('invalid-game-state');
  const objects: PythonGameObject[] = rawObjects.map((rawObject, index) => {
    if (!rawObject || typeof rawObject !== 'object') throw new Error('invalid-game-state');
    const object = rawObject as Partial<PythonGameObject>;
    const id = String(object.id ?? `object-${index}`).slice(0, 48);
    const type = String(object.type ?? 'custom').toLowerCase();
    const label = object.label === undefined ? undefined : String(object.label).slice(0, 4);
    if (
      !SCENE_TYPE_PATTERN.test(type)
      || !validPoint(object.position)
      || object.position!.some(coordinate => coordinate < 0 || coordinate >= 12)
    ) throw new Error('invalid-game-state');
    const dataEntries = Object.entries(object.data ?? {});
    if (dataEntries.length > 12 || dataEntries.some(([key, item]) => (
      !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(key)
      || !['string', 'number', 'boolean'].includes(typeof item)
      || (typeof item === 'string' && item.length > 80)
      || (typeof item === 'number' && !Number.isFinite(item))
    ))) throw new Error('invalid-game-state');
    return {
      id,
      type,
      position: [object.position![0], object.position![1]],
      ...(label === undefined ? {} : { label }),
      ...(object.solid === undefined ? {} : { solid: Boolean(object.solid) }),
      ...(object.active === undefined ? {} : { active: Boolean(object.active) }),
      ...(dataEntries.length === 0 ? {} : { data: Object.fromEntries(dataEntries) }),
    };
  });
  // 计时器：键名比 V1 的 data 键更严（排除 __ 开头），避免按键赋值造成原型污染。
  const rawTimers = state.timers;
  const timers: Record<string, number> = Object.create(null);
  if (rawTimers !== undefined) {
    if (!rawTimers || typeof rawTimers !== 'object' || Array.isArray(rawTimers)) throw new Error('invalid-game-state');
    const timerEntries = Object.entries(rawTimers);
    if (timerEntries.length > SCENE_LIMITS.maxTimers) throw new Error('invalid-game-state');
    timerEntries.forEach(([id, ticks]) => {
      if (
        !TIMER_ID_PATTERN.test(id)
        || !Number.isInteger(ticks)
        || (ticks as number) < 0
        || (ticks as number) > SCENE_LIMITS.maxTimerTicks
      ) throw new Error('invalid-game-state');
      timers[id] = ticks as number;
    });
  }
  return {
    snake: state.snake.map(point => [point[0], point[1]]),
    food: [state.food![0], state.food![1]],
    direction: state.direction as Direction,
    score: state.score!,
    game_over: state.game_over,
    ...(state.interval === undefined ? {} : { interval: state.interval }),
    ...(objects.length === 0 ? {} : { objects }),
    ...(Object.keys(timers).length === 0 ? {} : { timers: { ...timers } }),
  };
};

type Direction = PythonGameState['direction'];

export const resetPythonGame = async (codeByNode: Record<string, string>) => (
  normalizeGameState(await runPythonJson<unknown>(createGameHarness('reset', codeByNode)))
);

export const stepPythonGame = (
  codeByNode: Record<string, string>,
  state: PythonGameState,
  userInput: PythonGameState['direction'] | null,
) => runPythonJson<unknown>(createGameHarness('step', codeByNode, state, userInput)).then(normalizeGameState);

interface CreativeExecutionResult {
  passed: boolean;
  resultCode: string;
  detail: string;
  state?: unknown;
  output?: string[];
}

type RuntimeCreativeHook = Exclude<SnakeCreativeHook, 'any'>;

// 事件表来自能力注册表：运行器、渲染器和后续 Agent 校验共用同一份契约，
// 避免「Prompt 里写了、沙箱里没有」这类不可运行的名称。
const CREATIVE_EVENT_TYPES: Record<RuntimeCreativeHook, string> = CREATIVE_HOOK_EVENT_TYPES;

const RUNTIME_CREATIVE_HOOKS = Object.keys(CREATIVE_EVENT_TYPES) as RuntimeCreativeHook[];

export const CREATIVE_SAFE_BUILTIN_NAMES = [
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int', 'len',
  'list', 'max', 'min', 'print', 'range', 'reversed', 'round', 'set', 'sorted',
  'str', 'sum', 'tuple', 'zip',
] as const;

const CREATIVE_OUTPUT_MAX_CHARS = 16_000;

const creativeEvent = (
  hook: RuntimeCreativeHook,
  event: Omit<PythonCreativeHookEvent, 'type' | 'hook'> = {},
): PythonCreativeHookEvent => ({ ...event, type: CREATIVE_EVENT_TYPES[hook], hook });

/**
 * 注入沙箱的确定性帮助函数（Creative Capability API V2）。
 *
 * 它们在 Python 内部实现并显式放进创意命名空间：学生无需 `import`，
 * 也无法通过它们触达文件、网络或宿主对象。随机来自平台注入的种子，
 * 因此「同一代码 + 同一初始状态 + 同一事件序列 + 同一 seed」结果可复现。
 *
 * 上限直接来自能力注册表，避免 Python 侧和 TypeScript 侧各写一套数字。
 */
const creativeHelperSource = () => `
_board_size = ${SCENE_LIMITS.boardSize}
_max_objects = ${SCENE_LIMITS.maxObjects}
_max_label_chars = ${SCENE_LIMITS.maxLabelChars}
_max_timers = ${SCENE_LIMITS.maxTimers}
_max_timer_ticks = ${SCENE_LIMITS.maxTimerTicks}
_max_id_chars = ${SCENE_LIMITS.maxIdChars}

def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)

def _in_board(x, y):
    return 0 <= x < _board_size and 0 <= y < _board_size

def _as_point(value):
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x, y = value
        if _is_int(x) and _is_int(y) and _in_board(x, y):
            return [int(x), int(y)]
    return None

def _cell_key(value):
    if isinstance(value, (list, tuple)) and len(value) == 2:
        x, y = value
        if _is_int(x) and _is_int(y):
            return (int(x), int(y))
    return None

def _state_objects(state):
    if not isinstance(state, dict):
        raise TypeError('state must be the dictionary given to creative_feature')
    objects = state.get('objects')
    if not isinstance(objects, list):
        objects = []
        state['objects'] = objects
    return objects

def _state_timers(state):
    if not isinstance(state, dict):
        raise TypeError('state must be the dictionary given to creative_feature')
    timers = state.get('timers')
    if not isinstance(timers, dict):
        timers = {}
        state['timers'] = timers
    return timers

def randint(min_value, max_value):
    if not _is_int(min_value) or not _is_int(max_value):
        raise TypeError('randint(min_value, max_value) needs two integers')
    if min_value > max_value:
        raise ValueError('randint needs min_value <= max_value')
    if max_value - min_value > 1000000:
        raise ValueError('randint range is too large')
    return _creative_rng.randint(min_value, max_value)

def choice(items):
    if not isinstance(items, (list, tuple)) or len(items) == 0:
        raise ValueError('choice(items) needs a non-empty list')
    return items[_creative_rng.randrange(len(items))]

def random_empty_cell(state):
    occupied = set()
    if isinstance(state, dict):
        for point in state.get('snake') or []:
            key = _cell_key(point)
            if key is not None:
                occupied.add(key)
        food_key = _cell_key(state.get('food'))
        if food_key is not None:
            occupied.add(food_key)
        for item in _state_objects(state):
            if isinstance(item, dict) and item.get('solid'):
                key = _cell_key(item.get('position'))
                if key is not None:
                    occupied.add(key)
    free = [
        [x, y]
        for y in range(_board_size)
        for x in range(_board_size)
        if (x, y) not in occupied
    ]
    if not free:
        return None
    return list(free[_creative_rng.randrange(len(free))])

def _is_type_name(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 24:
        return False
    for character in value:
        if not (character.islower() and character.isalpha()) and not character.isdigit() and character not in '_-':
            return False
    return True

def _next_object_id(objects, type_value):
    taken = {item.get('id') for item in objects if isinstance(item, dict)}
    index = 1
    while True:
        candidate = type_value + '-' + str(index)
        if candidate not in taken:
            return candidate
        index += 1

def add_object(state, object_spec):
    """按场景对象协议新增一个对象。上限或字段非法时返回 None，且不写入状态。"""
    objects = _state_objects(state)
    if not isinstance(object_spec, dict) or len(objects) >= _max_objects:
        return None
    position = _as_point(object_spec.get('position'))
    if position is None:
        return None
    type_value = object_spec.get('type', 'custom')
    if not _is_type_name(type_value):
        return None
    object_id = object_spec.get('id')
    if object_id is None:
        object_id = _next_object_id(objects, type_value)
    if not isinstance(object_id, str) or not 1 <= len(object_id) <= _max_id_chars:
        return None
    new_object = {'id': object_id, 'type': type_value, 'position': position}
    label = object_spec.get('label')
    if label is not None:
        if not isinstance(label, str):
            return None
        new_object['label'] = label[:_max_label_chars]
    for flag in ('solid', 'active'):
        if object_spec.get(flag) is not None:
            new_object[flag] = bool(object_spec.get(flag))
    # 表现字段原样带过，由主线程按 Schema 复核；这里不放行未知字段。
    for field in ('shape', 'size', 'color', 'strokeColor', 'opacity', 'rotation', 'zIndex', 'animation', 'data'):
        if object_spec.get(field) is not None:
            new_object[field] = object_spec.get(field)
    objects.append(new_object)
    return new_object

def remove_object(state, object_id):
    objects = _state_objects(state)
    for index, item in enumerate(objects):
        if isinstance(item, dict) and item.get('id') == object_id:
            del objects[index]
            return True
    return False

def move_object(state, object_id, position):
    target = _as_point(position)
    if target is None:
        return False
    for item in _state_objects(state):
        if isinstance(item, dict) and item.get('id') == object_id:
            item['position'] = target
            return True
    return False

def find_objects(state, object_type=None):
    """返回状态中的对象本体；修改返回项即修改状态，主线程仍会复核。"""
    objects = _state_objects(state)
    if object_type is None:
        return [item for item in objects if isinstance(item, dict)]
    return [item for item in objects if isinstance(item, dict) and item.get('type') == object_type]

def _is_timer_id(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 32 or value.startswith('__'):
        return False
    for character in value:
        if not character.isalnum() and character not in '_-':
            return False
        if character.isalnum() and not character.isascii():
            return False
    return True

def set_timer(state, timer_id, ticks):
    """设置一个按帧倒数的计时器；平台在每个游戏帧减一。"""
    timers = _state_timers(state)
    if not _is_timer_id(timer_id) or not _is_int(ticks):
        return False
    if ticks < 0 or ticks > _max_timer_ticks:
        return False
    if timer_id not in timers and len(timers) >= _max_timers:
        return False
    timers[timer_id] = int(ticks)
    return True

def timer_ready(state, timer_id):
    timers = _state_timers(state)
    value = timers.get(timer_id)
    return _is_int(value) and value <= 0
`;

const createCreativeHarness = (
  code: string,
  state: PythonGameState,
  event: PythonCreativeHookEvent,
  seed: number,
  sequence: number,
) => `
import ast
import builtins
import contextlib
import io
import json
import random
_creative_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': ''}
_creative_output = io.StringIO()
# 种子由平台注入：同一 seed 与同一事件序号必然得到同一随机序列。
_creative_rng = random.Random(${JSON.stringify(seed)} * 1000003 + ${JSON.stringify(sequence)})
_safe_builtin_names = (${CREATIVE_SAFE_BUILTIN_NAMES.map(name => `'${name}'`).join(', ')})
_safe_builtins = {name: getattr(builtins, name) for name in _safe_builtin_names}
def _safe_print(*values, sep=' ', end='\\n'):
    if not isinstance(sep, str) or not isinstance(end, str):
        raise TypeError('print separator and ending must be strings')
    remaining = ${CREATIVE_OUTPUT_MAX_CHARS} - _creative_output.tell()
    if remaining <= 0:
        return
    text = sep.join(str(value) for value in values) + end
    _creative_output.write(text[:remaining])
_safe_builtins['print'] = _safe_print
${creativeHelperSource()}
_creative_helpers = {${CREATIVE_HELPERS.map(helper => `'${helper.name}': ${helper.name}`).join(', ')}}
try:
    _creative_tree = ast.parse(${JSON.stringify(code)})
    _blocked_names = {
        'open', 'exec', 'eval', 'compile', '__import__', 'globals', 'locals',
        'vars', 'getattr', 'setattr', 'delattr', 'breakpoint', 'input', 'help'
    }
    for _node in ast.walk(_creative_tree):
        if isinstance(_node, (ast.Import, ast.ImportFrom)):
            raise AssertionError('CREATIVE_RESTRICTED')
        if isinstance(_node, ast.Attribute) and _node.attr.startswith('__'):
            raise AssertionError('CREATIVE_RESTRICTED')
        if isinstance(_node, ast.Name) and (_node.id.startswith('__') or _node.id in _blocked_names):
            raise AssertionError('CREATIVE_RESTRICTED')
    with contextlib.redirect_stdout(_creative_output), contextlib.redirect_stderr(_creative_output):
        _creative_namespace = {'__builtins__': _safe_builtins}
        _creative_namespace.update(_creative_helpers)
        exec(${JSON.stringify(code)}, _creative_namespace)
        _creative_fn = _creative_namespace.get(${JSON.stringify(CREATIVE_FUNCTION_NAME)})
        if not callable(_creative_fn):
            raise AssertionError('FUNCTION_MISSING')
        _creative_state = json.loads(${JSON.stringify(JSON.stringify(state))})
        _creative_event = json.loads(${JSON.stringify(JSON.stringify(event))})
        _creative_returned = _creative_fn(_creative_event, _creative_state)
        if _creative_returned is not None:
            _creative_state = _creative_returned
    if not isinstance(_creative_state, dict):
        raise AssertionError('CREATIVE_RETURN')
    _allowed_state_keys = {${CREATIVE_STATE_KEYS.map(key => `'${key}'`).join(', ')}}
    if any(_key not in _allowed_state_keys for _key in _creative_state):
        raise AssertionError('CREATIVE_UNSUPPORTED_STATE')
    _creative_result = {'passed': True, 'resultCode': 'PASSED', 'detail': '', 'state': _creative_state}
except SyntaxError as _error:
    _creative_result = {'passed': False, 'resultCode': 'SYNTAX_ERROR', 'detail': f'line {_error.lineno}: {_error.msg}'}
except AssertionError as _error:
    _creative_result = {'passed': False, 'resultCode': str(_error), 'detail': ''}
except Exception as _error:
    _creative_result = {'passed': False, 'resultCode': 'RUNTIME_ERROR', 'detail': f'{type(_error).__name__}: {_error}'}
_creative_result['output'] = _creative_output.getvalue().splitlines()[:200]
_creative_payload = json.dumps(_creative_result, ensure_ascii=False)
_creative_payload
`;

/** 供测试生成与真实运行完全一致的沙箱源码，不额外维护第二套模板。 */
export const buildCreativeHarnessSource = createCreativeHarness;

const SAMPLE_CREATIVE_STATE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
  interval: 0.36,
  objects: [],
};

/**
 * 确定性随机的种子与序号。
 *
 * seed 固定一局游戏，sequence 随每次创意函数执行递增：同一 seed 下事件序列
 * 相同就得到相同的随机序列，便于复现学生提交的运行证据。seed 会随测试结果
 * 一起记录，不只存在浏览器内存里。
 */
const DEFAULT_CREATIVE_SEED = 20260828;
let creativeSeed = DEFAULT_CREATIVE_SEED;
let creativeSequence = 0;

export const getCreativeSeed = () => creativeSeed;

/** 开始新一局时设定种子并重置序号；不传则沿用当前种子。 */
export const setCreativeSeed = (seed: number = creativeSeed) => {
  creativeSeed = Number.isSafeInteger(seed) ? Math.abs(seed) % 2_147_483_647 : DEFAULT_CREATIVE_SEED;
  creativeSequence = 0;
  return creativeSeed;
};

const executeCreative = async (
  code: string,
  state: PythonGameState,
  event: PythonCreativeHookEvent,
  seed: number = creativeSeed,
  sequence: number = creativeSequence++,
): Promise<CreativeExecutionResult> => runPythonJson<CreativeExecutionResult>(
  createCreativeHarness(code, state, event, seed, sequence),
);

/**
 * 平台按帧推进计时器：每个游戏帧把所有计时器减一，最低到 0。
 * 由平台而不是学生代码负责，保证不同卡片看到的是同一条时间线。
 */
export const advanceCreativeTimers = (state: PythonGameState): PythonGameState => {
  const timers = state.timers;
  if (!timers) return state;
  const entries = Object.entries(timers);
  if (entries.length === 0) return state;
  return {
    ...state,
    timers: Object.fromEntries(entries.map(([id, ticks]) => [id, Math.max(0, ticks - 1)])),
  };
};

export const runPythonCreativeTest = async (
  code: string,
  hook: SnakeCreativeHook,
  seed: number = creativeSeed,
): Promise<PythonModuleTestResult> => {
  const startedAt = performance.now();
  const hooks = hook === 'any' || usesCreativeEventRouting(code) ? RUNTIME_CREATIVE_HOOKS : [hook];
  let state = normalizeGameState(SAMPLE_CREATIVE_STATE);
  const outputs: string[] = [];
  let changed = false;

  // 测试从固定序号开始：同一份代码和同一个 seed 每次得到同样的测试结论，
  // 学生不会因为「上一张卡刚好消耗了随机序列」而看到时好时坏的结果。
  for (const [index, currentHook] of hooks.entries()) {
    const before = JSON.stringify(state);
    const result = await executeCreative(code, state, creativeEvent(currentHook, { input: 'up' }), seed, index);
    if (result.output?.length) outputs.push(...result.output);
    if (!result.passed) {
      return { ...result, seed, output: outputs.slice(0, 200), durationMs: Math.round(performance.now() - startedAt) };
    }
    try {
      state = normalizeGameState(result.state);
    } catch {
      return {
        passed: false,
        resultCode: 'CREATIVE_STATE',
        detail: '',
        seed,
        output: outputs.slice(0, 200),
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
    changed ||= JSON.stringify(state) !== before;
  }

  if (!changed) {
    return {
      passed: false,
      resultCode: 'CREATIVE_NO_EFFECT',
      detail: '',
      seed,
      output: outputs.slice(0, 200),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  return {
    passed: true,
    resultCode: 'PASSED',
    detail: '',
    seed,
    output: outputs.slice(0, 200),
    preview: {
      snake: state.snake,
      food: state.food,
      direction: state.direction,
      score: state.score,
      over: state.game_over,
      interval: state.interval,
      objects: state.objects,
    },
    durationMs: Math.round(performance.now() - startedAt),
  };
};

/**
 * 逐卡执行同一事件上的创意函数。每张卡单独进入 Worker 调用：普通异常在 Python
 * 内捕获；无限循环只会让当前卡超时并重启 Worker，下一张卡和基础游戏继续运行。
 */
export const runPythonCreativeHooks = async (
  cards: StudentCreativeFunction[],
  hook: RuntimeCreativeHook,
  state: PythonGameState,
  event: Omit<PythonCreativeHookEvent, 'type' | 'hook'> = {},
): Promise<PythonCreativeHookResult> => {
  let next = normalizeGameState(state);
  const errors: PythonCreativeHookError[] = [];
  const outputs: PythonCreativeHookResult['outputs'] = [];
  const active = cards.filter(card => card.enabled && card.verified && (
    card.hook === 'any'
    || card.hook === hook
    || usesCreativeEventRouting(card.code)
  ));
  for (const card of active) {
    try {
      const result = await executeCreative(card.code, next, creativeEvent(hook, event));
      if (result.output?.length) outputs.push({ cardId: card.id, hook, lines: result.output });
      if (!result.passed) {
        errors.push({ cardId: card.id, resultCode: result.resultCode, detail: result.detail });
        continue;
      }
      try {
        next = normalizeGameState(result.state);
      } catch {
        errors.push({ cardId: card.id, resultCode: 'CREATIVE_STATE', detail: '' });
      }
    } catch (error) {
      errors.push({
        cardId: card.id,
        resultCode: error instanceof Error ? error.message : 'python-runtime-error',
        detail: '',
      });
    }
  }
  return { state: next, errors, outputs };
};

/**
 * 迁移测试也在同一个无文件、无网络、5 秒上限的 Worker 中运行。
 * 学生可自由拆函数，但可视化运行器只从 next_move(state) 读取下一步。
 */
export const runPythonMazeTest = async (
  code: string,
  config: PythonMazeConfig,
): Promise<PythonMazeTestResult> => {
  const startedAt = performance.now();
  const harness = `
import ast
import builtins
import contextlib
import io
import json
_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': '', 'path': [], 'output': []}
_output = io.StringIO()
try:
    _source = ${JSON.stringify(code)}
    _tree = ast.parse(_source)
    _blocked = {'open', 'exec', 'eval', 'compile', '__import__', 'globals', 'locals', 'vars', 'getattr', 'setattr', 'delattr', 'breakpoint', 'input', 'help'}
    for _node in ast.walk(_tree):
        if isinstance(_node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)):
            raise AssertionError('RESTRICTED_CODE')
        if isinstance(_node, ast.Attribute) and _node.attr.startswith('__'):
            raise AssertionError('RESTRICTED_CODE')
        if isinstance(_node, ast.Name) and (_node.id.startswith('__') or _node.id in _blocked):
            raise AssertionError('RESTRICTED_CODE')
    _safe_names = ('abs','all','any','bool','dict','enumerate','float','int','len','list','max','min','range','reversed','round','set','sorted','str','sum','tuple','zip')
    _safe_builtins = {name: getattr(builtins, name) for name in _safe_names}
    _namespace = {'__builtins__': _safe_builtins}
    with contextlib.redirect_stdout(_output), contextlib.redirect_stderr(_output):
        exec(compile(_tree, '<student>', 'exec'), _namespace, _namespace)
        _next_move = _namespace.get('next_move')
        if not callable(_next_move):
            raise AssertionError('FUNCTION_MISSING')
        _config = json.loads(${JSON.stringify(JSON.stringify(config))})
        _size = int(_config['boardSize'])
        _position = list(_config['start'])
        _goal = list(_config['goal'])
        _walls = {tuple(point) for point in _config['walls']}
        _visited = [list(_position)]
        _path = [list(_position)]
        _directions = {'up': (0,-1), 'down': (0,1), 'left': (-1,0), 'right': (1,0)}
        for _step in range(int(_config.get('maxSteps') or 80)):
            if _position == _goal:
                break
            _state = {'position': list(_position), 'goal': list(_goal), 'walls': [list(point) for point in _walls], 'visited': [list(point) for point in _visited], 'steps': _step, 'board_size': _size}
            _direction = _next_move(_state)
            if _direction not in _directions:
                raise AssertionError('INVALID_DIRECTION')
            _dx, _dy = _directions[_direction]
            _candidate = [_position[0] + _dx, _position[1] + _dy]
            if not (0 <= _candidate[0] < _size and 0 <= _candidate[1] < _size):
                raise AssertionError('OUT_OF_BOUNDS')
            if tuple(_candidate) in _walls:
                raise AssertionError('HIT_WALL')
            _position = _candidate
            _visited.append(list(_position))
            _path.append(list(_position))
        if _position != _goal:
            raise AssertionError('GOAL_NOT_REACHED')
    _result = {'passed': True, 'resultCode': 'PASSED', 'detail': '', 'path': _path}
except SyntaxError as _error:
    _result = {'passed': False, 'resultCode': 'SYNTAX_ERROR', 'detail': f'line {_error.lineno}: {_error.msg}', 'path': []}
except AssertionError as _error:
    _result = {'passed': False, 'resultCode': str(_error), 'detail': '', 'path': locals().get('_path', [])}
except Exception as _error:
    _result = {'passed': False, 'resultCode': 'RUNTIME_ERROR', 'detail': f'{type(_error).__name__}: {_error}', 'path': locals().get('_path', [])}
_result['output'] = _output.getvalue().splitlines()[:200]
json.dumps(_result, ensure_ascii=False)
`;
  const result = await runPythonJson<Omit<PythonMazeTestResult, 'durationMs'>>(harness);
  return { ...result, durationMs: Math.round(performance.now() - startedAt) };
};

export const disposePythonModuleRunner = () => {
  runnerGeneration += 1;
  stopWorker();
  rejectPending(new Error('runner-disposed'));
  runQueue = Promise.resolve();
};

const RESULT_MESSAGES: Record<string, { zh: string; en: string }> = {
  PASSED: { zh: '本地行为测试通过，代码已接入左侧同一个游戏运行器。', en: 'Local behaviour tests passed. The code is now connected to the shared game runner.' },
  FUNCTION_MISSING: { zh: '没有找到规定的函数，请保留函数名称和参数。', en: 'The required function was not found. Keep its name and parameters.' },
  INITIAL_RETURN: { zh: '初始状态需要同时返回蛇身、方向和得分。', en: 'The initial state must return the snake, direction and score.' },
  INITIAL_SNAKE: { zh: '初始蛇身的数据结构还不完整。', en: 'The initial snake structure is incomplete.' },
  INITIAL_COORDINATES: { zh: '蛇身中的每一项都应能表示一个二维坐标。', en: 'Every snake item must represent a 2D coordinate.' },
  INITIAL_BOUNDARY: { zh: '初始蛇身中有坐标落在棋盘之外。', en: 'An initial snake coordinate is outside the board.' },
  INITIAL_DIRECTION: { zh: '初始方向不是可识别的四个方向之一。', en: 'The initial direction is not one of the four supported directions.' },
  INITIAL_SCORE: { zh: '重新开始时得分还没有恢复为 0。', en: 'The score does not reset to 0.' },
  DIRECTION_CHANGE: { zh: '合法转向后，函数没有返回新的方向。', en: 'A valid turn did not return the new direction.' },
  DIRECTION_OPPOSITE: { zh: '相反方向仍被采用，蛇会立即掉头。', en: 'An opposite direction was accepted, causing an immediate reverse.' },
  MOVEMENT_RETURN: { zh: '移动函数没有返回新的蛇身列表。', en: 'The movement function did not return a new snake list.' },
  MOVEMENT_STEP: { zh: '向右移动一次后，蛇头或蛇尾的位置不符合预期。', en: 'After one move right, the head or tail position is incorrect.' },
  FOOD_RETURN: { zh: '食物生成结果不是一个二维坐标。', en: 'The generated food is not a 2D coordinate.' },
  FOOD_BOUNDARY: { zh: '有一次生成的食物落在棋盘范围之外。', en: 'A generated food position was outside the board.' },
  FOOD_OVERLAP: { zh: '有一次生成的食物与蛇身重合。', en: 'A generated food position overlapped the snake.' },
  EAT_RETURN: { zh: '进食函数需要返回蛇身和得分。', en: 'The food-effect function must return the snake and score.' },
  EAT_GROW_SCORE: { zh: '蛇头到达食物时，增长或计分没有同时发生。', en: 'Growth and scoring did not both happen when the head reached food.' },
  EAT_NO_CHANGE: { zh: '没有吃到食物时，蛇身或得分被意外修改。', en: 'The snake or score changed without eating food.' },
  COLLISION_BOUNDARY: { zh: '越过棋盘边界时没有判定碰撞。', en: 'Crossing the board boundary was not detected.' },
  COLLISION_SELF: { zh: '蛇头碰到自身时没有判定碰撞。', en: 'Self-collision was not detected.' },
  COLLISION_NORMAL: { zh: '正常移动被误判成了碰撞。', en: 'A normal move was incorrectly treated as a collision.' },
  LOOP_RETURN: { zh: '循环函数需要返回完整的游戏状态字典。', en: 'The loop function must return a complete game-state dictionary.' },
  LOOP_DEPENDENCIES: { zh: '先让前六个基础函数分别通过测试，再检查它们怎样在一次循环中组合。', en: 'Pass the first six functions, then check how one loop combines them.' },
  LOOP_STATE: { zh: '循环返回的状态字段不完整或被意外修改。', en: 'The loop returned incomplete or unexpectedly changed state.' },
  LOOP_ONE_TICK: { zh: '一次循环没有恰好推进一格。', en: 'One loop call did not advance exactly one cell.' },
  CREATIVE_RETURN: { zh: '创意函数需要返回游戏状态字典，或返回 None 保持原状态。', en: 'The creative function must return the game-state dictionary or None.' },
  CREATIVE_STATE: { zh: '创意函数返回的状态不符合安全游戏契约。', en: 'The creative function returned a state outside the safe game contract.' },
  CREATIVE_RESTRICTED: { zh: '创意函数只能使用受控状态和基础 Python 表达式，不能访问文件、导入模块或动态执行代码。', en: 'Creative functions can use only the controlled state and basic Python expressions; files, imports and dynamic execution are blocked.' },
  CREATIVE_UNSUPPORTED_STATE: { zh: '这个顶层状态字段还没有接入游戏。当前可修改 snake、direction、food、score、game_over、interval 和 objects。', en: 'That top-level state field is not connected to the game. You can change snake, direction, food, score, game_over, interval, and objects.' },
  CREATIVE_NO_EFFECT: { zh: '函数能安全运行，但没有改变任何可观察的游戏状态。请修改状态后再测试。', en: 'The function ran safely but did not change any observable game state. Change the state and test again.' },
  SYNTAX_ERROR: { zh: '代码存在语法错误。', en: 'The code contains a syntax error.' },
  RUNTIME_ERROR: { zh: '代码运行时发生错误。', en: 'The code raised an error while running.' },
};

export const formatPythonModuleTestResult = (result: PythonModuleTestResult, language: Language) => {
  const message = RESULT_MESSAGES[result.resultCode]?.[language]
    ?? (language === 'zh' ? '函数测试未通过，请检查当前代码。' : 'Function tests did not pass. Check the current code.');
  return result.detail ? `${message} ${result.detail}` : message;
};

export const formatPythonRunnerError = (error: unknown, language: Language) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'runtime-load-timeout') return language === 'zh' ? 'Python 测试环境加载超时，请检查网络后重试。' : 'The Python test runtime timed out while loading.';
  if (code === 'execution-timeout') return language === 'zh' ? '代码运行超过 5 秒，已安全停止。请检查是否存在无限循环。' : 'Execution exceeded 5 seconds and was stopped. Check for an infinite loop.';
  if (code === 'invalid-game-state') return language === 'zh' ? '函数返回的游戏状态结构不安全，运行器已停止这一帧。' : 'The function returned an unsafe game state, so the runner stopped this frame.';
  if (code === 'runner-disposed') return language === 'zh' ? '当前建构页已关闭。' : 'The build workspace was closed.';
  return language === 'zh' ? 'Python 运行环境暂时不可用，请稍后重试。' : 'The Python runtime is temporarily unavailable.';
};
