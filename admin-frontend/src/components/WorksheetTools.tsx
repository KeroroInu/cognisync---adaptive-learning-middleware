import { useEffect, useState } from 'react';
import { classroomAdmin } from '../lib/classroom';

export type WorksheetTemplate = {
  lesson_id: string; template_version: string; condition: 'pdt' | 'ai_pbl'; title: string; objective: string;
  rules: string[]; acceptance: string[]; analysis_prompt: string; change_prompt: string; test_hint: string;
  teacher_review: string; common_exit: string;
  student_brief?: string;
};
export function worksheetTaskText(value: WorksheetTemplate) {
  if (value.lesson_id === 'C01' && value.student_brief) {
    return [
      '# 第1课 · ' + value.title,
      '## 本课目标',
      value.objective,
      '## 基本功能',
      value.acceptance.map(line => '- ' + line).join('\n'),
      '## 任务要求',
      value.rules.map(line => '- ' + line).join('\n'),
      '## 开始制作',
      '1. ' + value.analysis_prompt,
      '2. ' + value.change_prompt,
      value.student_brief,
    ].join('\n\n') + '\n';
  }
  if (value.template_version === '2026-10-21.1' && value.lesson_id === 'C01') {
    // Keep the short public brief aligned with the backend; AI-only guidance
    // belongs in the task package, not in this student-facing description.
    return [
      '# 第1课 · AI 会写代码以后',
      value.objective,
      '## 本课任务',
      '两班统一体验：和SFLS一起制作基础贪吃蛇，尝试方向控制、进食增长与碰撞结束。不必先画架构图或写需求文档，不预设统一架构，也不把表达完整当作开始实现或提交的条件。',
      '1. ' + value.analysis_prompt,
      '2. ' + value.change_prompt + '关键代码先尝试1—3行，不会再请SFLS解释并帮助写好。',
      '3. 运行后结合一小段实际代码简短回顾，再提交；没有完成或验证的部分如实保留。',
      '## 使用与提交',
      '登录本人平台账号，下载并完整解压自己的任务包，在任务文件夹启动SFLS，按提示输入本课API key。无需再次输入平台学号密码；遇到环境问题请老师协助。',
      '结束时先与SFLS简短回顾，再用 /submit 提交；选择回顾后，讨论结束需再次 /submit，看到收件回执才算提交成功。备用：/pack 生成ZIP，再到平台上传ZIP，不上传整个文件夹。',
      'README由SFLS依据真实对话协助整理，你只补缺少的一句说明，不另填长表。本人任务包不要转发，不把API key写入作品。',
    ].join('\n\n') + '\n';
  }
  // Match the explicit backend compatibility gate; unknown/old versions retain their original prose.
  const hasLearningContext = value.template_version === '2026-10-19.1'
    && value.lesson_id.length === 3
    && /^C(?:0[1-9]|[1-9][0-9])$/.test(value.lesson_id)
    && (value.condition === 'pdt' || value.condition === 'ai_pbl');
  if (!hasLearningContext) {
    return [value.objective, '开始前，先说清楚：', '1. ' + value.analysis_prompt, '2. ' + value.change_prompt,
      '几句文字或一张小图即可，已有设计直接引用。', '本课共同验收：', ...value.acceptance.map(line => '- ' + line),
      '交一个 SFLS 作品 ZIP：代码、README 和自动收集的对话记录。README 只补运行方法、完成范围、一个关键判断、检查的预期与实际、未解决问题；不再重复填表。未完成或未验证也可如实提交。'].join('\n\n');
  }
  const experience = value.lesson_id === 'C01';
  const route = value.condition === 'pdt'
    ? '整体运行或已有案例 → 模块职责 → 关系与数据传递 → 定位变更 → 局部实现 → 回到整体更新'
    : '需求与预期 → 功能拆分 → 触发条件、处理步骤与完成标准 → 逐项实现 → 整合';
  const designStart = experience ? [] : [
    '## 设计起点检查与补建',
    '先由SFLS阅读当前代码、已有图文设计和相关对话，检查它们能否支持本课任务。程序是否做完不等于设计是否清楚；空白模板、只有教师任务要求或不完整AI概述，都不能当作学生已经形成设计。',
    '若没有能支撑本课的辅助图文，只在本课开始时确认一次“有没有漏放自己的辅助文件？”；已有明确确认就不再问。确认没有后，按下面路径协助补建，用简图或几句关键说明保留即可。已有有效设计就沿用并更新，不重写项目，也不每轮聊天重新检查。',
    '设计不清楚时，按此路径补建：' + route + '。',
    '两组共用工具和局部L1—L4认知支持，按当前困难选取。补建不要求长文档，不是实现、打包或提交的闸门。SFLS可以整理学生表达，不能代学生声称已经理解。',
  ];
  return [
    `# 第${Number(value.lesson_id.slice(1))}课 · ${value.title}`,
    value.objective,
    ...designStart,
    experience ? '## 自由体验与交流' : '## 本课思考路径',
    '1. ' + value.analysis_prompt,
    '2. ' + value.change_prompt,
    experience
      ? '可以边尝试边交流关键问题或算法；已有想法直接说，不必重复填写，不确定可以说明。两组共用工具和局部L1—L4认知支持，不把表达完整当作开始实现或提交的条件。'
      : '用几句文字或一张小图表达即可；已有设计就引用，不用重写。先留下当前想法，再交给SFLS协助；来不及或不确定可以注明。',
    '## 本课共同验收',
    value.acceptance.map(line => '- ' + line).join('\n'),
    '## 做完交什么',
    '上传一个SFLS作品ZIP，包含当前代码、简短README和自动收集的对话/操作记录。未完成也能交，不补造测试或“原先的想法”。',
    'README保留：怎么运行、做到什么、一个关键判断、至少一次检查的预期与实际、还有什么问题。已有图或需求说明直接引用，不再重复填一份表。',
    '至少一次检查是最低记录要求，不等于通过全部验收。工具实测、本人观察和未验证分开写；预期如果在运行后补记，要注明是回顾。',
    '设计有变化才更新图或文字。图不要求标准UML，两班都能选择画图或文字；不按图的数量、字数或AI回答长度评分。',
  ].join('\n\n') + '\n';
}
export function WorksheetConfig({ value, onChange, condition = 'pdt' }: { value: WorksheetTemplate | null; onChange: (value: WorksheetTemplate | null) => void; condition?: 'pdt' | 'ai_pbl' }) {
  const [templates, setTemplates] = useState<WorksheetTemplate[]>([]), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); void classroomAdmin<WorksheetTemplate[]>('/worksheet-templates', undefined, controller.signal).then(setTemplates).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }); return () => controller.abort(); }, [retry]);
  const lessons = templates.filter(t => t.condition === condition);
  return <section aria-label="课次模板"><label>本课模板<select value={value?.lesson_id ?? ''} onChange={event => onChange(templates.find(t => t.lesson_id === event.target.value && t.condition === condition) ?? null)}><option value="">自行填写任务</option>{lessons.map(t => <option key={t.lesson_id} value={t.lesson_id}>第 {Number(t.lesson_id.slice(1))} 课 · {t.title}</option>)}</select></label>
    {error && <p role="alert">{error}<button onClick={() => { setError(''); setRetry(n => n + 1); }}>重读模板</button></p>}
    <small>已按本班选择{condition === 'pdt' ? '项目解构' : '功能推进'}提示。两班共用目标、资料和验收；课程从第 1 课开始，不要求已有作品。</small>
    <p>选择或调整模板会替换下方任务要求，包括手动补充的文字。请先调整模板，再补充任务要求。</p>
    {value && <><small>课次资料随包发出，不再要求学生填写网页任务单。发布后模板冻结，旧记录保留。</small>
      <details><summary>预览与调整 · 模板 {value.template_version}</summary>
        <label>共同目标<textarea rows={2} maxLength={2000} value={value.objective} onChange={e => onChange({ ...value, objective: e.target.value })} /></label>
        <label>共同规则（每行一项，可留空）<textarea rows={2} value={value.rules.join('\n')} onChange={e => onChange({ ...value, rules: e.target.value.split('\n').filter(Boolean) })} /></label>
        <label>共同验收（每行一项）<textarea rows={3} value={value.acceptance.join('\n')} onChange={e => onChange({ ...value, acceptance: e.target.value.split('\n').filter(Boolean) })} /></label>
        <label>第一条分析提示<textarea rows={2} maxLength={500} value={value.analysis_prompt} onChange={e => onChange({ ...value, analysis_prompt: e.target.value })} /></label>
        <label>第二条计划提示<textarea rows={2} maxLength={500} value={value.change_prompt} onChange={e => onChange({ ...value, change_prompt: e.target.value })} /></label>
        <p>教师回看：{value.teacher_review}</p><p>共同口头核查：{value.common_exit}</p><small>以上两项教师提示不会进入学生页面或 SFLS 材料。</small>
      </details></>}
  </section>;
}
