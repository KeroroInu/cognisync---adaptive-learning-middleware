import type { StudentObservationCard } from '../components/ProjectFactory';
import type { StudentFunctionCard } from '../components/ProjectFunctionStage';
import {
  createDefaultCanvasPositions,
  STUDENT_CANVAS_LAYOUT_VERSION,
  type StudentFunctionMechanism,
  type StudentModuleProgress,
  type StudentPathPlan,
} from './projectPath';
import type { SnakeRuntimeEvidence } from './snakeProjectBlueprint';

const OBSERVATIONS: StudentObservationCard[] = [
  {
    id: 'demo-observation-initial',
    evidenceId: 'reset-demo',
    evidenceText: '点击重置后，蛇、方向和得分恢复到起始状态',
    observationText: '重置后蛇回到固定位置，得分变为 0，方向恢复为右。',
    source: 'student',
    createdAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'demo-observation-direction',
    evidenceId: 'direction-demo',
    evidenceText: '按下方向键后，蛇的前进方向发生变化',
    observationText: '方向键可以改变前进方向，但不能立即向相反方向掉头。',
    source: 'student',
    createdAt: '2026-01-01T08:01:00.000Z',
  },
  {
    id: 'demo-observation-movement',
    evidenceId: 'moved-demo',
    evidenceText: '蛇头前进一格，同时蛇尾减少一格',
    observationText: '运行时蛇头每隔一段时间前进一格，蛇尾同时少一格。',
    source: 'student',
    createdAt: '2026-01-01T08:02:00.000Z',
  },
  {
    id: 'demo-observation-food',
    evidenceId: 'food_spawn-demo',
    evidenceText: '果实出现后始终位于网格空白位置',
    observationText: '果实出现在网格内，并且不会与当前蛇身重合。',
    source: 'student',
    createdAt: '2026-01-01T08:03:00.000Z',
  },
  {
    id: 'demo-observation-eat',
    evidenceId: 'food_eaten-demo',
    evidenceText: '分数从 0 变为 10，蛇身从 3 格变为 4 格',
    observationText: '蛇头碰到果实后，蛇身增加一格，得分增加 10。',
    source: 'student',
    createdAt: '2026-01-01T08:04:00.000Z',
  },
  {
    id: 'demo-observation-collision',
    evidenceId: 'collision-demo',
    evidenceText: '蛇头到达边界或自身位置后游戏停止',
    observationText: '蛇头撞到边界或自己的身体后，游戏会停止运行。',
    source: 'student',
    createdAt: '2026-01-01T08:05:00.000Z',
  },
  {
    id: 'demo-observation-loop',
    evidenceId: 'started-demo',
    evidenceText: '点击开始后，游戏按固定间隔持续更新',
    observationText: '点击开始后，移动、进食和碰撞等行为会被持续组合执行。',
    source: 'student',
    createdAt: '2026-01-01T08:06:00.000Z',
  },
];

const RAW_FUNCTIONS: StudentFunctionCard[] = [
  {
    id: 'demo-function-initial',
    observationId: 'demo-observation-initial',
    evidenceId: 'reset-demo',
    observationText: OBSERVATIONS[0].observationText,
    responsibility: '建立并重置游戏状态',
    input: '棋盘大小、初始长度',
    output: '蛇身、方向、得分',
    knowledge: ['变量', '列表', '坐标'],
    verification: '给定输入比较输出',
    source: 'student',
    createdAt: '2026-01-01T08:10:00.000Z',
    updatedAt: '2026-01-01T08:10:00.000Z',
  },
  {
    id: 'demo-function-direction',
    observationId: 'demo-observation-direction',
    evidenceId: 'direction-demo',
    observationText: OBSERVATIONS[1].observationText,
    responsibility: '根据按键安全更新方向',
    input: '当前方向、目标方向',
    output: '可采用的新方向',
    knowledge: ['变量', '条件判断', '布尔值'],
    verification: '测试边界情况',
    source: 'student',
    createdAt: '2026-01-01T08:11:00.000Z',
    updatedAt: '2026-01-01T08:11:00.000Z',
  },
  {
    id: 'demo-function-movement',
    observationId: 'demo-observation-movement',
    evidenceId: 'moved-demo',
    observationText: OBSERVATIONS[2].observationText,
    responsibility: '根据方向移动蛇身一格',
    input: '蛇身坐标、当前方向',
    output: '更新后的蛇身列表',
    knowledge: ['列表', '函数', '坐标'],
    verification: '给定输入比较输出',
    source: 'student',
    createdAt: '2026-01-01T08:12:00.000Z',
    updatedAt: '2026-01-01T08:12:00.000Z',
  },
  {
    id: 'demo-function-food',
    observationId: 'demo-observation-food',
    evidenceId: 'food_spawn-demo',
    observationText: OBSERVATIONS[3].observationText,
    responsibility: '在空闲网格生成食物',
    input: '蛇身坐标、棋盘大小',
    output: '合法食物坐标',
    knowledge: ['列表', '循环', '随机数', '坐标'],
    verification: '重复运行检查稳定性',
    source: 'student',
    createdAt: '2026-01-01T08:13:00.000Z',
    updatedAt: '2026-01-01T08:13:00.000Z',
  },
  {
    id: 'demo-function-eat',
    observationId: 'demo-observation-eat',
    evidenceId: 'food_eaten-demo',
    observationText: OBSERVATIONS[4].observationText,
    responsibility: '处理进食、增长和计分',
    input: '蛇身、食物、当前得分',
    output: '新蛇身、新得分',
    knowledge: ['变量', '列表', '条件判断'],
    verification: '运行后观察变化',
    source: 'student',
    createdAt: '2026-01-01T08:14:00.000Z',
    updatedAt: '2026-01-01T08:14:00.000Z',
  },
  {
    id: 'demo-function-collision',
    observationId: 'demo-observation-collision',
    evidenceId: 'collision-demo',
    observationText: OBSERVATIONS[5].observationText,
    responsibility: '判断边界和自身碰撞',
    input: '蛇身坐标、棋盘大小',
    output: '是否结束游戏',
    knowledge: ['列表', '条件判断', '布尔值'],
    verification: '测试边界情况',
    source: 'student',
    createdAt: '2026-01-01T08:15:00.000Z',
    updatedAt: '2026-01-01T08:15:00.000Z',
  },
  {
    id: 'demo-function-loop',
    observationId: 'demo-observation-loop',
    evidenceId: 'started-demo',
    observationText: OBSERVATIONS[6].observationText,
    responsibility: '按时间间隔组合全部功能',
    input: '当前状态、用户输入',
    output: '下一时刻游戏状态',
    knowledge: ['循环', '函数', '变量'],
    verification: '运行后观察变化',
    source: 'student',
    createdAt: '2026-01-01T08:16:00.000Z',
    updatedAt: '2026-01-01T08:16:00.000Z',
  },
];

const DEMO_MAPPING_META: Record<string, {
  nodeId: string;
  title: string;
  boundaryReason: string;
  responsibilityOwner: 'student-core' | 'ai-supported';
  /** 一句「这个功能如何实现」，只用于补齐固定 demo 卡缺失的新字段 */
  implementation: string;
}> = {
  'demo-function-initial': { nodeId: 'initial-state', title: '建立与重置初始状态', boundaryReason: '它有独立的输入和输出', responsibilityOwner: 'ai-supported' , implementation: '先准备棋盘大小和初始长度；当开始或重新开始时，把蛇身、方向和得分设回起点；最后返回结果。' },
  'demo-function-direction': { nodeId: 'direction-input', title: '安全更新移动方向', boundaryReason: '它有单独的判断或状态变化', responsibilityOwner: 'student-core' , implementation: '先读取按键；当目标方向和当前方向相反时保持不变；最后返回可以采用的新方向。' },
  'demo-function-movement': { nodeId: 'movement', title: '更新蛇身位置', boundaryReason: '它可以单独运行和验证', responsibilityOwner: 'student-core' , implementation: '先按当前方向更新坐标算出新蛇头；当没有吃到东西时去掉蛇尾；最后返回新的蛇身列表。' },
  'demo-function-food': { nodeId: 'food-spawn', title: '生成合法食物位置', boundaryReason: '它可以单独运行和验证', responsibilityOwner: 'ai-supported' , implementation: '先随机取一个格子；当这个位置被蛇身占用时重新取；最后返回一个空闲坐标。' },
  'demo-function-eat': { nodeId: 'eat-grow-score', title: '处理进食、增长与计分', boundaryReason: '它有单独的判断或状态变化', responsibilityOwner: 'student-core' , implementation: '先判断条件：蛇头是否和果实重合；当重合时保留蛇尾让蛇变长并加分；最后返回新蛇身和新得分。' },
  'demo-function-collision': { nodeId: 'collision', title: '判断碰撞与结束条件', boundaryReason: '它有单独的判断或状态变化', responsibilityOwner: 'student-core' , implementation: '先取出新蛇头坐标；当它越过边界或已经在蛇身里时判定结束；最后返回结果。' },
  'demo-function-loop': { nodeId: 'game-loop', title: '组合并驱动游戏循环', boundaryReason: '其他功能会重复使用它的调度结果', responsibilityOwner: 'ai-supported' , implementation: '先每隔一段时间读取按键；当游戏还在进行时依次调用方向、移动、进食和碰撞；最后更新画面。' },
};

const enrichDemoFunctionCard = (card: StudentFunctionCard): StudentFunctionCard => {
  const meta = DEMO_MAPPING_META[card.id];
  if (!meta) return card;
  return {
    ...card,
    boundaryReason: card.boundaryReason ?? meta.boundaryReason,
    // 只补齐缺失字段：kero 之后的人工修改不会被覆盖
    implementation: card.implementation ?? meta.implementation,
    responsibilityOwner: card.responsibilityOwner ?? meta.responsibilityOwner,
    mappingDecision: card.mappingDecision ?? {
      status: 'accepted',
      suggestions: [{
        node_id: meta.nodeId,
        title_zh: meta.title,
        match_reasons: ['职责相符', '输入输出相符'],
        score: 10,
      }],
      acceptedNodeIds: [meta.nodeId],
      suggestedAt: '2026-01-01T08:17:00.000Z',
      decidedAt: '2026-01-01T08:18:00.000Z',
    },
  };
};

const FUNCTIONS = RAW_FUNCTIONS.map(enrichDemoFunctionCard);

export const upgradeSnakeProjectFunctionCards = (cards: StudentFunctionCard[]) => (
  cards.map(enrichDemoFunctionCard)
);

const ORDERED_CARD_IDS = FUNCTIONS.map(card => card.id);

const DECISION_LABELS: Record<string, string> = {
  'demo-function-direction': '目标方向是否安全？',
  'demo-function-food': '候选位置是否空闲？',
  'demo-function-eat': '蛇头是否碰到食物？',
  'demo-function-collision': '是否越界或碰到自身？',
  'demo-function-loop': '游戏是否继续运行？',
};

export const createSnakeProjectMechanisms = (): Record<string, StudentFunctionMechanism> => Object.fromEntries(
  FUNCTIONS.map(card => {
    const baseId = `mechanism-${card.id}`;
    const decisionLabel = DECISION_LABELS[card.id];
    const flowNodes = [
      { id: `${baseId}-start`, kind: 'start' as const, label: '开始', position: { x: 30, y: 245 } },
      { id: `${baseId}-input`, kind: 'input-output' as const, label: `读取：${card.input}`, position: { x: 240, y: 245 } },
      ...(decisionLabel
        ? [{ id: `${baseId}-decision`, kind: 'decision' as const, label: decisionLabel, position: { x: 460, y: 225 } }]
        : []),
      { id: `${baseId}-process`, kind: 'process' as const, label: card.responsibility, position: { x: decisionLabel ? 660 : 480, y: 245 } },
      { id: `${baseId}-output`, kind: 'input-output' as const, label: `输出：${card.output}`, position: { x: decisionLabel ? 870 : 700, y: 245 } },
      { id: `${baseId}-end`, kind: 'end' as const, label: '结束', position: { x: decisionLabel ? 1080 : 920, y: 245 } },
    ];
    const orderedIds = flowNodes.map(node => node.id);
    const diagramEdges = orderedIds.slice(0, -1).map((sourceId, index) => ({
      id: `${sourceId}->${orderedIds[index + 1]}`,
      sourceId,
      targetId: orderedIds[index + 1],
    }));
    if (decisionLabel) {
      diagramEdges.push({
        id: `${baseId}-decision->${baseId}-output`,
        sourceId: `${baseId}-decision`,
        targetId: `${baseId}-output`,
      });
    }
    return [card.id, { flowNodes, diagramEdges, confirmedAt: '2026-01-01T08:19:00.000Z' }];
  }),
);

const PATH: StudentPathPlan = {
  orderedCardIds: ORDERED_CARD_IDS,
  canvasLayoutVersion: STUDENT_CANVAS_LAYOUT_VERSION,
  canvasPositions: createDefaultCanvasPositions(FUNCTIONS),
  prerequisites: {
    'demo-function-direction': ['demo-function-initial'],
    'demo-function-movement': ['demo-function-initial', 'demo-function-direction'],
    'demo-function-food': ['demo-function-initial'],
    'demo-function-eat': ['demo-function-movement', 'demo-function-food'],
    'demo-function-collision': ['demo-function-movement'],
    'demo-function-loop': [
      'demo-function-direction',
      'demo-function-movement',
      'demo-function-food',
      'demo-function-eat',
      'demo-function-collision',
    ],
  },
  relationKinds: {},
  functionMechanisms: createSnakeProjectMechanisms(),
  confirmedAt: '2026-01-01T08:20:00.000Z',
};

const MODULE_CODE: Record<string, { blueprintNodeId: string; code: string }> = {
  'demo-function-initial': {
    blueprintNodeId: 'initial-state',
    code: `def create_initial_state():\n    snake = [(6, 5), (5, 5), (4, 5)]\n    direction = 'right'\n    score = 0\n    return snake, direction, score`,
  },
  'demo-function-direction': {
    blueprintNodeId: 'direction-input',
    code: `def change_direction(current_direction, next_direction):\n    opposite = {'up': 'down', 'down': 'up', 'left': 'right', 'right': 'left'}\n    if opposite[current_direction] == next_direction:\n        return current_direction\n    return next_direction`,
  },
  'demo-function-movement': {
    blueprintNodeId: 'movement',
    code: `def move_snake(snake, direction):\n    dx, dy = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}[direction]\n    head_x, head_y = snake[0]\n    new_head = (head_x + dx, head_y + dy)\n    return [new_head] + snake[:-1]`,
  },
  'demo-function-food': {
    blueprintNodeId: 'food-spawn',
    code: `def spawn_food(snake, board_size):\n    import random\n    while True:\n        food = (random.randrange(board_size), random.randrange(board_size))\n        if food not in snake:\n            return food`,
  },
  'demo-function-eat': {
    blueprintNodeId: 'eat-grow-score',
    code: `def apply_food_effect(snake, food, score):\n    if snake[0] == food:\n        snake.append(snake[-1])\n        return snake, score + 10\n    return snake, score`,
  },
  'demo-function-collision': {
    blueprintNodeId: 'collision',
    code: `def check_collision(snake, board_size):\n    head_x, head_y = snake[0]\n    outside = head_x < 0 or head_x >= board_size or head_y < 0 or head_y >= board_size\n    hit_self = snake[0] in snake[1:]\n    return outside or hit_self`,
  },
};

const createEvidence = (): SnakeRuntimeEvidence[] => {
  const base = Date.now();
  return [
    { id: 'opened-demo', type: 'opened', timestamp: new Date(base - 480_000).toISOString() },
    { id: 'reset-demo', type: 'reset', timestamp: new Date(base - 420_000).toISOString() },
    { id: 'direction-demo', type: 'direction', timestamp: new Date(base - 360_000).toISOString(), details: { direction: 'up' } },
    { id: 'moved-demo', type: 'moved', timestamp: new Date(base - 300_000).toISOString(), details: { fromX: 6, fromY: 5, toX: 7, toY: 5 } },
    { id: 'food_spawn-demo', type: 'food_spawn', timestamp: new Date(base - 240_000).toISOString() },
    { id: 'food_eaten-demo', type: 'food_eaten', timestamp: new Date(base - 180_000).toISOString(), details: { scoreBefore: 0, scoreAfter: 10, lengthBefore: 3, lengthAfter: 4 } },
    { id: 'collision-demo', type: 'collision', timestamp: new Date(base - 120_000).toISOString(), details: { collisionType: 'boundary' } },
    { id: 'started-demo', type: 'started', timestamp: new Date(base - 60_000).toISOString() },
  ];
};

export interface SnakeProjectWorkspace extends Record<string, unknown> {
  version: 1;
  savedAt: string;
  evidence: SnakeRuntimeEvidence[];
  observations: StudentObservationCard[];
  functions: StudentFunctionCard[];
  path: StudentPathPlan;
  progress: Record<string, StudentModuleProgress>;
}

const storageKeys = (taskId: string) => ({
  evidence: `cognisync:snake-runtime-evidence:v1:${taskId}`,
  observations: `cognisync:project-observation-cards:v2:${taskId}`,
  functions: `cognisync:project-function-cards:v1:${taskId}`,
  path: `cognisync:project-path-plan:v1:${taskId}`,
  progress: `cognisync:project-module-progress:v1:${taskId}`,
});

const parseStored = <T,>(key: string, fallback: T): T => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
};

export const hydrateSnakeProjectWorkspace = (taskId: string, workspace: SnakeProjectWorkspace) => {
  const keys = storageKeys(taskId);
  window.localStorage.setItem(keys.evidence, JSON.stringify(workspace.evidence ?? []));
  window.localStorage.setItem(keys.observations, JSON.stringify(workspace.observations ?? []));
  window.localStorage.setItem(keys.functions, JSON.stringify(workspace.functions ?? []));
  window.localStorage.setItem(keys.path, JSON.stringify(workspace.path ?? { orderedCardIds: [], prerequisites: {}, relationKinds: {} }));
  window.localStorage.setItem(keys.progress, JSON.stringify(workspace.progress ?? {}));
};

export const collectSnakeProjectWorkspace = (taskId: string): SnakeProjectWorkspace => {
  const keys = storageKeys(taskId);
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    evidence: parseStored<SnakeRuntimeEvidence[]>(keys.evidence, []),
    observations: parseStored<StudentObservationCard[]>(keys.observations, []),
    functions: parseStored<StudentFunctionCard[]>(keys.functions, []),
    path: parseStored<StudentPathPlan>(keys.path, { orderedCardIds: [], prerequisites: {}, relationKinds: {} }),
    progress: parseStored<Record<string, StudentModuleProgress>>(keys.progress, {}),
  };
};

export const isSnakeProjectWorkspace = (value: unknown): value is SnakeProjectWorkspace => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SnakeProjectWorkspace>;
  return candidate.version === 1
    && Array.isArray(candidate.observations)
    && Array.isArray(candidate.functions)
    && Boolean(candidate.path)
    && Boolean(candidate.progress);
};

export const seedSnakeProjectDemo = (taskId: string) => {
  const now = new Date().toISOString();
  const progress = Object.fromEntries(
    Object.entries(MODULE_CODE).map(([cardId, item]) => [cardId, {
      cardId,
      blueprintNodeId: item.blueprintNodeId,
      code: item.code,
      verified: true,
      updatedAt: now,
    } satisfies StudentModuleProgress]),
  );
  const evidence = createEvidence();

  const workspace: SnakeProjectWorkspace = {
    version: 1,
    savedAt: now,
    evidence,
    observations: OBSERVATIONS,
    functions: FUNCTIONS,
    path: { ...PATH, confirmedAt: now },
    progress,
  };
  hydrateSnakeProjectWorkspace(taskId, workspace);

  return {
    evidence,
    observationCount: OBSERVATIONS.length,
    functionCount: FUNCTIONS.length,
    workspace,
  };
};
