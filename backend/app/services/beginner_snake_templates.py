"""Beginner scaffolds: familiar syntax, one-line comments, one or two gaps.

These are project adaptations, not textbook quotations. Function signatures and
state dictionaries are runner scaffolding, not assumed prior student knowledge.
"""

SOLUTIONS = {
    "initial-state": """def create_initial_state(board_size=12, initial_length=3):
    y = board_size // 2
    head_x = max(initial_length - 1, board_size // 2)
    snake = []
    # 从蛇头开始，依次放入身体坐标
    for offset in range(initial_length):
        snake.append((head_x - offset, y))
    return snake, 'right', 0""",
    "direction-input": """def change_direction(current_direction, next_direction):
    opposite = {'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left'}
    if next_direction not in opposite:
        return current_direction
    # 不允许直接掉头
    if next_direction == opposite[current_direction]:
        return current_direction
    return next_direction""",
    "movement": """def move_snake(snake, direction):
    delta = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}
    dx, dy = delta[direction]
    head_x, head_y = snake[0]
    new_head = (head_x + dx, head_y + dy)
    new_snake = [new_head]
    # 保留原身体，最后一节蛇尾不放入
    for index in range(len(snake) - 1):
        new_snake.append(snake[index])
    return new_snake""",
    "food-spawn": """def spawn_food(snake, board_size):
    import random
    free_cells = []
    # 找出没有蛇身的格子
    for y in range(board_size):
        for x in range(board_size):
            if (x, y) not in snake:
                free_cells.append((x, y))
    if not free_cells:
        raise ValueError('No free cell for food')
    return random.choice(free_cells)""",
    "eat-grow-score": """def apply_food_effect(snake, food, score):
    if snake[0] == food:
        grown_snake = list(snake)
        grown_snake.append(snake[-1])
        # 吃到食物才加分
        new_score = score + 10
        return grown_snake, new_score, True
    return snake, score, False""",
    "collision": """def check_collision(snake, board_size):
    x, y = snake[0]
    outside = x < 0 or x >= board_size or y < 0 or y >= board_size
    hit_self = False
    # 从第二节开始检查，不能把蛇头算进去
    for index in range(1, len(snake)):
        if snake[0] == snake[index]:
            hit_self = True
    return outside or hit_self""",
    "game-loop": """def step_game(state, user_input):
    if state['game_over']:
        return state
    if user_input:
        state['direction'] = change_direction(state['direction'], user_input)
    # 移动后，先检查游戏是否结束
    state['snake'] = move_snake(state['snake'], state['direction'])
    state['game_over'] = check_collision(state['snake'], 12)
    if state['game_over']:
        return state
    # 处理进食，需要时再生成食物
    before_score = state['score']
    effect = apply_food_effect(state['snake'], state['food'], state['score'])
    state['snake'] = effect[0]
    state['score'] = effect[1]
    # 兼容旧函数只返回蛇身、分数两个值
    needs_food = state['score'] > before_score
    if len(effect) > 2:
        needs_food = effect[2]
    if needs_food:
        state['food'] = spawn_food(state['snake'], 12)
    return state""",
}

# Each replacement is a legal placeholder, not a promise of behavioral correctness.
GAPS = {
    "initial-state": [
        ("snake.append((head_x - offset, y))", "# TODO：把 0 改成每节身体的横坐标\n        snake.append((0, y))"),
        ("y = board_size // 2", "# TODO：让蛇出现在棋盘中间一行\n    y = 0"),
    ],
    "direction-input": [
        ("if next_direction == opposite[current_direction]:", "# TODO：把 False 换成反向判断\n    if False:"),
        ("if next_direction not in opposite:", "# TODO：把 False 换成无效按键判断\n    if False:"),
    ],
    "movement": [
        ("new_head = (head_x + dx, head_y + dy)", "# TODO：更新蛇头的横、纵坐标\n    new_head = (head_x, head_y)"),
        ("range(len(snake) - 1)", "range(0)"),
    ],
    "food-spawn": [
        ("if (x, y) not in snake:", "# TODO：把 True 换成空格判断\n            if True:"),
        ("return random.choice(free_cells)", "# TODO：随机选一个空格\n    return free_cells[0]"),
    ],
    "eat-grow-score": [
        ("new_score = score + 10", "# TODO：把 0 改成本次增加的分数\n        new_score = score + 0"),
        ("if snake[0] == food:", "# TODO：把 False 换成进食判断\n    if False:"),
    ],
    "collision": [
        ("return outside or hit_self", "# TODO：把 False 换成两个判断的组合\n    return False"),
        ("if snake[0] == snake[index]:", "# TODO：判断蛇头是否碰到这一节身体\n        if False:"),
    ],
    "game-loop": [
        ("if needs_food:", "# TODO：根据进食结果判断是否需要新食物\n    if False:"),
        ("if state['game_over']:\n        return state\n    # 处理进食", "# TODO：把 False 换成游戏结束判断\n    if False:\n        return state\n    # 处理进食"),
    ],
}


def make_template(module: str, gap_count: int = 1) -> str:
    code = SOLUTIONS[module]
    for before, after in GAPS[module][:max(1, min(2, gap_count))]:
        code = code.replace(before, after, 1)
    if module == "movement" and gap_count >= 2:
        code = code.replace("# 保留原身体，最后一节蛇尾不放入", "# TODO：把 range(0) 改为遍历除蛇尾外的身体")
    return code


GUIDED = {module: make_template(module) for module in SOLUTIONS}
BALANCED = {module: make_template(module, 2) for module in SOLUTIONS}
