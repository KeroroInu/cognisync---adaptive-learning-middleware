import { describe, it, expect } from 'vitest';
import { classroomEntry, studentViews } from '../utils/classroomEntry';

describe('课堂入口不依赖旧问卷', () => {
  it('所有组先进入相同准备区，不自动加载旧项目', () => {
    expect(classroomEntry(null)).toBe('login');
    for (const experimentGroup of ['pdt', 'ai_pbl', 'lecture', 'experience'] as const) {
      expect(classroomEntry({ experimentGroup })).toBe('preparation');
    }
    expect(classroomEntry({ experimentGroup: 'unassigned' })).toBe('preparation');
  });
  it('体验组使用通用任务区，不落入旧贪吃蛇工作台', () => {
    expect(studentViews.experience).toEqual(['preparation', 'evidence', 'scales']);
    expect(studentViews.experience).not.toContain('research');
    expect(studentViews.pdt).toContain('research');
    expect(studentViews.ai_pbl).toContain('research');
  });
});
