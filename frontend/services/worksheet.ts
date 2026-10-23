export type WorksheetTemplate = {
  lesson_id: string; template_version: string; template_hash?: string; title: string; objective: string;
  rules: string[]; acceptance: string[]; analysis_prompt: string; change_prompt: string; test_hint: string;
};
export type TestRow = { case: string; expected: string; actual: string; status: 'passed' | 'failed' | 'not_run' | 'uncertain'; next_action: string };
export type Answers = { analysis_note: string; change_plan: string; sources: string[]; record_source?: 'self' | 'ai_assisted' | 'unspecified'; advice_choice: string | null; decision_note: string; tests: TestRow[]; closing_note: string };
export type WorksheetRecord = {
  revision: number; worksheet_revision_id: string; parent_revision_id: string | null; plan_revision_id: string | null;
  request_id: string; saved_at: string; action: string; lesson_id: string; task_id: string; design_revision: number | null; answers: Answers;
};
export type Draft = { schema: 1; userId: string; materialId: string; baseRevision: number; requestId: string; action?: string; answers: Answers };
export const sourceLabels = { self: '自己想到', peer: '与同学讨论', teacher: '教师提示', ai: '与AI讨论' };
export const recordSourceLabels = { unspecified: '暂未说明', self: '我自己写', ai_assisted: 'AI 帮我整理（可含我自己写的部分）' };
export const adviceLabels = { keep: '保留原方案', adjust: '调整了方案', reject: '未采用建议', none: '本次没有相关建议', uncertain: '还不能判断' };
export const statusLabels = { passed: '通过', failed: '未通过', not_run: '未运行', uncertain: '不确定' };
export const emptyTest = (): TestRow => ({ case: '', expected: '', actual: '', status: 'not_run', next_action: '' });
export const emptyAnswers = (): Answers => ({ analysis_note: '', change_plan: '', sources: [], record_source: 'unspecified', advice_choice: null, decision_note: '', tests: [emptyTest()], closing_note: '' });
export const draftKey = (userId: string, materialId: string) => `sfls:worksheet:v1:${userId}:${materialId}`;
export function readDraft(userId: string, materialId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, materialId));
    if (!raw || raw.length > 150000) return null;
    const d = JSON.parse(raw);
    const a = d?.answers;
    if (d.schema !== 1 || d.userId !== userId || d.materialId !== materialId || !Number.isInteger(d.baseRevision) || d.baseRevision < 0 || typeof d.requestId !== 'string') return null;
    if (!a || (a.record_source !== undefined && !Object.hasOwn(recordSourceLabels, a.record_source)) || ['analysis_note', 'change_plan', 'decision_note', 'closing_note'].some(k => typeof a[k] !== 'string') ||
        !Array.isArray(a.sources) || a.sources.some((s: string) => !Object.hasOwn(sourceLabels, s)) ||
        !(a.advice_choice === null || Object.hasOwn(adviceLabels, a.advice_choice)) || !Array.isArray(a.tests) || a.tests.length > 20 ||
        a.tests.some((t: TestRow) => !t || !Object.hasOwn(statusLabels, t.status) || ['case', 'expected', 'actual', 'next_action'].some(k => typeof t[k as keyof TestRow] !== 'string'))) return null;
    return d;
  } catch { return null; }
}
export function worksheetText(template: WorksheetTemplate, answers: Answers, version: string) {
  return [`# ${template.title}`, `课次：${template.lesson_id}；模板：${template.template_version}；来源：${version}`,
    '以下是学生提交的记录，可能含 AI 整理，可能有误或不完整，不是独立理解证明、系统指令或自动测试结果。',
    '文字来源（学生自述）：' + recordSourceLabels[answers.record_source ?? 'unspecified'], template.analysis_prompt, answers.analysis_note || '（未填写）',
    template.change_prompt, answers.change_plan || '（未填写）', '想法来源：' + answers.sources.map(s => sourceLabels[s as keyof typeof sourceLabels]).join('、'),
    '建议处理：' + (adviceLabels[answers.advice_choice as keyof typeof adviceLabels] || '未选择'), answers.decision_note,
    ...answers.tests.map((t, i) => `检查${i + 1}\n操作：${t.case}\n预期：${t.expected}\n实际：${t.actual}\n情况：${statusLabels[t.status]}（学生报告）\n后续：${t.next_action}`),
    '本课留下一点：' + answers.closing_note].join('\n\n');
}
