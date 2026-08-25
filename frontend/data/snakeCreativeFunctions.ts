import type { StudentModuleTestAttempt } from './projectPath';

export type SnakeCreativeHook =
  | 'game_start'
  | 'key_input'
  | 'before_move'
  | 'after_move'
  | 'food_eaten'
  | 'loop'
  | 'game_end';

export interface StudentCreativeFunction {
  id: string;
  title: string;
  hook: SnakeCreativeHook;
  code: string;
  enabled: boolean;
  verified: boolean;
  updatedAt: string;
  testAttempts?: StudentModuleTestAttempt[];
  lastRuntimeError?: string;
}

export interface SnakeCreativeHookOption {
  id: SnakeCreativeHook;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
}

export const SNAKE_CREATIVE_HOOKS: SnakeCreativeHookOption[] = [
  { id: 'game_start', labelZh: '游戏开始', labelEn: 'Game start', descriptionZh: '每次重置出初始状态后运行', descriptionEn: 'Runs after every reset' },
  { id: 'key_input', labelZh: '按下方向键', labelEn: 'Key input', descriptionZh: '收到一次有效方向输入时运行', descriptionEn: 'Runs on a valid direction input' },
  { id: 'before_move', labelZh: '移动之前', labelEn: 'Before move', descriptionZh: '基础循环推进前运行', descriptionEn: 'Runs before the core step' },
  { id: 'after_move', labelZh: '移动之后', labelEn: 'After move', descriptionZh: '基础循环推进后运行', descriptionEn: 'Runs after the core step' },
  { id: 'food_eaten', labelZh: '吃到食物', labelEn: 'Food eaten', descriptionZh: '本帧得分增加后运行', descriptionEn: 'Runs after the score increases' },
  { id: 'loop', labelZh: '每次循环', labelEn: 'Every loop', descriptionZh: '每个完整游戏帧最后运行', descriptionEn: 'Runs at the end of every frame' },
  { id: 'game_end', labelZh: '游戏结束', labelEn: 'Game end', descriptionZh: '基础碰撞判断结束游戏时运行', descriptionEn: 'Runs when the core game ends' },
];

export const CREATIVE_FUNCTION_NAME = 'creative_feature';
export const MAX_CREATIVE_FUNCTIONS = 12;
export const MAX_CREATIVE_CODE_CHARS = 12_000;

const LEGACY_CREATIVE_STARTER_CODE = `def ${CREATIVE_FUNCTION_NAME}(event, state):
    # event 只包含当前钩子的公开信息
    # 可以修改并返回 state，也可以直接返回 None 保持原状态
    return state`;

export const createCreativeStarterCode = () => `def ${CREATIVE_FUNCTION_NAME}(event, state):
    pass`;

/** Only replace the untouched former template; student-authored code is preserved verbatim. */
export const upgradeCreativeStarterCode = (code: string) => (
  code === LEGACY_CREATIVE_STARTER_CODE ? createCreativeStarterCode() : code
);

export const createStudentCreativeFunction = (
  index: number,
  id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `creative-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): StudentCreativeFunction => ({
  id,
  title: `我的创意 ${index}`,
  hook: 'after_move',
  code: createCreativeStarterCode(),
  enabled: false,
  verified: false,
  updatedAt: new Date().toISOString(),
  testAttempts: [],
});

export const creativeUnitId = (id: string) => `creative::${id}`;

export const creativeHookLabel = (hook: SnakeCreativeHook, language: 'zh' | 'en') => {
  const option = SNAKE_CREATIVE_HOOKS.find(item => item.id === hook) ?? SNAKE_CREATIVE_HOOKS[0];
  return language === 'zh' ? option.labelZh : option.labelEn;
};
