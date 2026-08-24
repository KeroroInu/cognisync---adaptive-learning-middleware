import type { Language } from '../types';
import type { SnakeCreativeHook, StudentCreativeFunction } from '../data/snakeCreativeFunctions';
import { CREATIVE_FUNCTION_NAME } from '../data/snakeCreativeFunctions';

export interface PythonModuleTestResult {
  passed: boolean;
  resultCode: string;
  detail: string;
  durationMs: number;
  preview?: PythonModulePreview;
}

export interface PythonModulePreview {
  snake?: number[][];
  food?: number[];
  direction?: 'up' | 'down' | 'left' | 'right';
  score?: number;
  over?: boolean;
}

export interface PythonGameState {
  snake: number[][];
  direction: 'up' | 'down' | 'left' | 'right';
  food: number[];
  score: number;
  game_over: boolean;
}

export interface PythonCreativeHookEvent {
  type: SnakeCreativeHook;
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
  const indentedTests = testCases.split('\n').map(line => line ? `    ${line}` : line).join('\n');
  return `
import json
_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': ''}
_preview = {}
def _require(condition, code):
    if not condition:
        raise AssertionError(code)
try:
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
    _state = {'snake': _point_list(_state['snake']), 'direction': _state['direction'], 'food': list(_state['food']), 'score': int(_state['score']), 'game_over': bool(_state['game_over'])}
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
  return {
    snake: state.snake.map(point => [point[0], point[1]]),
    food: [state.food![0], state.food![1]],
    direction: state.direction as Direction,
    score: state.score!,
    game_over: state.game_over,
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
}

const createCreativeHarness = (
  code: string,
  state: PythonGameState,
  event: PythonCreativeHookEvent,
) => `
import ast
import builtins
import json
_creative_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': ''}
_safe_builtin_names = (
    'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int', 'len',
    'list', 'max', 'min', 'range', 'reversed', 'round', 'set', 'sorted',
    'str', 'sum', 'tuple', 'zip'
)
_safe_builtins = {name: getattr(builtins, name) for name in _safe_builtin_names}
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
    _creative_namespace = {'__builtins__': _safe_builtins}
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
    _creative_result = {'passed': True, 'resultCode': 'PASSED', 'detail': '', 'state': _creative_state}
except SyntaxError as _error:
    _creative_result = {'passed': False, 'resultCode': 'SYNTAX_ERROR', 'detail': f'line {_error.lineno}: {_error.msg}'}
except AssertionError as _error:
    _creative_result = {'passed': False, 'resultCode': str(_error), 'detail': ''}
except Exception as _error:
    _creative_result = {'passed': False, 'resultCode': 'RUNTIME_ERROR', 'detail': f'{type(_error).__name__}: {_error}'}
json.dumps(_creative_result, ensure_ascii=False)
`;

const SAMPLE_CREATIVE_STATE: PythonGameState = {
  snake: [[6, 5], [5, 5], [4, 5]],
  direction: 'right',
  food: [9, 5],
  score: 0,
  game_over: false,
};

const executeCreative = async (
  code: string,
  state: PythonGameState,
  event: PythonCreativeHookEvent,
): Promise<CreativeExecutionResult> => runPythonJson<CreativeExecutionResult>(
  createCreativeHarness(code, state, event),
);

export const runPythonCreativeTest = async (
  code: string,
  hook: SnakeCreativeHook,
): Promise<PythonModuleTestResult> => {
  const startedAt = performance.now();
  const result = await executeCreative(code, SAMPLE_CREATIVE_STATE, { type: hook, input: 'up' });
  if (result.passed) {
    try {
      normalizeGameState(result.state);
    } catch {
      return {
        passed: false,
        resultCode: 'CREATIVE_STATE',
        detail: '',
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
  }
  return { ...result, durationMs: Math.round(performance.now() - startedAt) };
};

/**
 * 逐卡执行同一事件上的创意函数。每张卡单独进入 Worker 调用：普通异常在 Python
 * 内捕获；无限循环只会让当前卡超时并重启 Worker，下一张卡和基础游戏继续运行。
 */
export const runPythonCreativeHooks = async (
  cards: StudentCreativeFunction[],
  hook: SnakeCreativeHook,
  state: PythonGameState,
  event: Omit<PythonCreativeHookEvent, 'type'> = {},
): Promise<PythonCreativeHookResult> => {
  let next = normalizeGameState(state);
  const errors: PythonCreativeHookError[] = [];
  const active = cards.filter(card => card.enabled && card.verified && card.hook === hook);
  for (const card of active) {
    try {
      const result = await executeCreative(card.code, next, { ...event, type: hook });
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
  return { state: next, errors };
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
