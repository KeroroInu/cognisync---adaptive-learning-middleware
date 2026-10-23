import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSESSMENT_KINDS, assessmentKind, assessmentTime, filterAssessmentLibrary, requiresAssessmentReview } from './assessmentLibrary';
import { emptyQuestion, type AssessmentRound } from './assessments';

const round = (id: string, name: string, source = ''): AssessmentRound => ({ id, name, source, questions: [], phase: 'pre', class_name: '', revision: 1, enabled: false, published_at: null, response_count: 0 });
afterEach(() => { vi.unstubAllGlobals(); });

describe('assessment library presentation', () => {
  it('groups known catalog codes without changing the instrument or its phase', () => {
    expect(ASSESSMENT_KINDS).toEqual(['全部', '试卷', '问卷', '量表', '其他']);
    expect(assessmentKind(round('a', '重命名过的 A 卷', '题本代码：knowledge_a；版本：r2'))).toBe('试卷');
    expect(assessmentKind(round('b', '重命名过的背景材料', '题本代码：background；'))).toBe('问卷');
    expect(assessmentKind(round('c', '重命名过的测量工具', '题本代码：ct_pre；'))).toBe('量表');
    const approvedCps = round('cps12', '复杂编程问题解决自评问卷', '题本代码：cps12_20261023；');
    expect(assessmentKind(approvedCps)).toBe('量表');
    expect(requiresAssessmentReview(approvedCps)).toBe(false);
    expect(filterAssessmentLibrary([approvedCps], '量表', '复杂编程')).toEqual([approvedCps]);
    expect(assessmentKind(round('d', '课堂反馈问卷'))).toBe('问卷');
    expect(assessmentKind(round('e', '学习体验量表'))).toBe('量表');
    expect(assessmentKind(round('f', 'Python 测试'))).toBe('试卷');
    expect(assessmentKind(round('g', '本周练习'))).toBe('其他');
  });
  it('keeps review-only and published records out of every library filter', () => {
    const ready = round('ready', 'Python A 卷');
    const reviewed = round('review', 'Python A 卷待审阅', '题本代码：cps_pre；');
    const published = { ...ready, id: 'published', published_at: '2026-10-22T08:00:00Z' };
    const data = [ready, reviewed, published];
    const before = JSON.stringify(data);
    expect(requiresAssessmentReview(reviewed)).toBe(true);
    expect(filterAssessmentLibrary(data, '全部', '')).toEqual([ready]);
    expect(filterAssessmentLibrary(data, '试卷', '  pYthOn  ')).toEqual([ready]);
    expect(filterAssessmentLibrary(data, '量表', '待审阅')).toEqual([]);
    expect(filterAssessmentLibrary(data, '全部', '待审阅')).toEqual([]);
    expect(filterAssessmentLibrary(data, '全部', '找不到')).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('handles absent or invalid publication time without displaying Invalid Date', () => {
    expect(assessmentTime(null)).toBe('时间未记录');
    expect(assessmentTime('not-a-time')).toBe('时间未记录');
    expect(assessmentTime('2026-10-22T08:00:00Z')).not.toMatch(/Invalid/);
  });
  it('creates editable questions without depending on HTTPS-only randomUUID', () => {
    const fill = vi.fn((bytes: Uint8Array) => { bytes.fill(17); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues: fill });
    const q = emptyQuestion();
    expect(q.id).toMatch(/^q_[a-f0-9]{32}$/);
    expect(q.type).toBe('choice');
    expect(q.options).toHaveLength(2);
    expect(fill).toHaveBeenCalledOnce();
  });
});
