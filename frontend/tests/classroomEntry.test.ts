import { describe, it, expect } from 'vitest';
import { classroomEntry } from '../utils/classroomEntry';

describe('课堂入口不依赖旧问卷', () => {
  it('所有组先进入相同准备区，不自动加载旧项目', () => {
    expect(classroomEntry(null)).toBe('login');
    for (const experimentGroup of ['pdt', 'ai_pbl', 'lecture'] as const) {
      expect(classroomEntry({ experimentGroup })).toBe('preparation');
    }
    expect(classroomEntry({ experimentGroup: 'unassigned' })).toBe('preparation');
  });
});
