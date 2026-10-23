import { freeProgramNamespace, runPythonJson } from './pythonModuleRunner';
import type { BasicSnakeState, Cell, SnakeKey } from '../data/basicSnake';
export { disposePythonModuleRunner as disposeBasicSnake } from './pythonModuleRunner';

export type BasicSnakeResult = { state: BasicSnakeState | null; error: string; output: string[] };

/** One Python step; the yielding browser loop schedules ticks. No fallback or server call. */
export function basicSnakeHarness(code: string, state: BasicSnakeState | null = null, key?: SnakeKey, click?: Cell): string {
  if (code.length > 50000) throw new Error('代码过长，请控制在 50000 字以内');
  if (click && (!click.every(Number.isInteger) || click.some(value => value < 0 || value > 9))) throw new Error('棋盘坐标须在 0—9 范围内');
  return `
import json
import traceback
_basic_result = {'state': None, 'error': '', 'output': []}
_free_lines = []
_free_count = [0]
try:
    if ${state === null ? 'True' : 'False'} or globals().get('_basic_source') != ${JSON.stringify(code)}:
${freeProgramNamespace(code).split('\n').map(line => `        ${line}`).join('\n')}
        _basic_namespace = _game_namespace
        _basic_source = ${JSON.stringify(code)}
    if not callable(_basic_namespace.get('create_initial_state')) or not callable(_basic_namespace.get('step_game')):
        raise ValueError('需要 create_initial_state() 和 step_game(state, key) 两个函数')
    if ${state === null ? 'True' : 'False'}:
        _basic_state = _basic_namespace['create_initial_state']()
    else:
        _basic_state = json.loads(${JSON.stringify(JSON.stringify(state))})
        _basic_state['snake'] = [tuple(p) for p in _basic_state['snake']]
        _basic_state['food'] = tuple(_basic_state['food']) if _basic_state['food'] is not None else None
        for _basic_field in ('obstacles', 'path'):
            if _basic_field in _basic_state and isinstance(_basic_state[_basic_field], list):
                _basic_state[_basic_field] = [tuple(p) if isinstance(p, list) else p for p in _basic_state[_basic_field]]
        if ${click ? 'True' : 'False'}:
            if not callable(_basic_namespace.get('on_board_click')):
                raise ValueError('要使用棋盘点击，请先实现 on_board_click(state, row, col)')
            _basic_state = _basic_namespace['on_board_click'](_basic_state, ${click?.[0] ?? 0}, ${click?.[1] ?? 0})
        else:
            _basic_state = _basic_namespace['step_game'](_basic_state, ${JSON.stringify(key ?? '')})
    if not isinstance(_basic_state, dict):
        raise ValueError('请返回包含 snake、food、direction、score、game_over、won 的字典')
    def _basic_cell(p):
        return isinstance(p, (list, tuple)) and len(p) == 2 and all(type(n) is int and 0 <= n < 10 for n in p)
    _basic_snake = _basic_state.get('snake')
    if not isinstance(_basic_snake, (list, tuple)) or not 1 <= len(_basic_snake) <= 100 or not all(_basic_cell(p) for p in _basic_snake):
        raise ValueError('snake 需为 1—100 个（行，列）坐标，坐标范围 0—9')
    if len(set(tuple(p) for p in _basic_snake)) != len(_basic_snake):
        raise ValueError('蛇身坐标不能重叠；碰撞时请保留原蛇身并设置 game_over')
    if 'food' not in _basic_state or (_basic_state['food'] is not None and not _basic_cell(_basic_state['food'])):
        raise ValueError('food 需为（行，列）坐标，满盘时为 None')
    if _basic_state['food'] is not None and tuple(_basic_state['food']) in [tuple(p) for p in _basic_snake]:
        raise ValueError('食物不能与蛇身重叠')
    for _basic_field in ('obstacles', 'path'):
        if _basic_field in _basic_state:
            _basic_cells = _basic_state[_basic_field]
            if not isinstance(_basic_cells, (list, tuple)) or len(_basic_cells) > 100 or not all(_basic_cell(p) for p in _basic_cells):
                raise ValueError(_basic_field + ' 需为棋盘内的坐标列表，最多 100 格')
            if len(set(tuple(p) for p in _basic_cells)) != len(_basic_cells):
                raise ValueError(_basic_field + ' 不能包含重复坐标')
    if 'obstacles' in _basic_state:
        _basic_walls = set(tuple(p) for p in _basic_state['obstacles'])
        if _basic_walls.intersection(tuple(p) for p in _basic_snake) or (_basic_state['food'] is not None and tuple(_basic_state['food']) in _basic_walls):
            raise ValueError('障碍不能与蛇身或食物重叠')
    if type(_basic_state.get('score')) is not int:
        raise ValueError('score 需为整数')
    if _basic_state.get('direction') not in ('up', 'down', 'left', 'right'):
        raise ValueError('direction 需为 up、down、left 或 right')
    if type(_basic_state.get('game_over')) is not bool or type(_basic_state.get('won')) is not bool:
        raise ValueError('game_over 和 won 需为 True 或 False')
    _basic_encoded = json.dumps(_basic_state, ensure_ascii=False, allow_nan=False)
    if len(_basic_encoded) > 32000:
        raise ValueError('游戏状态过大，请减少附加数据')
    _basic_result['state'] = _basic_state
except Exception as _basic_error:
    _basic_frames = [f for f in traceback.extract_tb(_basic_error.__traceback__) if f.filename == '<main.py>']
    _basic_line = getattr(_basic_error, 'lineno', None) or (_basic_frames[-1].lineno if _basic_frames else None)
    _basic_result['error'] = (('第 ' + str(_basic_line) + ' 行：') if _basic_line else '') + type(_basic_error).__name__ + ': ' + str(_basic_error)[:1500]
_basic_result['output'] = ''.join(_free_lines).splitlines()[:200]
json.dumps(_basic_result, ensure_ascii=False)
`;
}

export const runBasicSnake = (code: string, state: BasicSnakeState | null = null, key?: SnakeKey, click?: Cell) =>
  runPythonJson<BasicSnakeResult>(basicSnakeHarness(code, state, key, click));
