/**
 * 学生端公开的七个基础函数壳。
 *
 * 这里只保存产品明确要求学生看到的卡片名称、函数签名与空白起始代码；
 * 教师同义表达、推荐依赖、场景说明、测试输入输出和支架规则不进入该文件。
 */
export interface SnakeBuildFunction {
  id: string;
  titleZh: string;
  titleEn: string;
  signature: string;
  starterCode: string;
  effectZh: string;
  effectEn: string;
}

export const SNAKE_BUILD_FUNCTIONS: SnakeBuildFunction[] = [
  {
    id: 'initial-state',
    titleZh: '初始化与重置',
    titleEn: 'Initialize and reset',
    signature: 'def create_initial_state(board_size=12, initial_length=3):',
    starterCode: `def create_initial_state(board_size=12, initial_length=3):\n    # 创建蛇身列表、方向和初始得分\n    # TODO: 返回这三项初始状态\n    pass`,
    effectZh: '初始蛇身、方向和分数已由你的代码生成',
    effectEn: 'Initial snake, direction and score now come from your code',
  },
  {
    id: 'direction-input',
    titleZh: '更新方向',
    titleEn: 'Update direction',
    signature: 'def change_direction(current_direction, next_direction):',
    starterCode: `def change_direction(current_direction, next_direction):\n    # 相反方向不能立即采用\n    # TODO: 返回安全的新方向\n    pass`,
    effectZh: '方向键已接入你的方向函数',
    effectEn: 'Direction controls now use your direction function',
  },
  {
    id: 'movement',
    titleZh: '移动蛇身',
    titleEn: 'Move the snake',
    signature: 'def move_snake(snake, direction):',
    starterCode: `def move_snake(snake, direction):\n    # 根据方向计算新蛇头，再移除蛇尾\n    # TODO: 返回更新后的蛇身\n    pass`,
    effectZh: '每一帧的蛇身位置由你的移动函数更新',
    effectEn: 'Every frame now uses your movement function',
  },
  {
    id: 'food-spawn',
    titleZh: '生成食物',
    titleEn: 'Spawn food',
    signature: 'def spawn_food(snake, board_size):',
    starterCode: `def spawn_food(snake, board_size):\n    # 选择棋盘内且不与蛇身重合的坐标\n    # TODO: 返回合法食物位置\n    pass`,
    effectZh: '食物位置由你的生成函数决定',
    effectEn: 'Food positions now come from your spawn function',
  },
  {
    id: 'eat-grow-score',
    titleZh: '进食、增长和计分',
    titleEn: 'Eat, grow and score',
    signature: 'def apply_food_effect(snake, food, score):',
    starterCode: `def apply_food_effect(snake, food, score):\n    # 判断蛇头是否到达食物\n    # TODO: 返回更新后的蛇身和得分\n    pass`,
    effectZh: '增长与得分变化由你的进食函数处理',
    effectEn: 'Growth and scoring now use your food-effect function',
  },
  {
    id: 'collision',
    titleZh: '碰撞判断',
    titleEn: 'Check collision',
    signature: 'def check_collision(snake, board_size):',
    starterCode: `def check_collision(snake, board_size):\n    # 检查蛇头是否越界或碰到自身\n    # TODO: 返回 True 或 False\n    pass`,
    effectZh: '边界与自身碰撞由你的判断函数处理',
    effectEn: 'Boundary and self collisions now use your function',
  },
  {
    id: 'game-loop',
    titleZh: '游戏循环',
    titleEn: 'Game loop',
    signature: 'def step_game(state, user_input):',
    starterCode: `def step_game(state, user_input):\n    # 每次只推进一个游戏时刻\n    # TODO: 调用前面的函数并返回完整的新状态\n    pass`,
    effectZh: '完整游戏的每一步由你的循环函数组织',
    effectEn: 'Every complete game step now uses your loop function',
  },
];

export const SNAKE_BUILD_FUNCTION_BY_ID = new Map(
  SNAKE_BUILD_FUNCTIONS.map(item => [item.id, item]),
);
