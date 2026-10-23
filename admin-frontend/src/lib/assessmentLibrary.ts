import type { AssessmentRound } from './assessments';

export const ASSESSMENT_KINDS = ['全部', '试卷', '问卷', '量表', '其他'] as const;
export type AssessmentKind = typeof ASSESSMENT_KINDS[number];

/** Presentation-only grouping; never changes the instrument or its research phase. */
export function assessmentKind(item: Pick<AssessmentRound, 'name' | 'source'>): Exclude<AssessmentKind, '全部'> {
  if (/题本代码[：:]\s*(?:ct_|cps_)/i.test(item.source) || /量表/.test(item.name)) return '量表';
  if (/题本代码[：:]\s*knowledge_/i.test(item.source) || /试卷|测试|[AB]\s*卷/i.test(item.name)) return '试卷';
  if (/题本代码[：:]\s*background/i.test(item.source) || /问卷|调查/.test(item.name)) return '问卷';
  return '其他';
}

export function requiresAssessmentReview(item: Pick<AssessmentRound, 'source'>) {
  return /题本代码[：:]\s*cps_/i.test(item.source);
}

export function filterAssessmentLibrary(items: AssessmentRound[], kind: AssessmentKind, query: string) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => !item.published_at && !requiresAssessmentReview(item)
    && (kind === '全部' || assessmentKind(item) === kind)
    && (!search || item.name.toLocaleLowerCase().includes(search)));
}

export function assessmentTime(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return '时间未记录';
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
