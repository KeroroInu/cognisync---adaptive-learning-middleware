"""Pure task/package regressions: no database, accounts or external services."""
from copy import deepcopy
import hashlib
import io
import json
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest

from app.services.sfls_package import (
    POLICY_VERSION,
    make_sfls_package,
    task_contract,
    validate_submission_contract,
)
from app.services.worksheet import (
    catalog,
    frozen_template,
    learning_context_for_template,
    task_text,
)


def material_for(template, phase='practice'):
    frozen = frozen_template(template)
    return SimpleNamespace(id=uuid4(), title=frozen['title'], configuration={
        'phase': phase, 'project_id': 'snake-course', 'policy_version': POLICY_VERSION,
        'worksheet': frozen, 'task': task_text(frozen),
    })


def package_files(material, platform='mac'):
    data, _ = make_sfls_package(material, 'student', 'download', platform, None, None)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def test_c01_has_identical_experience_prompt_and_no_design_prerequisite():
    first, second = catalog()[:2]
    assert first['template_version'] == second['template_version'] == '2026-10-21.1'
    assert task_text(first) == task_text(second)
    brief = task_text(first)
    assert '先尝试写几行关键代码' in brief
    assert '解释并帮助完成' in brief
    assert '## 本课目标' in brief and '## 基本功能' in brief
    assert '## 开始使用' in brief and '## 提交作品' in brief
    assert all(phrase not in brief for phrase in ('两班', '架构图', '需求文档', 'L1', '四级', '支架', '闸门'))
    assert '设计起点检查与补建' not in brief
    for template in (first, second):
        assert learning_context_for_template(template) == {'lesson_id': 'C01', 'approach': 'experience'}


def test_c02_checks_design_before_following_the_two_macro_routes():
    deconstruction, requirements = catalog()[2:4]
    first, second = task_text(deconstruction), task_text(requirements)
    assert first.index('设计起点检查与补建') < first.index(deconstruction['analysis_prompt'])
    assert '整体作品 → 模块职责与联系 → 数据如何流动 → 定位变更 → 局部实现 → 更新整体设计' in first
    assert '需求与预期效果 → 功能拆分 → 触发条件、处理步骤与完成标准 → 逐项实现 → 整合' in second
    assert '定位本次修改与保留的模块' in first
    assert '逐项实现、测试并整合' in second
    for brief in (first, second):
        assert '当前代码、已有图文设计和相关对话' in brief
        assert '程序是否做完不等于设计是否清楚' in brief
        assert '空白模板、只有教师任务要求或不完整AI概述' in brief
        assert brief.count('有没有漏放自己的辅助文件？') == 1
        assert '只在本课开始时确认一次' in brief
        assert '已有明确确认就不再问' in brief
        assert '不每轮聊天重新检查' in brief
        assert '不是实现、打包或提交的闸门' in brief
        assert '两组共用工具和局部L1—L4认知支持' in brief
        assert '不能代学生声称已经理解' in brief


def test_new_tasks_start_open_and_do_not_turn_prompts_into_an_interrogation():
    for template in catalog()[2:]:
        brief = task_text(template)
        assert '先让学生在输入框里自由表达' in brief
        assert '一次只问一个当前缺口' in brief
        assert '不默认给两个选项' in brief
        assert '不一次给出整套步骤' in brief
        assert '学生明确不会或主动需要帮助时，再按需增加提示' in brief
        assert '下面两条是本课的思考参考，不是开场问卷，也不是每轮必答' in brief
        assert '已有有效表达就沿用，不重复索要' in brief
        assert '不因缺图或文档阻止开发' in brief


def test_macro_route_is_carried_by_task_and_can_be_edited_per_template():
    template = catalog()[2]
    assert template['macro_route'].startswith('整体作品')
    changed = {**template, 'macro_route': '先说明当前关系，再比较本次改造的影响'}
    brief = task_text(changed)
    assert changed['macro_route'] in brief
    assert template['macro_route'] not in brief
    assert '参考路径不是固定步骤清单' in brief
    files = package_files(material_for(changed))
    assert changed['macro_route'] in files['materials/TASK.md'].decode()


def test_both_paths_keep_identical_goals_rules_and_acceptance():
    templates = catalog()
    for deconstruction, requirements in zip(templates[::2], templates[1::2]):
        for field in ('lesson_id', 'objective', 'rules', 'acceptance', 'test_hint', 'common_exit'):
            assert deconstruction[field] == requirements[field]
        if deconstruction['lesson_id'] != 'C01':
            assert deconstruction['macro_route'] != requirements['macro_route']


@pytest.mark.parametrize('index,expected_hash', [
    (0, 'e35f7c793abd5552fc6ed373c268c35a3c94d8673c9e18fceb5a54c031a97ed3'),
    (1, 'e35f7c793abd5552fc6ed373c268c35a3c94d8673c9e18fceb5a54c031a97ed3'),
    (2, '4677d6a4341732f76010d2546dbb22368cc9f870aa5b47acfba6095948c5d716'),
    (3, 'c5b7d1b3cbe853765b5c9d6285840932b5b1223a29ee30eabbb4527ed40bde85'),
    (4, '9315bce6ef031dd6a2ac946e68b61d7768853bdc2927e90f87ee7657ae29a6b9'),
    (5, '82dcc877a88a100729dcd44b342be0633fb2ca1b316459b59dd5d73900348ef8'),
    (6, 'd362ee507d582065968de41d830fd3e53f18b3dfd97d097bfe75171d628a7c4c'),
    (7, '1c86d0bd9deb942ee941eaee36b74fb3472fa1c128eb3bf1520bfec68de6cd08'),
    (8, '45c66c607f6eeca597ce39156f86256069eaa6034966950247d9033adb5a4a96'),
    (9, '259d9d633814914a1356b9c5e7ce4a6b99daf66859e683284c3cf8c3bc863400'),
])
def test_reviewed_oct19_briefs_keep_their_exact_historical_output(index, expected_hash):
    # Digests were recorded before the Oct20 formatter change, not recomputed
    # from the new format. Existing snapshots do not gain macro_route defaults.
    template = {key: value for key, value in catalog()[index].items()
                if key not in ('macro_route', 'student_brief')}
    if index < 2:
        # Keep the actual old C01 content too; the current catalog has a new
        # objective and exit criteria, which must not redefine this fixture.
        template.update(
            objective='课堂最后约10分钟，自由尝试用SFLS制作第一版贪吃蛇。可以从描述需求、画图或查资料开始，不规定架构或算法；未完成也保留过程并提交。',
            analysis_prompt='你想做一个怎样的贪吃蛇？正在处理的关键问题或算法，你觉得可以怎样做？不确定也可以说明。',
            change_prompt='选一点先尝试，和SFLS一起运行、解释和修改。已有想法直接说，不必先画架构图或写需求文档，也不预设统一架构。',
            acceptance=['尝试启动自己的程序，记录能否运行',
                        '尝试方向控制、进食增长和碰撞结束，未实现如实写明',
                        '保留当前代码和对话，以便第2课继续修改'],
        )
    template['template_version'] = '2026-10-19.1'
    assert learning_context_for_template(template) is not None
    assert 'macro_route' not in frozen_template(template)
    assert hashlib.sha256(task_text(template).encode()).hexdigest() == expected_hash


def test_later_lessons_reuse_design_start_rule_without_changing_their_prompts():
    later = catalog()[4:]
    assert later[0]['analysis_prompt'] == '在原架构上标出目标管理与方向决策：点击改变哪份数据，自动决策接在哪个接口？'
    assert later[-1]['change_prompt'] == '先完成多目标功能，再选一种策略作单项改进；如何保持相同条件比较效果？'
    for template in later:
        assert '设计起点检查与补建' in task_text(template)
        assert template['analysis_prompt'] in task_text(template)
        assert template['change_prompt'] in task_text(template)


@pytest.mark.parametrize('platform', ['mac', 'windows'])
def test_all_current_course_packages_bind_context_to_frozen_worksheet(platform):
    for template in catalog():
        material = material_for(template)
        # Unrelated mutable labels must not determine the instructional approach.
        material.title = '任意标题'
        material.configuration['condition'] = 'ai_pbl' if template['condition'] == 'pdt' else 'pdt'
        files = package_files(material, platform)
        task = json.loads(files['sfls-task.json'])
        expected = {'lesson_id': template['lesson_id'], 'approach': 'experience' if template['lesson_id'] == 'C01'
                    else {'pdt': 'deconstruction', 'ai_pbl': 'requirements'}[template['condition']]}
        assert task['learning_context'] == task_contract(material)['learning_context'] == expected
        assert files['materials/TASK.md'] == task_text(material.configuration['worksheet']).encode()
        assert files['materials/本课任务单.md'] == files['materials/TASK.md']
        assert task['support']['mode'] == 'classroom'


@pytest.mark.parametrize('phase', ['pre', 'post'])
def test_assessment_contract_and_package_do_not_inject_learning_context(phase):
    material = material_for(catalog()[2], phase)
    assert 'learning_context' not in task_contract(material)
    files = package_files(material)
    task = json.loads(files['sfls-task.json'])
    assert 'learning_context' not in task
    assert task['support']['mode'] == 'assessment'
    assert 'materials/本课任务单.md' not in files


@pytest.mark.parametrize('version', ['2026-10-15.1', '2026-10-19.2', '2026-10-20.2', 'future', ''])
def test_unreviewed_template_versions_do_not_enable_new_context_or_task_flow(version):
    template = {**catalog()[2], 'template_version': version}
    assert learning_context_for_template(template) is None
    assert '设计起点检查与补建' not in task_text(template)
    if version:
        assert 'learning_context' not in task_contract(material_for(template))


@pytest.mark.parametrize('lesson_id', ['C00', 'C1', 'C001', 'C100', 'L03', 'C01\n'])
def test_learning_context_rejects_non_course_lesson_identifiers(lesson_id):
    assert learning_context_for_template({**catalog()[2], 'lesson_id': lesson_id}) is None


@pytest.mark.parametrize('lesson_id', ['C02', 'C09', 'C10', 'C99'])
def test_learning_context_accepts_reviewed_course_identifier_range(lesson_id):
    assert learning_context_for_template({**catalog()[2], 'lesson_id': lesson_id}) == {
        'lesson_id': lesson_id, 'approach': 'deconstruction'}


@pytest.mark.parametrize('teacher_addendum', ['', '\n教师补充：先保留当前失败结果，下课前上传未完成版本。\n'])
def test_old_frozen_material_retains_its_original_task_and_contract(teacher_addendum):
    # This literal is the original 2026-10-15.1 formatter output, never calculated
    # from the current catalog or formatter. It locks down an already published brief.
    frozen_brief = '''# 第2课 · 完整贪吃蛇

接着第1课作品，完成连续运行、进食增长与计分、碰撞结束和重新开始的贪吃蛇。

## 开始前，先说清楚

1. 参考课堂对不同框架的比较，画出或修订自己的功能架构：输入、方向、规则、状态和显示怎样联系？

2. 选一条从输入到画面变化的完整过程，标出本次要改哪个模块、保留什么以及数据如何传递。

用几句文字或一张小图表达即可；已有设计就引用，不用重写。先留下当前想法，再交给SFLS协助；来不及或不确定可以注明。

## 本课共同验收

- 连续移动、转向时窗口仍能响应
- 普通移动不增长，进食增长一格并计分；新食物不在蛇身上
- 碰撞后停止，重新开始可恢复初态；无空位时结束
- 解释普通移动与进食时尾部处理的区别，并实际检查

## 做完交什么

上传一个SFLS作品ZIP，包含当前代码、简短README和自动收集的对话/操作记录。未完成也能交，不补造测试或“原先的想法”。

README保留：怎么运行、做到什么、一个关键判断、至少一次检查的预期与实际、还有什么问题。已有图或需求说明直接引用，不再重复填一份表。

至少一次检查是最低记录要求，不等于通过全部验收。工具实测、本人观察和未验证分开写；预期如果在运行后补记，要注明是回顾。

设计有变化才更新图或文字。图不要求标准UML，两班都能选择画图或文字；不按图的数量、字数或AI回答长度评分。
'''
    legacy = {
        'lesson_id': 'C02', 'template_version': '2026-10-15.1', 'condition': 'pdt', 'title': '完整贪吃蛇',
        'objective': '接着第1课作品，完成连续运行、进食增长与计分、碰撞结束和重新开始的贪吃蛇。',
        'acceptance': ['连续移动、转向时窗口仍能响应', '普通移动不增长，进食增长一格并计分；新食物不在蛇身上',
                       '碰撞后停止，重新开始可恢复初态；无空位时结束', '解释普通移动与进食时尾部处理的区别，并实际检查'],
        'analysis_prompt': '参考课堂对不同框架的比较，画出或修订自己的功能架构：输入、方向、规则、状态和显示怎样联系？',
        'change_prompt': '选一条从输入到画面变化的完整过程，标出本次要改哪个模块、保留什么以及数据如何传递。',
    }
    assert task_text(legacy) == frozen_brief
    teacher_task = frozen_brief + teacher_addendum
    material = SimpleNamespace(id=uuid4(), title=legacy['title'], configuration={
        'phase': 'practice', 'project_id': 'snake-course', 'policy_version': POLICY_VERSION,
        'worksheet': frozen_template(legacy), 'task': teacher_task,
    })
    before = deepcopy(material.configuration)
    frozen_contract = task_contract(material)
    assert all(template['template_version'] == '2026-10-21.1' for template in catalog())
    files = package_files(material)
    assert files['materials/TASK.md'].decode() == teacher_task
    assert files['materials/本课任务单.md'].decode() == frozen_brief
    assert '设计起点检查与补建' not in frozen_brief
    assert 'learning_context' not in frozen_contract
    assert material.configuration == before

    # Already downloaded task contracts remain the comparison source after later configuration changes.
    download = SimpleNamespace(id='download', user_id='student', detail={'task_contract': deepcopy(frozen_contract)})
    reported_task = json.loads(files['sfls-task.json'])
    material.configuration['worksheet'] = frozen_template(catalog()[3])
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('manifest.json', json.dumps({'sfls': {'task': reported_task, 'policy_version': POLICY_VERSION}}))
    assert validate_submission_contract(output.getvalue(), material, download)['status'] == 'matched'


def test_new_context_is_part_of_the_frozen_download_contract():
    material = material_for(catalog()[2])
    frozen = task_contract(material)
    download = SimpleNamespace(id='download', user_id='student', detail={'task_contract': deepcopy(frozen)})
    reported = {**deepcopy(frozen), 'platform': {'user_id': 'student', 'material_id': str(material.id), 'download_id': 'download'}}
    reported['learning_context']['approach'] = 'requirements'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('manifest.json', json.dumps({'sfls': {'task': reported, 'policy_version': POLICY_VERSION}}))
    validation = validate_submission_contract(output.getvalue(), material, download)
    assert validation['status'] == 'mismatch'
    assert validation['differences'] == ['learning_context']
