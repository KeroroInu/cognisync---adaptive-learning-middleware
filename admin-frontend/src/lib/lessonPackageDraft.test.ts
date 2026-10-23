import { describe, expect, it } from 'vitest';
import { newTaskDefaults } from './lessonPackageDraft';

describe('independent task defaults', () => {
  it('keeps the existing experimental course project unchanged', () => {
    for (const name of ['解构班', '开发班', undefined]) {
      expect(newTaskDefaults(name)).toEqual({ projectId: 'snake-course', inheritPrevious: true });
    }
  });
  it('gives each experience task a new valid project without implicit inheritance', () => {
    const first = newTaskDefaults('体验组');
    const second = newTaskDefaults('体验组');
    expect(first.projectId).toMatch(/^experience-[A-Za-z0-9_-]+$/);
    expect(first.projectId.length).toBeLessThanOrEqual(100);
    expect(second.projectId).not.toBe(first.projectId);
    expect(first.inheritPrevious).toBe(false);
    expect(second.inheritPrevious).toBe(false);
  });
});
