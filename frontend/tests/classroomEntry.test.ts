import { describe, it, expect } from 'vitest';
import { classroomEntry } from '../utils/classroomEntry';

describe('课堂入口不依赖旧问卷', () => {
  it('两个人智协同组和旧组均进入项目，未分组仍等待安排', () => {
    expect(classroomEntry(null)).toBe('login');
    for (const experimentGroup of ['pdt', 'ai_pbl', 'lecture'] as const) {
      expect(classroomEntry({ experimentGroup })).toBe('research');
    }
    expect(classroomEntry({ experimentGroup: 'unassigned' })).toBe('dashboard');
  });
});
