import { describe, it, expect } from 'vitest';
import { generateCodeSignature, migrateWorkspace, createMazeTransferWorkspace } from '../data/mazeTransfer';

describe('mazeTransfer', () => {
  it('generates stable code signature', () => {
    const code1 = 'def next_move(state):\n    return "up"';
    const code2 = 'def next_move(state):\n    return "down"';
    const sig1 = generateCodeSignature(code1);
    const sig2 = generateCodeSignature(code2);
    
    expect(sig1).toBeTypeOf('string');
    expect(sig1).not.toBe(sig2);
    expect(generateCodeSignature(code1)).toBe(sig1);
  });

  it('migrates old workspace and preserves valid startedAt', () => {
    const task = { id: 't1', title: 'Task', task_kind: 'transfer_test', status: 'active', code_content: '' };
    const newWs = createMazeTransferWorkspace(task as any);
    expect(newWs.startedAt).toBeGreaterThan(0);

    const oldWs = { ...newWs, startedAt: undefined };
    const migrated = migrateWorkspace(oldWs);
    expect(migrated.startedAt).toBeGreaterThan(0);
    expect(migrated.startedAt).toBeLessThanOrEqual(Date.now());

    const invalidWs = { ...newWs, startedAt: -1 };
    expect(migrateWorkspace(invalidWs).startedAt).toBeGreaterThan(0);

    const validPastWs = { ...newWs, startedAt: Date.now() - 10000 };
    expect(migrateWorkspace(validPastWs).startedAt).toBe(validPastWs.startedAt);
  });
});