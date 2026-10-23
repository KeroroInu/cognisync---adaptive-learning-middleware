/** Separate contract: never interpret legacy 12×12/seven-function saves as this game. */
export const BASIC_SNAKE_RUNTIME = 'basic-snake/v1';
export type Cell = [number, number]; // row, column
export type SnakeKey = 'w' | 'a' | 's' | 'd';
export const snakeDirectionKey: Record<string, SnakeKey> = { up: 'w', left: 'a', down: 's', right: 'd' };
export interface BasicSnakeState {
  snake: Cell[];
  food: Cell | null;
  /** Optional student-defined challenge state; the platform does not plan a route. */
  obstacles?: Cell[];
  path?: Cell[];
  direction: string;
  score: number;
  game_over: boolean;
  won: boolean;
}

// The full, editable starting project follows code_self/rewrite.py. The browser
// replaces only input()/render(); all movement, food and scoring live in Python.
export const BASIC_SNAKE_CODE = `import random

# 坐标按（行，列）记录，从 0 开始。
ROWS, COLS = 10, 10

def new_food(snake):
    # 从空格中选食物，棋盘满了就返回 None。
    empty = [(r, c) for r in range(ROWS) for c in range(COLS)
             if (r, c) not in snake]
    return random.choice(empty) if empty else None

def create_initial_state():
    # 点击“运行代码”或“重新开始”时调用。
    return {
        "snake": [(4, 6), (4, 5), (4, 4)],
        "food": (4, 7), "direction": "right", "score": 0,
        "game_over": False, "won": False
    }

def step_game(state, key):
    # 游戏循环每轮调用一次：按当前方向走一格。
    # W/A/S/D 改变方向，不按键也会继续前进。
    directions = {"w": (-1, 0), "s": (1, 0),
                  "a": (0, -1), "d": (0, 1)}
    names = {"w": "up", "s": "down", "a": "left", "d": "right"}
    if state["game_over"] or key not in directions:
        return state

    snake = state["snake"]
    row, col = snake[0]
    dr, dc = directions[key]
    head = (row + dr, col + dc)
    state["direction"] = names[key]
    eating = head == state["food"]

    # 不吃食物时，尾格会腾出来，可以走进去。
    occupied = snake if eating else snake[:-1]
    if not (0 <= head[0] < ROWS and 0 <= head[1] < COLS) or head in occupied:
        state["game_over"] = True
        return state

    snake.insert(0, head)
    if eating:
        state["score"] += 1
        state["food"] = new_food(snake)
        if state["food"] is None:
            state["won"] = True
            state["game_over"] = True
    else:
        snake.pop()
    return state
`;

export function basicSnakeSavedCode(workspace: Record<string, unknown> | null | undefined): string | null {
  const saved = workspace?.basicSnake as { runtime?: unknown; code?: unknown } | undefined;
  return saved?.runtime === BASIC_SNAKE_RUNTIME && typeof saved.code === 'string' ? saved.code : null;
}
