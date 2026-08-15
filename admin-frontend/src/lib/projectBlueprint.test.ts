import { describe, expect, it } from 'vitest';

import {
  analyzeBlueprintRelations,
  createEmptyBlueprint,
  splitBlueprintList,
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
});
