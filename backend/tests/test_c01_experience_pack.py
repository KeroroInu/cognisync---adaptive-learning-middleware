"""Common C01 experience and compatible, non-secret hidden teaching reference."""
import io
from types import SimpleNamespace
from uuid import uuid4
import zipfile

from app.services.lesson_pack import freeze
from app.services.sfls_package import make_sfls_package, task_contract
from app.services.worksheet import catalog, task_text, public_template, frozen_template

GUIDE = 'materials/00-teacher-guide.md'


def assembled(template, platform='windows', phase='practice'):
    material = SimpleNamespace(id=uuid4(), title=template['title'], configuration={
        'phase': phase, 'project_id': 'snake-course', 'task': task_text(template),
        'worksheet': template, 'lesson_pack': freeze(template['lesson_id']),
    })
    data, _ = make_sfls_package(material, uuid4(), uuid4(), platform, None, None)
    return zipfile.ZipFile(io.BytesIO(data))


def test_two_classes_share_public_task_and_exact_hidden_reference():
    first, second = catalog()[:2]
    assert task_text(first) == task_text(second)
    packs = [assembled(t) for t in (first, second)]
    for name in ('materials/TASK.md', 'materials/本课任务单.md', GUIDE):
        assert packs[0].read(name) == packs[1].read(name)
    brief = packs[0].read('materials/TASK.md').decode()
    assert '## 本课目标' in brief and '## 基本功能' in brief
    assert '先尝试写几行关键代码' in brief and '解释并帮助完成' in brief
    assert '## 开始使用' in brief and '## 结束回顾' in brief and '## 提交作品' in brief
    assert '再输入一次 `/submit`' in brief and '服务器已确认收到，回执已保存在 submissions' in brief
    assert '/repack' in brief and '上传压缩包，不上传整个文件夹' in brief
    for hidden in ('两班', '架构图', '需求文档', 'L1', '四级', '支架', '闸门', '设计起点检查与补建'):
        assert hidden not in brief
        for name in ('materials/运行与接口.md', 'materials/作品记录.md', 'materials/公共规则.md', 'materials/公开测试.md'):
            assert hidden not in packs[0].read(name).decode(), (hidden, name)
    guide = packs[0].read(GUIDE).decode()
    assert '等待回应' in guide and '自然语言思路不等于代码试写' in guide
    assert all(level in guide for level in ('L1', 'L2', 'L3', 'L4'))
    assert '不设开发或提交闸门' in guide and '不能当作理解证据' in guide
    assert '实际代码3—6行' in guide and '不临时改考' in guide


def test_guide_is_sfls_compatible_and_small_enough_to_inject():
    # Existing SFLS collect() skips dot-prefixed path segments, not DOS flags.
    for template in catalog():
        with assembled(template) as pack:
            assert all(not part.startswith('.') for part in GUIDE.split('/'))
            assert pack.getinfo(GUIDE).external_attr & 0x02
            assert len(pack.read(GUIDE)) < 6500
            assert len(pack.read('materials/TASK.md')) + len(pack.read(GUIDE)) < 16000
            assert b'attrib +h "materials\\00-teacher-guide.md"' in pack.read('Start.cmd')
            assert 'task-access' not in pack.read(GUIDE).decode()
    with assembled(catalog()[0], 'mac') as pack:
        assert b'chflags hidden "materials/00-teacher-guide.md"' in pack.read('Start.command')


def test_old_snapshots_and_assessments_do_not_gain_new_teaching_reference():
    template = catalog()[0]
    with assembled(template, phase='post') as pack:
        assert GUIDE not in pack.namelist()
    old = {key: value for key, value in template.items() if key != 'student_brief'}
    old['template_version'] = '2026-10-20.1'
    old_text = task_text(old)
    assert '## 与SFLS一起推进' in old_text
    assert '再次 /submit' not in old_text
    assert GUIDE not in freeze('L03')['files']


def test_current_brief_keeps_teacher_customization():
    template = dict(catalog()[0], objective='自定义共同目标',
                    analysis_prompt='自定义想法提示', change_prompt='自定义推进提示')
    brief = task_text(template)
    assert all(value in brief for value in ('自定义共同目标', '自定义想法提示', '自定义推进提示'))


def test_student_copy_is_opt_in_and_does_not_change_frozen_task_contract():
    current = catalog()[0]
    historical = {key: value for key, value in current.items() if key != 'student_brief'}
    assert '两班统一体验' in task_text(historical)
    assert '两班统一体验' not in task_text(current)
    assert 'macro_route' not in public_template(current)
    assert 'macro_route' in public_template(historical)
    assert frozen_template(current)['template_hash'] != frozen_template(historical)['template_hash']
    material = SimpleNamespace(id=uuid4(), configuration={
        'phase': 'practice', 'project_id': 'snake-course', 'worksheet': historical,
        'policy_version': 'sfls-scaffold/2-draft', 'task': task_text(historical)})
    original = task_contract(material)
    material.configuration.update(worksheet=current, task=task_text(current))
    assert task_contract(material) == original
