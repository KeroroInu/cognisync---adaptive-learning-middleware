import { describe, expect, it } from 'vitest';
import { TEACHING_CLASSES, isTeachingClass } from './teachingClasses';

describe('fixed teaching classes', () => {
  it('offers exactly two classes with stable experiment mappings', () => {
    expect(TEACHING_CLASSES).toEqual([{ name: '解构班', group: 'pdt' }, { name: '开发班', group: 'ai_pbl' }]);
    expect(isTeachingClass('独立实验班')).toBe(false);
    expect(isTeachingClass('独立体验班')).toBe(false);
    expect(isTeachingClass('开发班')).toBe(true);
  });
});
