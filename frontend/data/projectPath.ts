import type { StudentObservationCard } from '../components/ProjectFactory';
import type { StudentFunctionCard } from '../components/ProjectFunctionStage';
import { SNAKE_PROJECT_BLUEPRINT, type BlueprintNode } from './snakeProjectBlueprint';

export type StudentRelationKind = 'prerequisite' | 'parallel';
export type StudentFlowNodeKind = 'start' | 'process' | 'decision' | 'input-output' | 'end';
export const STUDENT_CANVAS_LAYOUT_VERSION = 2;

export interface StudentCanvasPosition {
  x: number;
  y: number;
}

export interface StudentFlowNode {
  id: string;
  kind: StudentFlowNodeKind;
  label: string;
  position: StudentCanvasPosition;
}

export interface StudentDiagramEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceAnchor?: StudentConnectorSide;
  targetAnchor?: StudentConnectorSide;
}

export type StudentConnectorSide = 'top' | 'right' | 'bottom' | 'left';

export interface StudentFunctionMechanism {
  flowNodes: StudentFlowNode[];
  diagramEdges: StudentDiagramEdge[];
  confirmedAt?: string;
}

export interface StudentPathPlan {
  orderedCardIds: string[];
  placedCardIds?: string[];
  prerequisites: Record<string, string[]>;
  relationKinds: Record<string, StudentRelationKind>;
  flowNodes?: StudentFlowNode[];
  diagramEdges?: StudentDiagramEdge[];
  functionMechanisms?: Record<string, StudentFunctionMechanism>;
  canvasLayoutVersion?: number;
  canvasPositions?: Record<string, StudentCanvasPosition>;
  confirmedAt?: string;
}

export interface StudentImplementationStage {
  index: number;
  cardIds: string[];
}

export interface StudentImplementationRoute {
  stages: StudentImplementationStage[];
  orderedIds: string[];
  unplannedIds: string[];
  hasCycle: boolean;
}

export interface StudentModuleProgress {
  cardId: string;
  blueprintNodeId: string;
  code: string;
  verified: boolean;
  updatedAt: string;
  testAttempts?: StudentModuleTestAttempt[];
}

export interface StudentModuleTestAttempt {
  id: string;
  passed: boolean;
  resultCode: string;
  durationMs: number;
  createdAt: string;
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
  food_spawn: 'food-spawn',
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

const DEFAULT_CANVAS_POSITIONS: StudentCanvasPosition[] = [
  { x: 40, y: 36 },
  { x: 350, y: 36 },
  { x: 660, y: 36 },
  { x: 350, y: 246 },
  { x: 660, y: 246 },
  { x: 970, y: 36 },
  { x: 1280, y: 138 },
  { x: 970, y: 246 },
  { x: 1280, y: 36 },
  { x: 1280, y: 246 },
];

export const createDefaultCanvasPositions = (cards: StudentFunctionCard[]) => Object.fromEntries(
  cards.map((card, index) => [
    card.id,
    DEFAULT_CANVAS_POSITIONS[index] ?? {
      x: 40 + (index % 5) * 310,
      y: 36 + Math.floor(index / 5) * 210,
    },
  ]),
);

export const createInitialPathPlan = (cards: StudentFunctionCard[]): StudentPathPlan => ({
  orderedCardIds: cards.map(card => card.id),
  placedCardIds: [],
  prerequisites: {},
  relationKinds: {},
  flowNodes: [],
  diagramEdges: [],
  functionMechanisms: {},
  canvasLayoutVersion: STUDENT_CANVAS_LAYOUT_VERSION,
  canvasPositions: createDefaultCanvasPositions(cards),
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

  const observation = observations.find(item => item.id === card.observationId);
  const evidenceType = evidenceTypeFromId(observation?.evidenceId ?? card.evidenceId);
  const evidenceDefaultId = EVIDENCE_DEFAULTS[evidenceType] ?? '';
  let bestId = evidenceDefaultId;
  let bestScore = evidenceDefaultId ? 2 : 0;
  Object.entries(KEYWORDS).forEach(([nodeId, words]) => {
    const keywordScore = words.reduce((total, word) => total + (text.includes(word.toLowerCase()) ? 1 : 0), 0);
    const score = keywordScore + (nodeId === evidenceDefaultId ? 2 : 0);
    if (score > bestScore) {
      bestId = nodeId;
      bestScore = score;
    }
  });

  if (bestId) return BLUEPRINT_BY_ID.get(bestId) ?? SNAKE_PROJECT_BLUEPRINT[0];

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

/**
 * Derive the student's build stages from the arrows they drew.
 *
 * Adding a card to the canvas never assigns it an order. A card only joins the
 * route after it is connected to another card (except for a one-card route).
 * Multiple roots or branches at the same depth remain in the same stage, so
 * parallel work is represented without inventing a click-based sequence.
 */
export const buildImplementationStages = (
  cards: StudentFunctionCard[],
  plan: StudentPathPlan,
): StudentImplementationRoute => {
  const validIds = new Set(cards.map(card => card.id));
  const activeIds = (plan.placedCardIds ?? cards.map(card => card.id)).filter(id => validIds.has(id));
  const activeIdSet = new Set(activeIds);
  const preferredIds = plan.orderedCardIds.filter(id => activeIdSet.has(id));
  activeIds.forEach(id => {
    if (!preferredIds.includes(id)) preferredIds.push(id);
  });
  const preferredIndex = new Map(preferredIds.map((id, index) => [id, index]));
  const sortPreferred = (left: string, right: string) => (
    (preferredIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (preferredIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
  );

  const rawEdges = plan.diagramEdges?.length
    ? plan.diagramEdges
    : Object.entries(plan.prerequisites).flatMap(([targetId, sourceIds]) => (
      sourceIds.map(sourceId => ({ id: `${sourceId}->${targetId}`, sourceId, targetId }))
    ));
  const edgeKeys = new Set<string>();
  const edges = rawEdges.filter(edge => {
    const key = `${edge.sourceId}->${edge.targetId}`;
    if (
      edgeKeys.has(key)
      || edge.sourceId === edge.targetId
      || !activeIdSet.has(edge.sourceId)
      || !activeIdSet.has(edge.targetId)
    ) return false;
    edgeKeys.add(key);
    return true;
  });

  if (activeIds.length === 1) {
    return {
      stages: [{ index: 1, cardIds: [activeIds[0]] }],
      orderedIds: [activeIds[0]],
      unplannedIds: [],
      hasCycle: false,
    };
  }

  const connectedIds = new Set<string>();
  edges.forEach(edge => {
    connectedIds.add(edge.sourceId);
    connectedIds.add(edge.targetId);
  });
  const routeIds = activeIds.filter(id => connectedIds.has(id));
  const unplannedIds = activeIds.filter(id => !connectedIds.has(id));
  const indegree = new Map(routeIds.map(id => [id, 0]));
  const outgoing = new Map(routeIds.map(id => [id, [] as string[]]));
  edges.forEach(edge => {
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    outgoing.get(edge.sourceId)?.push(edge.targetId);
  });

  const stageById = new Map<string, number>();
  const queue = routeIds.filter(id => (indegree.get(id) ?? 0) === 0).sort(sortPreferred);
  queue.forEach(id => stageById.set(id, 1));
  const processedIds: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    processedIds.push(id);
    const nextStage = (stageById.get(id) ?? 1) + 1;
    (outgoing.get(id) ?? []).forEach(nextId => {
      stageById.set(nextId, Math.max(stageById.get(nextId) ?? 1, nextStage));
      const nextIndegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(nextId);
        queue.sort(sortPreferred);
      }
    });
  }

  const hasCycle = processedIds.length !== routeIds.length;
  const stageGroups = new Map<number, string[]>();
  if (!hasCycle) {
    processedIds.forEach(id => {
      const stage = stageById.get(id) ?? 1;
      stageGroups.set(stage, [...(stageGroups.get(stage) ?? []), id]);
    });
  }
  const stages = [...stageGroups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, cardIds]) => ({ index, cardIds: cardIds.sort(sortPreferred) }));

  return {
    stages,
    orderedIds: stages.flatMap(stage => stage.cardIds),
    unplannedIds,
    hasCycle,
  };
};

export const getImplementationOrderIds = (
  cards: StudentFunctionCard[],
  plan: StudentPathPlan,
): string[] => buildImplementationStages(cards, plan).orderedIds;

export const getBlueprintNode = (id: string) => BLUEPRINT_BY_ID.get(id);
