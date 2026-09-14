import type { User } from '../types';

// 入课不以旧版画像问卷为前置；未分组账号仍只能等待教师安排。
export function classroomEntry(user: Pick<User, 'experimentGroup'> | null) {
  if (!user) return 'login' as const;
  return 'preparation' as const;
}
