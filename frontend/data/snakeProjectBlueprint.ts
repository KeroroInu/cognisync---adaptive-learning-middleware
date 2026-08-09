import type { Language } from '../types';

export type ProjectStage = 'observe' | 'decompose' | 'model' | 'plan' | 'build';

export type SnakeRuntimeEvidenceType =
  | 'opened'
  | 'started'
  | 'paused'
  | 'direction'
  | 'moved'
  | 'food_spawn'
  | 'food_eaten'
  | 'collision'
  | 'reset';

export interface SnakeRuntimeEvidence {
  id: string;
  type: SnakeRuntimeEvidenceType;
  timestamp: string;
  details?: {
    direction?: 'up' | 'down' | 'left' | 'right';
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
    scoreBefore?: number;
    scoreAfter?: number;
    lengthBefore?: number;
    lengthAfter?: number;
    collisionType?: 'boundary' | 'self';
  };
}

export interface BlueprintNode {
  id: string;
  titleZh: string;
  titleEn: string;
  scenarioZh: string;
  scenarioEn: string;
  knowledgeZh: string[];
  knowledgeEn: string[];
  prerequisites: string[];
  functionTemplate: string;
  visualizationUnlockZh: string;
  visualizationUnlockEn: string;
}

export interface ScaffoldHint {
  labelZh: string;
  labelEn: string;
  bodyZh: string;
  bodyEn: string;
}

/**
 * 教师隐藏参考蓝图（学生端不可直接展示）。
 * 当前先作为前端原型中的诊断依据，后续迁移到教师端可编辑配置。
 */
export const SNAKE_PROJECT_BLUEPRINT: BlueprintNode[] = [
  {
    id: 'initial-state',
    titleZh: '初始化与重置',
    titleEn: 'Initialize and reset',
    scenarioZh: '开始或重新开始游戏',
    scenarioEn: 'Start or restart the game',
    knowledgeZh: ['变量', '列表', '坐标'],
    knowledgeEn: ['Variables', 'Lists', 'Coordinates'],
    prerequisites: [],
    functionTemplate: 'def create_initial_state():',
    visualizationUnlockZh: '网格、静态蛇、初始分数',
    visualizationUnlockEn: 'Grid, static snake and initial score',
  },
  {
    id: 'direction-input',
    titleZh: '方向输入',
    titleEn: 'Direction input',
    scenarioZh: '按下方向键',
    scenarioEn: 'Press a direction key',
    knowledgeZh: ['条件判断', '状态变量'],
    knowledgeEn: ['Conditionals', 'State variables'],
    prerequisites: ['initial-state'],
    functionTemplate: 'def change_direction(current_direction, next_direction):',
    visualizationUnlockZh: '方向指示',
    visualizationUnlockEn: 'Direction indicator',
  },
  {
    id: 'movement',
    titleZh: '位置更新',
    titleEn: 'Position update',
    scenarioZh: '蛇向前移动一格',
    scenarioEn: 'The snake moves one cell',
    knowledgeZh: ['列表添加与删除', '坐标运算'],
    knowledgeEn: ['List insertion and removal', 'Coordinate arithmetic'],
    prerequisites: ['initial-state', 'direction-input'],
    functionTemplate: 'def move_snake(snake, direction):',
    visualizationUnlockZh: '蛇逐格移动',
    visualizationUnlockEn: 'Cell-by-cell movement',
  },
  {
    id: 'food-spawn',
    titleZh: '食物生成',
    titleEn: 'Food spawn',
    scenarioZh: '果实出现在空闲网格',
    scenarioEn: 'Food appears on an empty cell',
    knowledgeZh: ['随机数', '循环', '成员判断'],
    knowledgeEn: ['Random values', 'Loops', 'Membership checks'],
    prerequisites: ['initial-state'],
    functionTemplate: 'def spawn_food(snake, board_size):',
    visualizationUnlockZh: '果实出现',
    visualizationUnlockEn: 'Food appears',
  },
  {
    id: 'eat-grow-score',
    titleZh: '进食、增长与计分',
    titleEn: 'Eat, grow and score',
    scenarioZh: '蛇头接触果实',
    scenarioEn: 'The head reaches food',
    knowledgeZh: ['条件判断', '列表', '状态更新'],
    knowledgeEn: ['Conditionals', 'Lists', 'State updates'],
    prerequisites: ['movement', 'food-spawn'],
    functionTemplate: 'def apply_food_effect(snake, food, score):',
    visualizationUnlockZh: '蛇身增长与得分变化',
    visualizationUnlockEn: 'Growth and score feedback',
  },
  {
    id: 'collision',
    titleZh: '碰撞判断',
    titleEn: 'Collision check',
    scenarioZh: '撞到边界或自身',
    scenarioEn: 'Hit the boundary or the snake body',
    knowledgeZh: ['比较运算', '成员判断', '布尔值'],
    knowledgeEn: ['Comparisons', 'Membership checks', 'Booleans'],
    prerequisites: ['movement'],
    functionTemplate: 'def check_collision(snake, board_size):',
    visualizationUnlockZh: '游戏结束状态',
    visualizationUnlockEn: 'Game-over state',
  },
  {
    id: 'game-loop',
    titleZh: '循环、速度与整合',
    titleEn: 'Loop, speed and integration',
    scenarioZh: '游戏持续运行并逐步加速',
    scenarioEn: 'The game keeps running and speeds up',
    knowledgeZh: ['循环', '函数组合', '时间间隔'],
    knowledgeEn: ['Loops', 'Function composition', 'Timing'],
    prerequisites: ['direction-input', 'movement', 'food-spawn', 'eat-grow-score', 'collision'],
    functionTemplate: 'def step_game(state, user_input):',
    visualizationUnlockZh: '完整可运行项目',
    visualizationUnlockEn: 'Complete runnable project',
  },
];

export const STAGE_SCAFFOLDS: Record<ProjectStage, ScaffoldHint[]> = {
  observe: [
    {
      labelZh: '想一想',
      labelEn: 'Think once',
      bodyZh: '只改变一个操作，再比较操作前后画面中发生了什么。先记录证据，不急着解释原因。',
      bodyEn: 'Change one action and compare the screen before and after. Record evidence before explaining it.',
    },
    {
      labelZh: '看这里',
      labelEn: 'Look here',
      bodyZh: '从方向、位置、数量、分数和运行状态中选一个变化，尝试用一句话描述。',
      bodyEn: 'Choose one change in direction, position, quantity, score or run state and describe it in one sentence.',
    },
    {
      labelZh: '按句式记录',
      labelEn: 'Use a sentence frame',
      bodyZh: '使用“当我进行____操作后，我观察到____发生了变化”完成一张观察卡。',
      bodyEn: 'Use “After I did ____, I observed that ____ changed” to complete one observation card.',
    },
    {
      labelZh: '帮你补一步',
      labelEn: 'Complete one step',
      bodyZh: '我会引用最近一次运行证据，生成一条最小观察记录。它会被标记为AI辅助，你仍需检查和修改。',
      bodyEn: 'I will turn the latest runtime evidence into one minimal observation, marked as AI-assisted for you to review.',
    },
  ],
  decompose: [
    {
      labelZh: '想一想',
      labelEn: 'Think once',
      bodyZh: '选择一张观察卡，思考程序必须承担什么职责，才能产生这个现象。',
      bodyEn: 'Choose one observation and ask what responsibility the program needs to produce it.',
    },
    {
      labelZh: '定位职责',
      labelEn: 'Locate the responsibility',
      bodyZh: '不要先写函数名，先补全：“接收什么、判断或改变什么、产生什么结果”。',
      bodyEn: 'Do not name the function yet. State what it receives, changes or decides, and produces.',
    },
    {
      labelZh: '按结构拆分',
      labelEn: 'Use the structure',
      bodyZh: '把功能卡拆成输入、处理、输出和验证四格；相同职责可以合并，职责不同应分开。',
      bodyEn: 'Split the card into input, process, output and verification. Merge equal responsibilities and separate different ones.',
    },
    {
      labelZh: '帮你补一步',
      labelEn: 'Complete one step',
      bodyZh: '我会根据当前观察补出一个最小功能职责句，但不会替你完成其他功能卡。',
      bodyEn: 'I will supply one minimal function-responsibility sentence from the current observation, not the remaining cards.',
    },
  ],
  model: [
    {
      labelZh: '想一想',
      labelEn: 'Think once',
      bodyZh: '先问：这个功能开始运行前必须已经有哪些数据或结果？',
      bodyEn: 'Ask what data or results must already exist before this function can run.',
    },
    {
      labelZh: '找依赖',
      labelEn: 'Find a dependency',
      bodyZh: '检查每张功能卡的输入来自哪里、输出又会被哪张卡片使用。',
      bodyEn: 'Check where each card receives input and which card uses its output.',
    },
    {
      labelZh: '补齐关系',
      labelEn: 'Complete relations',
      bodyZh: '使用“前置、并行、汇合、可替代”四种关系重新检查连线，尤其注意有多个前置条件的功能。',
      bodyEn: 'Review links using prerequisite, parallel, convergence and alternative relations, especially nodes with multiple prerequisites.',
    },
    {
      labelZh: '帮你补一步',
      labelEn: 'Complete one step',
      bodyZh: '我会指出并补上一条阻塞当前流程的必要依赖，你仍需解释这条连接。',
      bodyEn: 'I will add one required dependency blocking the flow; you still need to explain the link.',
    },
  ],
  plan: [
    {
      labelZh: '想一想',
      labelEn: 'Think once',
      bodyZh: '为当前功能写清楚输入和预期输出，再考虑中间步骤。',
      bodyEn: 'Clarify the input and expected output before considering intermediate steps.',
    },
    {
      labelZh: '定位缺口',
      labelEn: 'Locate the gap',
      bodyZh: '检查流程图是否包含开始、处理、必要判断、结果输出和结束。',
      bodyEn: 'Check whether the flow includes a start, process, required decision, output and end.',
    },
    {
      labelZh: '给出骨架',
      labelEn: 'Provide a skeleton',
      bodyZh: '先按“读取状态→判断条件→更新状态→返回结果”搭出骨架，再填具体规则。',
      bodyEn: 'Build “read state → test condition → update state → return result” before adding rules.',
    },
    {
      labelZh: '帮你补一步',
      labelEn: 'Complete one step',
      bodyZh: '我会补充一个缺失的判断或处理节点，并保留条件与结果让你填写。',
      bodyEn: 'I will add one missing decision or process node while leaving its condition and result for you.',
    },
  ],
  build: [
    {
      labelZh: '想一想',
      labelEn: 'Think once',
      bodyZh: '先阅读失败测试：实际结果与预期结果具体差在哪里？',
      bodyEn: 'Read the failing test first. How does the actual result differ from the expected result?',
    },
    {
      labelZh: '定位代码',
      labelEn: 'Locate the code',
      bodyZh: '根据流程图找到负责这个状态变化的函数，只检查相关输入、判断和返回值。',
      bodyEn: 'Use the flowchart to locate the responsible function and inspect only its inputs, conditions and return value.',
    },
    {
      labelZh: '给出伪代码',
      labelEn: 'Provide pseudocode',
      bodyZh: '我会提供局部伪代码步骤，但保留关键表达式和变量由你完成。',
      bodyEn: 'I will provide local pseudocode while leaving key expressions and variables for you.',
    },
    {
      labelZh: '帮你补一步',
      labelEn: 'Complete one step',
      bodyZh: '我会补全导致测试无法推进的最小代码片段，并要求你重新运行、解释和修改。',
      bodyEn: 'I will fill the smallest blocking code fragment, then require you to rerun, explain and revise it.',
    },
  ],
};

const DIRECTION_LABELS = {
  zh: { up: '上', down: '下', left: '左', right: '右' },
  en: { up: 'up', down: 'down', left: 'left', right: 'right' },
};

export const formatSnakeEvidence = (evidence: SnakeRuntimeEvidence, language: Language): string => {
  const isZh = language === 'zh';
  const details = evidence.details ?? {};
  const direction = details.direction ? DIRECTION_LABELS[language][details.direction] : '';

  switch (evidence.type) {
    case 'opened':
      return isZh ? '打开了完整项目' : 'Opened the complete project';
    case 'started':
      return isZh ? '点击开始后，游戏进入连续运行状态' : 'The game entered a continuous run after Start';
    case 'paused':
      return isZh ? '点击暂停后，画面停止更新' : 'The screen stopped updating after Pause';
    case 'direction':
      return isZh ? `按下了“${direction}”方向` : `Pressed the ${direction} direction`;
    case 'moved':
      return isZh
        ? `蛇头从（${details.fromX}, ${details.fromY}）移动到（${details.toX}, ${details.toY}）`
        : `The head moved from (${details.fromX}, ${details.fromY}) to (${details.toX}, ${details.toY})`;
    case 'food_spawn':
      return isZh ? '果实出现在蛇身之外的空闲网格' : 'Food appeared on an empty cell outside the snake';
    case 'food_eaten':
      return isZh
        ? `分数从 ${details.scoreBefore} 变为 ${details.scoreAfter}，蛇身从 ${details.lengthBefore} 格变为 ${details.lengthAfter} 格`
        : `Score changed from ${details.scoreBefore} to ${details.scoreAfter}, length from ${details.lengthBefore} to ${details.lengthAfter}`;
    case 'collision':
      return details.collisionType === 'self'
        ? (isZh ? '蛇头接触蛇身后，游戏停止运行' : 'The game stopped after the head touched the body')
        : (isZh ? '蛇头到达边界外后，游戏停止运行' : 'The game stopped after the head crossed the boundary');
    case 'reset':
      return isZh ? '点击重新开始后，分数和蛇身恢复到初始状态' : 'Score and snake returned to the initial state after Restart';
    default:
      return isZh ? '记录了一次项目运行变化' : 'Captured a runtime change';
  }
};
