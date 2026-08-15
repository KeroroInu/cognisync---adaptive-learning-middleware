import type {
  BlueprintNode,
  BlueprintPhenomenon,
  BlueprintScaffoldLevel,
  BlueprintScaffoldPolicy,
  BlueprintStage,
  BlueprintTestCase,
  ProjectBlueprintConfig,
  ResearchTask,
} from '../types';

const scaffoldLevels = (
  goals: [string, string, string, string],
  helps: [string, string, string, string],
  maxCodeLines: [number, number, number, number] = [0, 0, 0, 0],
): BlueprintScaffoldLevel[] => goals.map((goalZh, level) => ({
  level,
  goalZh,
  allowedHelpZh: helps[level],
  maxCodeLines: maxCodeLines[level],
}));

export const DEFAULT_BLUEPRINT_SCAFFOLD_LEVELS: Record<BlueprintStage, BlueprintScaffoldLevel[]> = {
  observe: scaffoldLevels(
    ['澄清观察对象', '提示比较维度', '提供观察句式', '补全一条最小观察'],
    [
      '追问学生改变了什么操作、画面哪个量发生变化，不提供机制解释。',
      '提示从位置、数量、输入响应、运行状态等维度中选择一个进行比较。',
      '提供“当我进行____后，我观察到____”的句式，并引用一条已有运行证据。',
      '基于最近运行证据生成一条可修改的最小观察卡，明确标记为 AI 辅助。',
    ],
  ),
  decompose: scaffoldLevels(
    ['由现象追问程序职责', '提示输入—处理—输出', '给出局部职责建议', '补全一个阻塞字段'],
    [
      '只追问程序接收什么、改变或判断什么、产生什么结果。',
      '指出当前功能卡缺少的一个结构字段，不给出完整卡片。',
      '给出一个可修改的职责短语或一个知识点候选，保留学生选择。',
      '只补全当前功能卡中一个无法继续的字段，其他判断仍由学生完成。',
    ],
  ),
  model: scaffoldLevels(
    ['检查流程完整性', '定位缺失节点', '建议局部连接', '补充一个流程节点'],
    [
      '追问开始、输入、处理、判断、输出和结束中缺少哪一类。',
      '只指出一处缺失、语义不清或连接不合理的流程节点。',
      '给出一条局部节点关系或判断分支建议，不代画整张图。',
      '加入一个可修改的处理或判断节点，要求学生自己完成连线和解释。',
    ],
  ),
  plan: scaffoldLevels(
    ['追问输入输出依赖', '区分系统关系与实现顺序', '指出一处依赖冲突', '给出最小可执行修正'],
    [
      '要求学生说明一张卡的输出由哪张卡使用，不自动排序。',
      '提示画布表达功能协作，顺序列表表达个人实现计划。',
      '只指出一处阻塞当前顺序的依赖，不自动重排全部卡片。',
      '移动或补连一张关键卡，使路径能够继续，并要求学生解释修正原因。',
    ],
  ),
  build: scaffoldLevels(
    ['读取失败证据', '定位相关函数与知识', '提供局部伪代码', '补全最小阻塞片段'],
    [
      '追问实际结果与预期结果的具体差异，不给代码。',
      '结合当前模块、失败测试和学生画像，提示相关函数或知识点。',
      '提供当前模块的2至4个局部步骤或伪代码，关键表达式和变量由学生完成。',
      '最多补全5行导致测试无法推进的代码，学生必须重新运行、解释并修改。',
    ],
    [0, 0, 0, 5],
  ),
  transfer: scaffoldLevels(
    ['比较新旧项目结构', '提示可迁移策略', '提供迁移检查表', '示范一个局部迁移'],
    [
      '追问哪些功能、数据、关系或测试可以迁移到新任务。',
      '提示一个结构相似点，不给出新项目的实现。',
      '给出输入、状态、规则、边界和测试的迁移检查表。',
      '示范一个模块如何改写到新情境，保留其余模块由学生完成。',
    ],
    [0, 0, 0, 5],
  ),
};

export const createDefaultBlueprintScaffoldPolicy = (): BlueprintScaffoldPolicy => ({
  requireAttemptBeforeUpgrade: true,
  coreImplementationMaxLevel: 3,
  stageLevels: Object.fromEntries(
    Object.entries(DEFAULT_BLUEPRINT_SCAFFOLD_LEVELS).map(([stage, levels]) => [
      stage,
      levels.map(level => ({ ...level })),
    ]),
  ) as BlueprintScaffoldPolicy['stageLevels'],
});

export const getBlueprintScaffoldLevels = (
  policy: BlueprintScaffoldPolicy,
  stage: BlueprintStage,
): BlueprintScaffoldLevel[] => {
  const configured = policy.stageLevels[stage] ?? [];
  const byLevel = new Map(configured.map(item => [item.level, item]));
  return DEFAULT_BLUEPRINT_SCAFFOLD_LEVELS[stage].map(fallback => ({
    ...fallback,
    ...byLevel.get(fallback.level),
  }));
};

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
  scaffoldPolicy: createDefaultBlueprintScaffoldPolicy(),
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
