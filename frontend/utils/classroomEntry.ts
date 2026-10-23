import type { User } from '../types';

type StudentView = 'preparation' | 'research' | 'evidence' | 'scales';

// 体验组使用教师独立发布的任务包，不进入旧版贪吃蛇分组工作区。
export const studentViews: Record<User['experimentGroup'], StudentView[]> = {
  pdt: ['preparation', 'research', 'evidence', 'scales'],
  ai_pbl: ['preparation', 'research', 'evidence', 'scales'],
  lecture: ['preparation', 'evidence', 'scales'],
  experience: ['preparation', 'evidence', 'scales'],
  unassigned: ['preparation', 'scales'],
};

// 入课不以旧版画像问卷为前置；未分组账号仍只能等待教师安排。
export function classroomEntry(user: Pick<User, 'experimentGroup'> | null) {
  if (!user) return 'login' as const;
  return 'preparation' as const;
}
