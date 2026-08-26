import type { StudentModuleTestAttempt } from './projectPath';

export type SnakeCreativeHook =
  | 'any'
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
  { id: 'any', labelZh: '所有游戏事件', labelEn: 'All game events', descriptionZh: '由函数根据 event.type 自由处理', descriptionEn: 'The function handles events through event.type' },
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
  // 新卡不再要求学生额外选择钩子：一个空白函数可以在受控的七类事件上自由发挥。
  // 旧卡仍保留原 hook，不改变历史行为与研究记录。
  hook: 'any',
  code: createCreativeStarterCode(),
  enabled: false,
  verified: false,
  updatedAt: new Date().toISOString(),
  testAttempts: [],
});

export const creativeUnitId = (id: string) => `creative::${id}`;

/**
 * 旧卡原本只保存一个 hook。当学生已经在函数内明确读取
 * event.type/event.hook 时，函数本身就是事件路由器，应接收所有受控事件。
 * 没有事件判断的历史卡仍严格按原 hook 运行，避免行为扩大。
 */
export const usesCreativeEventRouting = (code: string) => (
  /event\s*(?:\.get\(\s*["'](?:type|hook)["']|\[\s*["'](?:type|hook)["']\s*\])/.test(code)
);

export const creativeHookLabel = (hook: SnakeCreativeHook, language: 'zh' | 'en') => {
  const option = SNAKE_CREATIVE_HOOKS.find(item => item.id === hook) ?? SNAKE_CREATIVE_HOOKS[0];
  return language === 'zh' ? option.labelZh : option.labelEn;
};
