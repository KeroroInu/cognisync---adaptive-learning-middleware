import type {
  BlueprintNode,
  BlueprintPhenomenon,
  BlueprintTestCase,
  ProjectBlueprintConfig,
  ResearchTask,
} from '../types';

export const toBlueprintKey = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
};

export const createEmptyBlueprint = (task: ResearchTask): ProjectBlueprintConfig => ({
  schemaVersion: 1,
  projectKey: `project-${task.id.slice(0, 8)}`,
  demoKey: 'project-demo',
  titleZh: task.title,
  phenomena: [],
  nodes: [],
  alternatives: [],
  scaffoldPolicy: {
    requireAttemptBeforeUpgrade: true,
    coreImplementationMaxLevel: 2,
    stageLevels: {},
  },
});

export const createPhenomenon = (index: number): BlueprintPhenomenon => ({
  id: `phenomenon-${index}`,
  labelZh: `待描述的可观察现象 ${index}`,
  evidenceType: 'runtime_event',
  required: true,
  descriptionZh: '',
});

export const createBlueprintNode = (index: number): BlueprintNode => ({
  id: `module-${index}`,
  titleZh: `待定义功能模块 ${index}`,
  scenarioZh: '',
  required: true,
  synonyms: [],
  contract: {
    functionTemplate: '',
    inputs: [],
    outputs: [],
    preconditions: [],
    postconditions: [],
  },
  knowledge: [],
  prerequisiteIds: [],
  tests: [],
  visualizationBehaviorKey: null,
});

export const createBlueprintTestCase = (index: number): BlueprintTestCase => ({
  id: `test-${index}`,
  labelZh: `待定义验证证据 ${index}`,
  category: 'example',
  inputData: {},
  expectedData: null,
  hidden: true,
});

export const parseBlueprintJson = (value: string): unknown =>
  JSON.parse(value.trim() || 'null') as unknown;

export const splitBlueprintList = (value: string): string[] => value
  .split(/[，,\n]/)
  .map(item => item.trim())
  .filter(Boolean);

export const cloneBlueprint = (config: ProjectBlueprintConfig): ProjectBlueprintConfig =>
  JSON.parse(JSON.stringify(config)) as ProjectBlueprintConfig;

export interface BlueprintRelationAnalysis {
  layers: string[][];
  cycleNodeIds: string[];
  unknownReferences: Array<{ nodeId: string; prerequisiteId: string }>;
}

/**
 * 将教师蓝图的前置关系推导为可建构层级。
 * 同一层只表示可以并行，不代表学生必须采用固定的卡片顺序。
 */
export const analyzeBlueprintRelations = (nodes: BlueprintNode[]): BlueprintRelationAnalysis => {
  const nodeIds = new Set(nodes.map(node => node.id));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const dependents = new Map(nodes.map(node => [node.id, [] as string[]]));
  const unknownReferences: BlueprintRelationAnalysis['unknownReferences'] = [];

  nodes.forEach(node => {
    const uniquePrerequisites = new Set(node.prerequisiteIds);
    uniquePrerequisites.forEach(prerequisiteId => {
      if (!nodeIds.has(prerequisiteId)) {
        unknownReferences.push({ nodeId: node.id, prerequisiteId });
        return;
      }
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      dependents.get(prerequisiteId)?.push(node.id);
    });
  });

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  let frontier = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  const layers: string[][] = [];
  const visited = new Set<string>();

  while (frontier.length) {
    const layer = [...frontier].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    layers.push(layer);
    layer.forEach(nodeId => visited.add(nodeId));

    const next = new Set<string>();
    layer.forEach(nodeId => {
      dependents.get(nodeId)?.forEach(dependentId => {
        const remaining = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) next.add(dependentId);
      });
    });
    frontier = [...next];
  }

  return {
    layers,
    cycleNodeIds: nodes.filter(node => !visited.has(node.id)).map(node => node.id),
    unknownReferences,
  };
};

export const wouldCreateBlueprintCycle = (
  nodes: BlueprintNode[],
  nodeId: string,
  prerequisiteIds: string[],
): boolean => analyzeBlueprintRelations(nodes.map(node => (
  node.id === nodeId ? { ...node, prerequisiteIds } : node
))).cycleNodeIds.length > 0;
