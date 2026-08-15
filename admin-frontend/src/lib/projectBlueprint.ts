import type {
  BlueprintNode,
  BlueprintPhenomenon,
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

export const splitBlueprintList = (value: string): string[] => value
  .split(/[，,\n]/)
  .map(item => item.trim())
  .filter(Boolean);

export const cloneBlueprint = (config: ProjectBlueprintConfig): ProjectBlueprintConfig =>
  JSON.parse(JSON.stringify(config)) as ProjectBlueprintConfig;
