import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BASIC_SNAKE_CODE, basicSnakeSavedCode, type BasicSnakeState, type Cell, type SnakeKey } from '../data/basicSnake';
import { basicSnakeHarness, type BasicSnakeResult } from '../services/basicSnakeRunner';

const python = process.env.COGNISYNC_TEST_PYTHON || 'python3';
const run = (code = BASIC_SNAKE_CODE, state: BasicSnakeState | null = null, key?: SnakeKey, click?: Cell): BasicSnakeResult => JSON.parse(execFileSync(python,
  ['-c', `${basicSnakeHarness(code, state, key, click)}\nprint(json.dumps(_basic_result))`], { encoding: 'utf8', timeout: 5000 }));
const initial = (): BasicSnakeState => run().state!;

describe('basic-snake/v1 — actual Python, row-first, no legacy fallback', () => {
  it('starts exactly as rewrite.py', () => {
    expect(initial()).toEqual({ snake: [[4, 6], [4, 5], [4, 4]], food: [4, 7], score: 0, direction: 'right', game_over: false, won: false });
  });
  it.each([['w', [3, 6]], ['s', [5, 6]]] as const)('takes one %s step and drops tail', (key, head) => {
    const state = run(BASIC_SNAKE_CODE, initial(), key).state!;
    expect(state.snake).toEqual([head, [4, 6], [4, 5]]); expect(state.score).toBe(0);
  });
  it('eats, grows one, scores one and places food only on empty cells', () => {
    const state = run(BASIC_SNAKE_CODE, initial(), 'd').state!;
    expect(state.snake).toEqual([[4, 7], [4, 6], [4, 5], [4, 4]]); expect(state.score).toBe(1);
    expect(state.food).not.toBeNull(); expect(state.snake).not.toContainEqual(state.food);
  });
  it('reverse hits neck rather than silently rejecting input', () => {
    const state = run(BASIC_SNAKE_CODE, initial(), 'a').state!;
    expect(state.game_over).toBe(true); expect(state.snake).toEqual(initial().snake);
  });
  it('wall collision ends without drawing an out-of-board head', () => {
    const state = { ...initial(), snake: [[0, 0], [0, 1], [0, 2]] } as BasicSnakeState;
    const result = run(BASIC_SNAKE_CODE, state, 'w');
    expect(result.error).toBe(''); expect(result.state?.game_over).toBe(true); expect(result.state?.snake[0]).toEqual([0, 0]);
  });
  it('can enter the tail cell vacated by an ordinary move', () => {
    const state = { ...initial(), snake: [[1, 1], [1, 2], [2, 2], [2, 1]] } as BasicSnakeState;
    const result = run(BASIC_SNAKE_CODE, state, 's');
    expect(result.error).toBe(''); expect(result.state?.game_over).toBe(false); expect(result.state?.snake).toEqual([[2, 1], [1, 1], [1, 2], [2, 2]]);
  });
  it('finishes a full board without retrying food forever', () => {
    const state = initial(); state.snake = [[0, 1]];
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) if (row || col > 1) state.snake.push([row, col]);
    state.food = [0, 0];
    const result = run(BASIC_SNAKE_CODE, state, 'a');
    expect(result.error).toBe(''); expect(result.state?.snake).toHaveLength(100);
    expect(result.state).toMatchObject({ game_over: true, won: true, food: null, score: 1 });
  });
  it('uses student changes for both initialization and movement/scoring', () => {
    const code = BASIC_SNAKE_CODE.replace('"score": 0', '"score": 8').replace('state["score"] += 1', 'state["score"] += 7');
    expect(run(code).state?.score).toBe(8);
    expect(run(code, run(code).state, 'd').state?.score).toBe(15);
  });
  it.each(['import os', 'import js', 'open("secret")', 'print((1).__class__)'])('rejects forbidden code %s', code => {
    const result = run(code); expect(result.state).toBeNull(); expect(result.error).not.toBe('');
  });
  it('missing functions, invalid states and syntax errors cannot become a demo', () => {
    expect(run('print(2)').state).toBeNull(); expect(run('print(2)').output).toEqual(['2']);
    expect(run('def bad(:').error).toContain('第 1 行');
    expect(run(BASIC_SNAKE_CODE.replace('"score": 0', '"score": "oops"')).error).toContain('score');
    expect(run(BASIC_SNAKE_CODE.replace('(4, 6)', '(11, 6)')).state).toBeNull();
  });
  it('reports an error only reached during movement, with its actual source line', () => {
    const code = BASIC_SNAKE_CODE.replace('state["score"] += 1', 'state["score"] += missing');
    expect(run(code).error).toBe('');
    expect(run(code, initial(), 'd').error).toMatch(/第 \d+ 行：NameError/);
  });
  it('passes a board click to student Python rather than placing food for them', () => {
    expect(run(BASIC_SNAKE_CODE, initial(), undefined, [0, 0]).error).toContain('on_board_click');
    const code = `${BASIC_SNAKE_CODE}\n\ndef on_board_click(state, row, col):\n    state["food"] = (row, col)\n    state["obstacles"] = [(0, 1)]\n    state["path"] = [(0, 0), (1, 0)]\n    return state\n`;
    const clicked = run(code, initial(), undefined, [0, 0]);
    expect(clicked.error).toBe('');
    expect(clicked.state).toMatchObject({ food: [0, 0], obstacles: [[0, 1]], path: [[0, 0], [1, 0]] });
    const moved = run(code, clicked.state, 'w');
    expect(moved.error).toBe('');
    expect(moved.state?.obstacles).toEqual([[0, 1]]);
  });
  it('rejects obstacles that hide the snake or food', () => {
    const code = `${BASIC_SNAKE_CODE}\n\ndef on_board_click(state, row, col):\n    state["obstacles"] = [state["snake"][0]]\n    return state\n`;
    expect(run(code, initial(), undefined, [0, 0]).error).toContain('障碍不能与蛇身或食物重叠');
  });
  it('restores only the explicit new namespace, retaining empty edits', () => {
    expect(basicSnakeSavedCode({ progress: { old: 'legacy' } })).toBeNull();
    expect(basicSnakeSavedCode({ basicSnake: { runtime: 'unknown', code: 'bad' } })).toBeNull();
    expect(basicSnakeSavedCode({ basicSnake: { runtime: 'basic-snake/v1', code: '' } })).toBe('');
  });
});
