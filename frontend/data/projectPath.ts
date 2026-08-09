import type { StudentObservationCard } from '../components/ProjectFactory';
import type { StudentFunctionCard } from '../components/ProjectFunctionStage';
import { SNAKE_PROJECT_BLUEPRINT, type BlueprintNode } from './snakeProjectBlueprint';

export type StudentRelationKind = 'prerequisite' | 'parallel';

export interface StudentPathPlan {
  orderedCardIds: string[];
  prerequisites: Record<string, string[]>;
  relationKinds: Record<string, StudentRelationKind>;
  confirmedAt?: string;
}

export interface StudentModuleProgress {
  cardId: string;
  blueprintNodeId: string;
  code: string;
  verified: boolean;
  updatedAt: string;
}

const BLUEPRINT_BY_ID = new Map(SNAKE_PROJECT_BLUEPRINT.map(node => [node.id, node]));

const KEYWORDS: Record<string, string[]> = {
  collision: ['碰撞', '撞墙', '边界', '蛇身', '自身', '游戏结束', '停止运行', 'collision', 'boundary'],
  'eat-grow-score': ['吃到', '食物', '果实', '增长', '长度', '得分', '分数', 'score', 'grow'],
  'food-spawn': ['生成食物', '重新出现', '随机位置', '空闲网格', '果实出现', 'spawn', 'random'],
  'direction-input': ['方向', '按键', '转向', '键盘', 'direction', 'key'],
  movement: ['移动', '位置', '坐标', '蛇头', '蛇尾', '向前', 'move', 'position'],
  'initial-state': ['初始', '重置', '重新开始', '恢复', '起始', 'reset', 'initial'],
  'game-loop': ['持续运行', '循环', '暂停', '速度', '每一步', 'loop', 'speed'],
};

const EVIDENCE_DEFAULTS: Record<string, string> = {
  opened: 'initial-state',
  started: 'game-loop',
  paused: 'game-loop',
  direction: 'direction-input',
  moved: 'movement',
  food_eaten: 'eat-grow-score',
  collision: 'collision',
  reset: 'initial-state',
};

export const readStoredList = <T,>(key: string): T[] => {
  try {
    const stored = window.localStorage.getItem(key);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const readStoredObject = <T,>(key: string, fallback: T): T => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
};

export const createInitialPathPlan = (cards: StudentFunctionCard[]): StudentPathPlan => ({
  orderedCardIds: cards.map(card => card.id),
  prerequisites: {},
  relationKinds: {},
});

const evidenceTypeFromId = (evidenceId?: string) => evidenceId?.split('-')[0] ?? '';

export const inferBlueprintNode = (
  card: StudentFunctionCard,
  observations: StudentObservationCard[],
): BlueprintNode => {
  const text = [
    card.responsibility,
    card.input,
    card.output,
    card.observationText,
    ...card.knowledge,
  ].join(' ').toLowerCase();

  let bestId = '';
  let bestScore = 0;
  Object.entries(KEYWORDS).forEach(([nodeId, words]) => {
    const score = words.reduce((total, word) => total + (text.includes(word.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      bestId = nodeId;
      bestScore = score;
    }
  });

  if (bestId) return BLUEPRINT_BY_ID.get(bestId) ?? SNAKE_PROJECT_BLUEPRINT[0];

  const observation = observations.find(item => item.id === card.observationId);
  const evidenceType = evidenceTypeFromId(observation?.evidenceId ?? card.evidenceId);
  const fallbackId = EVIDENCE_DEFAULTS[evidenceType] ?? 'movement';
  return BLUEPRINT_BY_ID.get(fallbackId) ?? SNAKE_PROJECT_BLUEPRINT[0];
};

export const buildTopologicalOrder = (
  cards: StudentFunctionCard[],
  plan: StudentPathPlan,
): { orderedIds: string[]; hasCycle: boolean } => {
  const cardIds = new Set(cards.map(card => card.id));
  const preferred = plan.orderedCardIds.filter(id => cardIds.has(id));
  cards.forEach(card => {
    if (!preferred.includes(card.id)) preferred.push(card.id);
  });

  const indegree = new Map(preferred.map(id => [id, 0]));
  const nextById = new Map(preferred.map(id => [id, [] as string[]]));
  preferred.forEach(id => {
    (plan.prerequisites[id] ?? []).filter(dep => cardIds.has(dep) && dep !== id).forEach(dep => {
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      nextById.get(dep)?.push(id);
    });
  });

  const queue = preferred.filter(id => (indegree.get(id) ?? 0) === 0);
  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    result.push(id);
    (nextById.get(id) ?? []).forEach(nextId => {
      const value = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, value);
      if (value === 0) {
        const preferredIndex = preferred.indexOf(nextId);
        const insertionIndex = queue.findIndex(item => preferred.indexOf(item) > preferredIndex);
        if (insertionIndex === -1) queue.push(nextId);
        else queue.splice(insertionIndex, 0, nextId);
      }
    });
  }

  return {
    orderedIds: result.length === preferred.length ? result : preferred,
    hasCycle: result.length !== preferred.length,
  };
};

export const getBlueprintNode = (id: string) => BLUEPRINT_BY_ID.get(id);
