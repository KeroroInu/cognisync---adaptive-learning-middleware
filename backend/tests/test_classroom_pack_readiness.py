"""Stage materials are symmetric; differences are two teaching prompts, not help policy."""
import hashlib
import io
import json
from types import SimpleNamespace
from uuid import uuid4
import zipfile

from app.services.lesson_pack import freeze
from app.services.sfls_package import make_sfls_package
from app.services.worksheet import catalog, context_files, public_template, task_text
from scripts.build_classroom_packs import build


def test_course_starts_at_one_without_relabeling_legacy_evidence():
    templates = catalog()
    assert [t['lesson_id'] for t in templates[::2]] == [f'C{n:02d}' for n in range(1, 6)]
    assert task_text(templates[0]).startswith('# 第1课')
    assert '## 开始使用' in task_text(templates[0])
    current = freeze('C01')
    assert '真实运行结果' in current['files']['materials/公共规则.md']
    assert current['starter_files'] == {}
    assert '启动与运行' in current['files']['materials/运行与接口.md']
    assert '每次按键移动一步' not in current['files']['materials/公共规则.md']
    assert '第3阶段每次按键' in freeze('L03')['files']['materials/公共规则.md']
    assert json.loads(current['files']['materials/samples.json'])['lesson_id'] == 'C01'
    assert freeze('C06') is None
    assert freeze('C04')['lesson_id'] != freeze('L08')['lesson_id']


def test_all_stage_packages_bind_student_and_keep_common_resources_identical():
    templates = catalog()
    for first, second in zip(templates[::2], templates[1::2]):
        assert first['lesson_id'] == second['lesson_id']
        assert first['rules'] == second['rules'] and first['acceptance'] == second['acceptance']
        assert first['objective'] == second['objective']
        assert (first['analysis_prompt'] == second['analysis_prompt']) == (first['lesson_id'] == 'C01')
        common_files = []
        for template in (first, second):
            material = SimpleNamespace(id=uuid4(), title=template['title'], configuration={
                'phase': 'practice', 'project_id': 'snake-course', 'task': task_text(template),
                'worksheet': template, 'lesson_pack': freeze(template['lesson_id']),
                'policy_version': 'sfls-scaffold/2-draft'})
            uid, did = uuid4(), uuid4()
            for platform in ('mac', 'windows'):
                data, provenance = make_sfls_package(material, uid, did, platform, None, None)
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    task = json.loads(archive.read('sfls-task.json'))
                    assert task['platform']['user_id'] == str(uid) and task['platform']['download_id'] == str(did)
                    assert task['provenance']['lesson_id'] == template['lesson_id'] == provenance['lesson_id']
                    brief = archive.read('materials/本课任务单.md').decode()
                    assert template['analysis_prompt'] in brief
                    if template['lesson_id'] == 'C01':
                        assert 'project/README.md' in brief and '让 SFLS 协助' in brief
                        assert '两班统一体验' not in brief and '不必先画' not in brief
                    else:
                        assert '不再重复填表' in brief and 'README由SFLS结合真实对话协助整理' in brief
                    assert template['teacher_review'] not in brief and template['common_exit'] not in brief
                    assert archive.read('project/main.py').startswith(b'#')
                    assert ('Start.command' if platform == 'mac' else 'Start.cmd') in archive.namelist()
                    common_files.append({n: archive.read(n) for n in ('materials/samples.json', 'materials/公共规则.md')})
        assert all(files == common_files[0] for files in common_files)


def test_no_second_blank_form_but_historical_records_preserved():
    context = {'template': public_template(catalog()[0]), 'current': None, 'plan': None}
    files = context_files(context)
    assert 'design/current/worksheet.json' in files
    assert 'design/current/worksheet.md' not in files
    context['current'] = {'worksheet_revision_id': str(uuid4()), 'answers': {'analysis_note': '本人的已有记录'}}
    assert '本人的已有记录' in context_files(context)['design/current/worksheet.md'].decode()


def test_teacher_archive_reproducible_and_not_student_submission():
    data = build()
    assert data == build()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['purpose'] == 'teacher_review_not_student_submission'
        for file in manifest['files']:
            assert hashlib.sha256(archive.read(file['path'])).hexdigest() == file['sha256']
        briefs = [n for n in archive.namelist() if n.endswith('/本课任务单.md')]
        assert len(briefs) == 10
        assert '解构班/第01课/本课任务单.md' in briefs
        assert '开发班/第05课/本课任务单.md' in briefs
        assert not any('/L03/' in name for name in archive.namelist())
        assert not any(n.endswith('sfls-task.json') for n in archive.namelist())
