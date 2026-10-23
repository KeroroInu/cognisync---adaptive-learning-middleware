import { describe, expect, it } from 'vitest';
import catalog from '../../../backend/app/resources/worksheet_templates.json';
import { worksheetTaskText, type WorksheetTemplate } from './WorksheetTools';

function templateAt(index: number, condition: 'pdt' | 'ai_pbl' = 'pdt'): WorksheetTemplate {
  const lesson = catalog.lessons[index];
  const source = condition === 'pdt' ? 'deconstruction' : 'functional_progression';
  return {
    lesson_id: lesson.lesson_id, template_version: catalog.template_version, condition,
    title: lesson.title, objective: lesson.goal, rules: lesson.rules, acceptance: lesson.acceptance,
    analysis_prompt: lesson.conditions[source].analysis_prompt, change_prompt: lesson.conditions[source].plan_prompt,
    test_hint: lesson.common_test_hint, teacher_review: lesson.teacher_review[source], common_exit: lesson.common_exit,
    student_brief: 'student_brief' in lesson && typeof lesson.student_brief === 'string' ? lesson.student_brief : undefined,
  };
}

describe('published classroom task text', () => {
  for (const lesson of catalog.lessons) {
    for (const [sourceCondition, condition] of [['deconstruction', 'pdt'], ['functional_progression', 'ai_pbl']] as const) {
      it(`${lesson.lesson_id} ${condition} includes the actual prompts and appropriate public brief`, () => {
        const prompts = lesson.conditions[sourceCondition];
        const value: WorksheetTemplate = {
          lesson_id: lesson.lesson_id, template_version: catalog.template_version, condition,
          title: lesson.title, objective: lesson.goal, rules: [], acceptance: lesson.acceptance,
          analysis_prompt: prompts.analysis_prompt, change_prompt: prompts.plan_prompt,
          test_hint: lesson.common_test_hint, teacher_review: lesson.teacher_review[sourceCondition], common_exit: lesson.common_exit,
          student_brief: 'student_brief' in lesson && typeof lesson.student_brief === 'string' ? lesson.student_brief : undefined,
        };
        const text = worksheetTaskText(value);
        expect(text).toContain(lesson.goal);
        expect(text).toContain('1. ' + prompts.analysis_prompt);
        expect(text).toContain('2. ' + prompts.plan_prompt);
        if (lesson.lesson_id === 'C01') {
          expect(text).toContain('## 本课目标');
          expect(text).toContain('## 基本功能');
          expect(text).toContain('## 任务要求');
          for (const criterion of lesson.acceptance) expect(text).toContain('- ' + criterion);
          expect(text).toContain('/submit');
        } else {
          for (const criterion of lesson.acceptance) expect(text).toContain('- ' + criterion);
          expect(text).toContain('代码、README 和自动收集的对话记录');
          expect(text).toContain('未完成或未验证也可如实提交');
        }
        // Teacher-only review/check hints must not leak into student task prose.
        if (value.teacher_review) expect(text).not.toContain(value.teacher_review);
        if (value.common_exit) expect(text).not.toContain(value.common_exit);
      });
    }
  }

  it('keeps the student C01 brief identical for both groups without teaching labels', () => {
    const text = worksheetTaskText(templateAt(0));
    expect(text).toBe(worksheetTaskText(templateAt(0, 'ai_pbl')));
    expect(text).toContain('## 本课目标');
    expect(text).toContain('## 基本功能');
    expect(text).toContain('## 任务要求');
    expect(text).toContain('## 开始制作');
    expect(text).toContain('/submit');
    expect(text).not.toMatch(/两班|架构图|需求文档|支架|闸门|L[0-4]|认知支持|宏观路线|设计起点检查与补建/);
  });

  it('includes an explicit student brief only for C01 and preserves custom fields', () => {
    const value = { ...templateAt(0), objective: '自定义目标', acceptance: ['自定义功能'], rules: ['自定义要求'],
      analysis_prompt: '自定义开始', change_prompt: '自定义尝试', student_brief: '## 使用与提交\n\n打开任务文件夹后使用 /submit。' };
    const text = worksheetTaskText(value);
    for (const content of ['自定义目标', '- 自定义功能', '- 自定义要求', '1. 自定义开始', '2. 自定义尝试', value.student_brief]) expect(text).toContain(content);
    expect(worksheetTaskText({ ...value, lesson_id: 'C02' })).not.toContain(value.student_brief);
  });

  it('preserves the previously published C01 renderer when no student brief was frozen', () => {
    const { student_brief: _studentBrief, ...old } = templateAt(0);
    const text = worksheetTaskText(old);
    expect(text).toContain('两班统一体验');
    expect(text).toContain('不必先画架构图或写需求文档');
    expect(text).toContain('关键代码先尝试1—3行');
  });

  it('retains the teacher-customized objective and both prompts in the short C01 brief', () => {
    const text = worksheetTaskText({ ...templateAt(0), objective: '自定义目标', analysis_prompt: '自定义想法', change_prompt: '自定义计划' });
    expect(text).toContain('自定义目标');
    expect(text).toContain('1. 自定义想法');
    expect(text).toContain('2. 自定义计划');
  });

  it('leaves C01 on the historical renderer for the previously reviewed version', () => {
    const { student_brief: _studentBrief, ...old } = templateAt(0);
    const text = worksheetTaskText({ ...old, template_version: '2026-10-19.1' });
    expect(text).toContain('## 自由体验与交流');
    expect(text).toContain('两组共用工具和局部L1—L4认知支持');
    expect(text).not.toContain('关键代码先尝试1—3行');
  });

  it('does not apply the new C01 brief to another lesson in the same catalog', () => {
    const value = templateAt(1);
    expect(worksheetTaskText(value)).toBe(worksheetTaskText({ ...value, template_version: 'future' }));
    expect(worksheetTaskText(value)).not.toContain('两班统一体验');
  });

  it('uses distinct C02 macro paths after one design start check', () => {
    const deconstruction = worksheetTaskText({ ...templateAt(1), template_version: '2026-10-19.1' });
    const requirements = worksheetTaskText({ ...templateAt(1, 'ai_pbl'), template_version: '2026-10-19.1' });
    expect(deconstruction).toContain('整体运行或已有案例 → 模块职责 → 关系与数据传递 → 定位变更 → 局部实现 → 回到整体更新');
    expect(requirements).toContain('需求与预期 → 功能拆分 → 触发条件、处理步骤与完成标准 → 逐项实现 → 整合');
    for (const text of [deconstruction, requirements]) {
      expect(text.split('有没有漏放自己的辅助文件？')).toHaveLength(2);
      expect(text).toContain('只在本课开始时确认一次');
      expect(text).toContain('不每轮聊天重新检查');
      expect(text).toContain('空白模板、只有教师任务要求或不完整AI概述');
      expect(text).toContain('两组共用工具和局部L1—L4认知支持');
      expect(text).toContain('不是实现、打包或提交的闸门');
    }
  });

  it.each(['2026-10-15.1', '2026-10-19.2', '2026-10-20.1', 'future'])('preserves the previous task prose for unreviewed version %s', version => {
    const value = { ...templateAt(1), template_version: version, objective: '原任务', analysis_prompt: '原分析', change_prompt: '原计划', acceptance: ['原验收'] };
    expect(worksheetTaskText(value)).toBe('原任务\n\n开始前，先说清楚：\n\n1. 原分析\n\n2. 原计划\n\n几句文字或一张小图即可，已有设计直接引用。\n\n本课共同验收：\n\n- 原验收\n\n交一个 SFLS 作品 ZIP：代码、README 和自动收集的对话记录。README 只补运行方法、完成范围、一个关键判断、检查的预期与实际、未解决问题；不再重复填表。未完成或未验证也可如实提交。');
  });

  it.each(['C00', 'C1', 'C001', 'C100', 'L03', 'C01\n'])('does not enable new task flow for invalid course identifier %j', lessonId => {
    const text = worksheetTaskText({ ...templateAt(1), lesson_id: lessonId });
    expect(text).not.toContain('设计起点检查与补建');
    expect(text).not.toContain('自由体验与交流');
    expect(text).toContain('开始前，先说清楚：');
  });

  it('only formats the chosen template without mutating it', () => {
    const value = templateAt(1);
    const before = structuredClone(value);
    worksheetTaskText(value);
    expect(value).toEqual(before);
  });
});
