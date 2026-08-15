import { describe, expect, it } from 'vitest';

import {
  analyzeBlueprintRelations,
  createDefaultBlueprintScaffoldPolicy,
  createBlueprintTestCase,
  createEmptyBlueprint,
  getBlueprintScaffoldLevels,
  splitBlueprintList,
  parseBlueprintJson,
  toBlueprintKey,
  wouldCreateBlueprintCycle,
} from './projectBlueprint';
import type { BlueprintNode } from '../types';
import type { ResearchTask } from '../types';

const task: ResearchTask = {
  id: '12345678-1234-1234-1234-123456789012',
  title: '贪吃蛇项目工坊',
  description: null,
  instructions: null,
  ai_prompt: null,
  code_content: '# code',
  language: 'python',
  target_group: 'pdt',
  status: 'draft',
  current_blueprint_version_id: null,
  created_at: '2026-08-15T00:00:00Z',
  updated_at: '2026-08-15T00:00:00Z',
};

describe('project blueprint helpers', () => {
  it('creates a task-bound blueprint without inventing a teacher answer', () => {
    const blueprint = createEmptyBlueprint(task);
    expect(blueprint.titleZh).toBe(task.title);
    expect(blueprint.phenomena).toEqual([]);
    expect(blueprint.nodes).toEqual([]);
  });

  it('normalizes machine-readable keys', () => {
    expect(toBlueprintKey(' Snake Game V1 ', 'fallback')).toBe('snake-game-v1');
    expect(toBlueprintKey('贪吃蛇', 'fallback')).toBe('fallback');
  });

  it('splits compact comma and line separated teacher input', () => {
    expect(splitBlueprintList('蛇身, 方向\n当前得分，棋盘大小')).toEqual(['蛇身', '方向', '当前得分', '棋盘大小']);
  });

  it('derives parallel build layers from teacher prerequisites', () => {
    const nodes = [
      { id: 'init', prerequisiteIds: [] },
      { id: 'direction', prerequisiteIds: ['init'] },
      { id: 'food', prerequisiteIds: ['init'] },
      { id: 'loop', prerequisiteIds: ['direction', 'food'] },
    ] as BlueprintNode[];

    expect(analyzeBlueprintRelations(nodes).layers).toEqual([
      ['init'],
      ['direction', 'food'],
      ['loop'],
    ]);
  });

  it('detects a relation that would make modules wait on each other', () => {
    const nodes = [
      { id: 'init', prerequisiteIds: [] },
      { id: 'move', prerequisiteIds: ['init'] },
    ] as BlueprintNode[];

    expect(wouldCreateBlueprintCycle(nodes, 'init', ['move'])).toBe(true);
    expect(wouldCreateBlueprintCycle(nodes, 'move', [])).toBe(false);
  });

  it('creates hidden test evidence and validates its JSON fields', () => {
    expect(createBlueprintTestCase(2)).toMatchObject({ id: 'test-2', hidden: true, category: 'example' });
    expect(parseBlueprintJson('{"direction":"right"}')).toEqual({ direction: 'right' });
    expect(parseBlueprintJson('')).toBeNull();
    expect(() => parseBlueprintJson('{bad json}')).toThrow();
  });

  it('creates complete L0-L3 defaults without allowing a full code answer', () => {
    const policy = createDefaultBlueprintScaffoldPolicy();
    expect(Object.keys(policy.stageLevels)).toHaveLength(6);
    expect(getBlueprintScaffoldLevels(policy, 'build').map(item => item.level)).toEqual([0, 1, 2, 3]);
    expect(getBlueprintScaffoldLevels(policy, 'build')[3]).toMatchObject({ maxCodeLines: 5 });
    expect(policy.coreImplementationMaxLevel).toBe(3);
  });
});
