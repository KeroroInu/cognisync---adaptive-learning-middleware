"""Short classroom worksheets: immutable student reports, never ability scores."""
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4
import zipfile

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.models.sql import PreparationRecord
from app.services.task_design import design_pair


# Explicit opt-in: old frozen worksheets retain their original task text and contract.
# A future template version must be reviewed before enabling this teaching context.
DESIGN_START_TEMPLATE_VERSIONS = frozenset({'2026-10-19.1', '2026-10-20.1', '2026-10-21.1'})
TASK_ROUTE_TEMPLATE_VERSIONS = frozenset({'2026-10-20.1', '2026-10-21.1'})


def learning_context_for_template(template):
    if not template or template.get('template_version') not in DESIGN_START_TEMPLATE_VERSIONS:
        return None
    lesson_id = template.get('lesson_id', '')
    approaches = {'pdt': 'deconstruction', 'ai_pbl': 'requirements'}
    approach = approaches.get(template.get('condition'))
    if not re.fullmatch(r'C(?:0[1-9]|[1-9][0-9])', lesson_id) or not approach:
        return None
    return {'lesson_id': lesson_id, 'approach': 'experience' if lesson_id == 'C01' else approach}


class Template(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    lesson_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')
    template_version: str = Field(min_length=1, max_length=100)
    condition: Literal['pdt', 'ai_pbl']
    title: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=2000)
    rules: list[str] = Field(default_factory=list, max_length=12)
    acceptance: list[str] = Field(default_factory=list, max_length=12)
    analysis_prompt: str = Field(min_length=1, max_length=500)
    change_prompt: str = Field(min_length=1, max_length=500)
    test_hint: str = Field(default='', max_length=1000)
    teacher_review: str = Field(default='', max_length=2000)
    common_exit: str = Field(default='', max_length=1000)
    # Only new task snapshots carry their own route. Omit None when serializing
    # historical templates so that their original hash and text stay unchanged.
    macro_route: str | None = Field(default=None, min_length=1, max_length=1000)
    # Public operating instructions are frozen separately from the AI teaching
    # reference. Missing on historical templates, which retain their old prose.
    student_brief: str | None = Field(default=None, min_length=1, max_length=8000)


class TestRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    case: str = Field(default='', max_length=500)
    expected: str = Field(default='', max_length=500)
    actual: str = Field(default='', max_length=500)
    status: Literal['passed', 'failed', 'not_run', 'uncertain'] = 'not_run'
    next_action: str = Field(default='', max_length=500)


class Answers(BaseModel):
    model_config = ConfigDict(extra='forbid')
    analysis_note: str = Field(default='', max_length=2000)
    change_plan: str = Field(default='', max_length=2000)
    sources: list[Literal['self', 'peer', 'teacher', 'ai']] = Field(default_factory=list, max_length=4)
    record_source: Literal['self', 'ai_assisted', 'unspecified'] = 'unspecified'
    advice_choice: Literal['keep', 'adjust', 'reject', 'none', 'uncertain'] | None = None
    decision_note: str = Field(default='', max_length=2000)
    tests: list[TestRow] = Field(default_factory=list, max_length=20)
    closing_note: str = Field(default='', max_length=2000)


class SaveInput(Answers):
    expected_user_id: UUID
    request_id: UUID
    base_revision: int = Field(ge=0)
    action: Literal['plan', 'progress', 'closing']


def catalog():
    from app.services.lesson_pack import rules_for
    path = Path(__file__).resolve().parents[1] / 'resources/worksheet_templates.json'
    source = json.loads(path.read_text())
    result = []
    for lesson in source['lessons']:
        for source_condition, condition in (('deconstruction', 'pdt'), ('functional_progression', 'ai_pbl')):
            prompts = lesson['conditions'][source_condition]
            result.append(Template(lesson_id=lesson['lesson_id'], template_version=source['template_version'],
                condition=condition, title=lesson['title'], objective=lesson['goal'], acceptance=lesson['acceptance'], rules=rules_for(lesson['lesson_id']),
                analysis_prompt=prompts['analysis_prompt'], change_prompt=prompts['plan_prompt'],
                test_hint=lesson['common_test_hint'], teacher_review=lesson['teacher_review'][source_condition],
                common_exit=lesson['common_exit'], macro_route=prompts.get('macro_route'),
                student_brief=lesson.get('student_brief')).model_dump(exclude_none=True))
    return result


def frozen_template(value):
    template = Template.model_validate(value).model_dump(exclude_none=True)
    if any(len(line) > 1000 for key in ('rules', 'acceptance') for line in template[key]):
        raise HTTPException(422, '规则或验收项太长，请使用简短句子')
    return {**template, 'template_hash': digest(template)}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def public_template(template):
    private = {'condition', 'teacher_review', 'common_exit'}
    if template and template.get('student_brief'):
        private.add('macro_route')
    return {k: v for k, v in template.items() if k not in private} if template else None


def task_text(template):
    """Render the reviewed task route without rewriting historical briefs."""
    if template.get('student_brief') and template['lesson_id'] == 'C01':
        heading = (f'# 第{int(template["lesson_id"][1:])}课 · {template["title"]}'
                   if template['lesson_id'].startswith('C') else f'# {template["lesson_id"]} · {template["title"]}')
        return '\n\n'.join([
            heading,
            '## 本课目标', template['objective'],
            '## 基本功能', '\n'.join('- ' + line for line in template['acceptance']),
            '## 任务要求', '\n'.join('- ' + line for line in template['rules']),
            '## 开始制作', '1. ' + template['analysis_prompt'], '2. ' + template['change_prompt'],
            template['student_brief'],
        ]) + '\n'
    if template.get('template_version') == '2026-10-21.1' and template['lesson_id'] == 'C01':
        # The student-facing brief is intentionally separate from the frozen AI
        # teaching reference in the lesson pack. Never rewrite an old snapshot.
        return '\n\n'.join([
            '# 第1课 · AI 会写代码以后',
            template['objective'],
            '## 本课任务',
            '两班统一体验：和SFLS一起制作基础贪吃蛇，尝试方向控制、进食增长与碰撞结束。不必先画架构图或写需求文档，不预设统一架构，也不把表达完整当作开始实现或提交的条件。',
            '1. ' + template['analysis_prompt'],
            '2. ' + template['change_prompt'] + '关键代码先尝试1—3行，不会再请SFLS解释并帮助写好。',
            '3. 运行后结合一小段实际代码简短回顾，再提交；没有完成或验证的部分如实保留。',
            '## 使用与提交',
            '登录本人平台账号，下载并完整解压自己的任务包，在任务文件夹启动SFLS，按提示输入本课API key。无需再次输入平台学号密码；遇到环境问题请老师协助。',
            '结束时先与SFLS简短回顾，再用 /submit 提交；选择回顾后，讨论结束需再次 /submit，看到收件回执才算提交成功。备用：/pack 生成ZIP，再到平台上传ZIP，不上传整个文件夹。',
            'README由SFLS依据真实对话协助整理，你只补缺少的一句说明，不另填长表。本人任务包不要转发，不把API key写入作品。',
        ]) + '\n'
    if template.get('template_version') not in TASK_ROUTE_TEMPLATE_VERSIONS:
        return _legacy_task_text(template)
    context = learning_context_for_template(template)
    experience = context and context['approach'] == 'experience'
    route = template.get('macro_route')
    design_start = []
    if context and not experience:
        design_start = [
            '## 设计起点检查与补建',
            '先阅读当前代码、已有图文设计和相关对话。程序是否做完不等于设计是否清楚；空白模板、只有教师任务要求或不完整AI概述，都不能当作学生已经形成设计。',
            '若没有能支撑本课的辅助图文，只在本课开始时确认一次“有没有漏放自己的辅助文件？”；已有明确确认就不再问。已有设计就沿用，只补当前需要的关系或需求，不重写项目，也不每轮聊天重新检查。',
            *(['本课参考路径：' + route + '。'] if route else []),
            '参考路径不是固定步骤清单，不要将整条路线变成开场提问；只推进当前需要的一步，已有清楚表达的部分直接跳过。',
            '两组共用工具和局部L1—L4认知支持，按当前困难选取。图或文字都可选，几句说明也可以；补建不是实现、打包或提交的闸门，不能代学生声称已经理解。',
        ]
    return '\n\n'.join([
        (f'# 第{int(template["lesson_id"][1:])}课 · {template["title"]}' if template['lesson_id'].startswith('C') else f'# {template["lesson_id"]} · {template["title"]}'),
        template['objective'],
        '## 与SFLS一起推进',
        '先让学生在输入框里自由表达。默认用简短开放式提问，一次只问一个当前缺口；不默认给两个选项，也不一次给出整套步骤。学生明确不会或主动需要帮助时，再按需增加提示。',
        '先看已有代码、图文与相关对话；已有有效表达就沿用，不重复索要，不因缺图或文档阻止开发。不要把任务规定的模块或步骤直接当作学生自己的思考。',
        *design_start,
        '## 自由体验与交流' if experience else '## 本课思考参考',
        ('本课两班统一自由体验；不必先画架构图或写需求文档，不预设统一架构。可以边做边讨论关键问题或算法，不把表达完整当作开始实现或提交的条件。'
         if experience else
         '可以用共用的画板、文字或其他工具保留自己的思路；重要的是说明当前判断，不是交齐某种格式。'),
        '下面两条是本课的思考参考，不是开场问卷，也不是每轮必答；只在相关部分尚不清楚时选一个缺口交流。',
        '- ' + template['analysis_prompt'],
        '- ' + template['change_prompt'],
        '## 本课共同验收',
        '\n'.join('- ' + line for line in template['acceptance']),
        '## 做完交什么',
        '上传一个SFLS作品ZIP，包含当前代码、简短README和自动收集的对话/操作记录。未完成也能交，不补造测试或“原先的想法”。',
        'README由SFLS结合真实对话协助整理，学生只补缺少的理解：怎么运行、做到什么、一个关键判断、至少一次检查的预期与实际、还有什么问题。已有图或需求说明直接引用，不再重复填表。',
        '至少一次检查是最低记录要求，不等于通过全部验收。工具实测、本人观察和未验证分开写；预期如果在运行后补记，要注明是回顾。',
        '设计有变化才更新图或文字。图不要求标准UML，两班都能选择画图或文字；不按图的数量、字数或AI回答长度评分。',
    ]) + '\n'


def _legacy_task_text(template):
    """One short brief, with README as the record rather than another blank form."""
    context = learning_context_for_template(template)
    design_start = []
    if context and context['approach'] != 'experience':
        route = ('整体运行或已有案例 → 模块职责 → 关系与数据传递 → 定位变更 → 局部实现 → 回到整体更新'
                 if context['approach'] == 'deconstruction' else
                 '需求与预期 → 功能拆分 → 触发条件、处理步骤与完成标准 → 逐项实现 → 整合')
        design_start = [
            '## 设计起点检查与补建',
            '先由SFLS阅读当前代码、已有图文设计和相关对话，检查它们能否支持本课任务。程序是否做完不等于设计是否清楚；空白模板、只有教师任务要求或不完整AI概述，都不能当作学生已经形成设计。',
            '若没有能支撑本课的辅助图文，只在本课开始时确认一次“有没有漏放自己的辅助文件？”；已有明确确认就不再问。确认没有后，按下面路径协助补建，用简图或几句关键说明保留即可。已有有效设计就沿用并更新，不重写项目，也不每轮聊天重新检查。',
            '设计不清楚时，按此路径补建：' + route + '。',
            '两组共用工具和局部L1—L4认知支持，按当前困难选取。补建不要求长文档，不是实现、打包或提交的闸门。SFLS可以整理学生表达，不能代学生声称已经理解。',
        ]
    experience = context and context['approach'] == 'experience'
    return '\n\n'.join([
        (f'# 第{int(template["lesson_id"][1:])}课 · {template["title"]}' if template['lesson_id'].startswith('C') else f'# {template["lesson_id"]} · {template["title"]}'),
        template['objective'],
        *design_start,
        '## 自由体验与交流' if experience else '## 本课思考路径' if design_start else '## 开始前，先说清楚',
        '1. ' + template['analysis_prompt'],
        '2. ' + template['change_prompt'],
        ('可以边尝试边交流关键问题或算法；已有想法直接说，不必重复填写，不确定可以说明。两组共用工具和局部L1—L4认知支持，不把表达完整当作开始实现或提交的条件。'
         if experience else
         '用几句文字或一张小图表达即可；已有设计就引用，不用重写。先留下当前想法，再交给SFLS协助；来不及或不确定可以注明。'),
        '## 本课共同验收',
        '\n'.join('- ' + line for line in template['acceptance']),
        '## 做完交什么',
        '上传一个SFLS作品ZIP，包含当前代码、简短README和自动收集的对话/操作记录。未完成也能交，不补造测试或“原先的想法”。',
        'README保留：怎么运行、做到什么、一个关键判断、至少一次检查的预期与实际、还有什么问题。已有图或需求说明直接引用，不再重复填一份表。',
        '至少一次检查是最低记录要求，不等于通过全部验收。工具实测、本人观察和未验证分开写；预期如果在运行后补记，要注明是回顾。',
        '设计有变化才更新图或文字。图不要求标准UML，两班都能选择画图或文字；不按图的数量、字数或AI回答长度评分。',
    ]) + '\n'


def query(user_id, material_id):
    return select(PreparationRecord).where(PreparationRecord.user_id == user_id,
        PreparationRecord.kind == 'worksheet', PreparationRecord.payload['task_id'].astext == str(material_id))


async def latest(db, user_id, material_id):
    record = await db.scalar(query(user_id, material_id).order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).limit(1))
    return record.payload if record else None


def public_record(payload):
    if not payload:
        return None
    return {k: v for k, v in payload.items() if k not in ('condition', 'class_name', 'user_id', 'request')}


async def save(db, user, material, body):
    if body.expected_user_id != user.id:
        raise HTTPException(409, '登录账号已变化，请重新打开本人的任务单')
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'), {'key': f'worksheet:{user.id}:{material.id}'})
    submitted = body.model_dump(mode='json')
    old = await db.scalar(select(PreparationRecord).where(PreparationRecord.user_id == user.id, PreparationRecord.request_id == body.request_id))
    if old:
        old_request = old.payload.get('request') or {}
        compatible_request = {**old_request, 'record_source': old_request.get('record_source', 'unspecified')}
        if old.kind != 'worksheet' or old.payload.get('task_id') != str(material.id) or compatible_request != submitted:
            raise HTTPException(409, '请求编号已用于其他记录')
        return old.payload
    current = await latest(db, user.id, material.id)
    if body.base_revision != (current['revision'] if current else 0):
        raise HTTPException(409, '已有较新版本。请保留本机草稿，读取新版本并比较后再保存。')
    template = material.configuration['worksheet']
    design = (await design_pair(db, user.id, material.configuration['project_id']))['current']
    revision_id = uuid4()
    payload = {'schema': 'sfls-worksheet/1', 'user_id': str(user.id), 'class_name': user.class_name,
        'project_id': material.configuration['project_id'], 'task_id': str(material.id), 'session_id': str(material.session_id),
        'lesson_id': template['lesson_id'], 'template_version': template['template_version'], 'template_hash': template['template_hash'],
        'condition': template['condition'], 'worksheet_revision_id': str(revision_id),
        'parent_revision_id': current['worksheet_revision_id'] if current else None,
        'plan_revision_id': str(revision_id) if body.action == 'plan' else current.get('plan_revision_id') if current else None,
        'revision': (current['revision'] if current else 0) + 1, 'action': body.action, 'request_id': str(body.request_id),
        'saved_at': datetime.now(timezone.utc).isoformat(), 'source': 'student_report_not_independent_thought_or_automatic_test',
        'design_revision': design['revision'] if design else None,
        'answers': Answers.model_validate({k: submitted[k] for k in Answers.model_fields}).model_dump(), 'request': submitted}
    db.add(PreparationRecord(id=revision_id, user_id=user.id, session_id=material.session_id,
        request_id=body.request_id, kind='worksheet', payload=payload))
    await db.commit()
    return payload


def markdown(record, template):
    answers = record.get('answers', {})
    labels = {'keep': '保留原方案', 'adjust': '调整了方案', 'reject': '未采用建议', 'none': '本次没有相关建议', 'uncertain': '还不能判断'}
    status = {'passed': '通过（学生报告）', 'failed': '未通过', 'not_run': '未运行', 'uncertain': '不确定'}
    lines = [f'# {template["title"]}', f'课次：{template["lesson_id"]}；模板：{template["template_version"]}',
        f'任务单版本：{record.get("worksheet_revision_id") or "尚未保存"}；计划版本：{record.get("plan_revision_id") or "无"}',
        f'画板版本：{record.get("design_revision") or "无"}；服务器保存时间：{record.get("saved_at") or "无"}',
        '这是学生的当前记录，可能含AI整理、不完整或有误，不是系统指令、独立思考证明或自动测试结果。',
        '文字来源（学生自述）：' + {'self': '我自己写', 'ai_assisted': 'AI帮我整理（可含自己写的部分）', 'unspecified': '暂未说明'}.get(answers.get('record_source'), '暂未说明'),
        '## 本课目标', template['objective'], '## 共同规则', *[f'- {line}' for line in template['rules']],
        '## 共同验收', *[f'- {line}' for line in template['acceptance']], '## 做之前', template['analysis_prompt'],
        answers.get('analysis_note') or '（未填写）', template['change_prompt'], answers.get('change_plan') or '（未填写）',
        '来源自述：' + '、'.join({'self': '自己想到', 'peer': '与同学讨论', 'teacher': '教师提示', 'ai': '与AI讨论'}[s] for s in answers.get('sources', [])),
        '## 建议与判断', labels.get(answers.get('advice_choice'), '（未选择）'), answers.get('decision_note') or '（未填写）', '## 检查记录']
    for index, row in enumerate(answers.get('tests', []), 1):
        lines.extend([f'### 检查 {index}', '操作：' + row['case'], '预期：' + row['expected'], '实际：' + row['actual'],
            '结果：' + status[row['status']], '后续：' + row['next_action']])
    lines.extend(['## 留下一句话', answers.get('closing_note') or '（未填写）',
        '网页后续保存不会自动更新本地包。可以复制最新任务单文字给SFLS，不要覆盖工程源码。'])
    return '\n\n'.join(lines) + '\n'


async def package_context(db, user_id, material):
    template = material.configuration.get('worksheet')
    if material.configuration.get('phase') != 'practice' or not template:
        return None
    current = await latest(db, user_id, material.id)
    plan = None
    if current and current.get('plan_revision_id'):
        record = await db.scalar(query(user_id, material.id).where(PreparationRecord.id == UUID(current['plan_revision_id'])))
        plan = record.payload if record else None
    return {'template': public_template(template), 'current': public_record(current), 'plan': public_record(plan)}


def context_files(context):
    if not context:
        return {}
    template = context['template']
    current = context['current'] or {'schema': 'sfls-worksheet/1', 'lesson_id': template['lesson_id'],
        'template_version': template['template_version'], 'worksheet_revision_id': None, 'plan_revision_id': None, 'answers': Answers().model_dump()}
    files = {}
    for folder, record in (('current', current), ('initial', context['plan'])):
        if record:
            value = {**record, 'template': template}
            files[f'design/{folder}/worksheet.json'] = json.dumps(value, ensure_ascii=False, indent=2).encode()
            # Keep historical authored records, but do not create a second empty form.
            if record.get('worksheet_revision_id'):
                files[f'design/{folder}/worksheet.md'] = markdown(record, template).encode()
    return files


def context_binding(context):
    if not context:
        return None
    current = context['current'] or {}
    files = context_files(context)
    return {'lesson_id': context['template']['lesson_id'], 'template_version': context['template']['template_version'],
        'template_hash': context['template']['template_hash'], 'worksheet_revision_id': current.get('worksheet_revision_id'),
        'plan_revision_id': current.get('plan_revision_id'), 'design_revision': current.get('design_revision'),
        'files': {name: hashlib.sha256(value).hexdigest() for name, value in files.items()}}


def submission_context(data, binding, web):
    if not binding:
        return None
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        observed = {}
        for name, expected in binding['files'].items():
            packed = 'evidence/context/' + name
            observed[name] = hashlib.sha256(archive.read(packed)).hexdigest() if packed in archive.namelist() else None
        submitted_version = None
        name = 'evidence/context/design/current/worksheet.json'
        if name in archive.namelist() and archive.getinfo(name).file_size <= 100000:
            try:
                value = json.loads(archive.read(name))
                if isinstance(value, dict):
                    submitted_version = {key: value.get(key) if isinstance(value.get(key), str) and len(value[key]) <= 120 else None
                        for key in ('worksheet_revision_id', 'plan_revision_id', 'lesson_id', 'template_version')}
            except (ValueError, UnicodeError, RecursionError):
                pass  # Original bytes and hashes remain available; never invent a parsed version.
    return {'download_context': binding, 'submitted_context_hashes': observed,
        'submitted_version_unverified': submitted_version,
        'matches_download': observed == binding['files'], 'web_at_receipt': public_record(web),
        'source': 'download_snapshot_uploaded_files_and_web_record_are_distinct_not_execution_attestation'}


EXPORT_FIELDS = ('research_id', 'source_id', 'session_id', 'task_id', 'project_id', 'lesson_id', 'condition',
    'template_version', 'template_hash', 'worksheet_revision_id', 'parent_revision_id', 'plan_revision_id',
    'revision', 'action', 'saved_at', 'design_revision', 'analysis_note', 'change_plan', 'sources',
    'advice_choice', 'decision_note', 'tests', 'closing_note', 'record_source', 'source')


def export_row(row):
    payload = row['payload']
    if row['kind'] != 'worksheet' or payload.get('schema') != 'sfls-worksheet/1':
        return None
    values = {**payload, **payload['answers'], 'research_id': 'S-' + str(row['user_id']), 'source_id': row['id']}
    values.setdefault('record_source', 'unspecified')
    return {field: values.get(field) for field in EXPORT_FIELDS}
