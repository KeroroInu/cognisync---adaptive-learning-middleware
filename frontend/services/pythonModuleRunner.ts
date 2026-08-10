import type { Language } from '../types';

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

interface WorkerResponse {
  type: 'runtime-loading' | 'executing' | 'result' | 'error';
  id?: string;
  result?: string;
  message?: string;
}

interface PendingRun {
  id: string;
  startedAt: number;
  resolve: (result: PythonModuleTestResult) => void;
  reject: (error: Error) => void;
  bootstrapTimer: ReturnType<typeof setTimeout>;
  executionTimer?: ReturnType<typeof setTimeout>;
}

const PYODIDE_BOOTSTRAP_TIMEOUT_MS = 45_000;
const MODULE_EXECUTION_TIMEOUT_MS = 5_000;
let moduleWorker: Worker | null = null;
let pendingRun: PendingRun | null = null;

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
      }, MODULE_EXECUTION_TIMEOUT_MS);
      return;
    }
    if (message.type === 'result') {
      const pending = pendingRun;
      pendingRun = null;
      clearPendingTimers(pending);
      try {
        const parsed = JSON.parse(message.result ?? '{}') as Omit<PythonModuleTestResult, 'durationMs'>;
        pending.resolve({ ...parsed, durationMs: Math.round(performance.now() - pending.startedAt) });
      } catch {
        pending.reject(new Error('invalid-test-result'));
      }
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

const FUNCTION_NAMES: Record<string, string> = {
  'initial-state': 'create_initial_state',
  'direction-input': 'change_direction',
  movement: 'move_snake',
  'food-spawn': 'spawn_food',
  'eat-grow-score': 'apply_food_effect',
  collision: 'check_collision',
};

const TEST_CASES: Record<string, string> = {
  'initial-state': `
_state = _fn()
_require(isinstance(_state, (tuple, list)) and len(_state) == 3, 'INITIAL_RETURN')
_snake, _direction, _score = _state
_require(isinstance(_snake, (tuple, list)) and len(_snake) >= 2, 'INITIAL_SNAKE')
_require(all(isinstance(_point, (tuple, list)) and len(_point) == 2 for _point in _snake), 'INITIAL_COORDINATES')
_require(all(isinstance(_point[0], int) and isinstance(_point[1], int) and 0 <= _point[0] < 14 and 0 <= _point[1] < 10 for _point in _snake), 'INITIAL_BOUNDARY')
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
    _require(tuple(_food) not in _snake, 'FOOD_OVERLAP')
_preview = {'food': _food}`,
  'eat-grow-score': `
_snake = [(2, 2), (1, 2), (0, 2)]
_grown, _score = _fn(list(_snake), (2, 2), 0)
_require(len(_grown) == 4 and _score == 10, 'EAT_GROW_SCORE')
_same, _same_score = _fn(list(_snake), (7, 7), 0)
_require(len(_same) == 3 and _same_score == 0, 'EAT_NO_CHANGE')
_preview = {'snake': _grown, 'food': (2, 2), 'score': _score}`,
  collision: `
_collision = bool(_fn([(-1, 2), (0, 2), (1, 2)], 10))
_require(_collision, 'COLLISION_BOUNDARY')
_require(bool(_fn([(2, 2), (2, 3), (2, 2)], 10)), 'COLLISION_SELF')
_require(not bool(_fn([(3, 2), (2, 2), (1, 2)], 10)), 'COLLISION_NORMAL')
_preview = {'snake': [(0, 2), (1, 2), (2, 2)], 'over': _collision}`,
};

const createTestHarness = (blueprintNodeId: string, studentCode: string) => {
  const functionName = FUNCTION_NAMES[blueprintNodeId];
  const testCases = TEST_CASES[blueprintNodeId];
  if (!functionName || !testCases) throw new Error('unsupported-module');
  const indentedTests = testCases
    .split('\n')
    .map(line => line ? `    ${line}` : line)
    .join('\n');
  return `
import json
_result = {'passed': False, 'resultCode': 'UNKNOWN', 'detail': ''}
_preview = {}
def _require(condition, code):
    if not condition:
        raise AssertionError(code)
try:
    _namespace = {}
    exec(${JSON.stringify(studentCode)}, _namespace)
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

export const runPythonModuleTest = (blueprintNodeId: string, studentCode: string) => {
  if (pendingRun) return Promise.reject(new Error('test-already-running'));
  const id = `module-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const source = createTestHarness(blueprintNodeId, studentCode);
  return new Promise<PythonModuleTestResult>((resolve, reject) => {
    const bootstrapTimer = setTimeout(() => {
      stopWorker();
      rejectPending(new Error('runtime-load-timeout'));
    }, PYODIDE_BOOTSTRAP_TIMEOUT_MS);
    pendingRun = { id, startedAt: performance.now(), resolve, reject, bootstrapTimer };
    getWorker().postMessage({ id, source });
  });
};

export const disposePythonModuleRunner = () => {
  stopWorker();
  rejectPending(new Error('runner-disposed'));
};

const RESULT_MESSAGES: Record<string, { zh: string; en: string }> = {
  PASSED: { zh: '模块测试通过，左侧已经装配并演示了这段代码对应的行为。', en: 'Module tests passed. The behaviour is now assembled and demonstrated on the left.' },
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
  EAT_GROW_SCORE: { zh: '蛇头到达食物时，增长或计分没有同时发生。', en: 'Growth and scoring did not both happen when the head reached food.' },
  EAT_NO_CHANGE: { zh: '没有吃到食物时，蛇身或得分被意外修改。', en: 'The snake or score changed without eating food.' },
  COLLISION_BOUNDARY: { zh: '越过棋盘边界时没有判定碰撞。', en: 'Crossing the board boundary was not detected.' },
  COLLISION_SELF: { zh: '蛇头碰到自身时没有判定碰撞。', en: 'Self-collision was not detected.' },
  COLLISION_NORMAL: { zh: '正常移动被误判成了碰撞。', en: 'A normal move was incorrectly treated as a collision.' },
  SYNTAX_ERROR: { zh: '代码存在语法错误。', en: 'The code contains a syntax error.' },
  RUNTIME_ERROR: { zh: '代码运行时发生错误。', en: 'The code raised an error while running.' },
};

export const formatPythonModuleTestResult = (result: PythonModuleTestResult, language: Language) => {
  const message = RESULT_MESSAGES[result.resultCode]?.[language]
    ?? (language === 'zh' ? '模块测试未通过，请检查当前函数。' : 'Module tests did not pass. Check the current function.');
  return result.detail ? `${message} ${result.detail}` : message;
};

export const formatPythonRunnerError = (error: unknown, language: Language) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'runtime-load-timeout') return language === 'zh' ? 'Python 测试环境加载超时，请检查网络后重试。' : 'The Python test runtime timed out while loading.';
  if (code === 'execution-timeout') return language === 'zh' ? '代码运行超过 5 秒，已安全停止。请检查是否存在无限循环。' : 'Execution exceeded 5 seconds and was stopped. Check for an infinite loop.';
  if (code === 'test-already-running') return language === 'zh' ? '当前模块仍在测试，请稍候。' : 'This module is already being tested.';
  return language === 'zh' ? '模块测试环境暂时不可用，请稍后重试。' : 'The module test runtime is temporarily unavailable.';
};
