"""Generic experience tasks stay separate from the frozen snake curriculum."""
import io
import json
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest

from app.api.endpoints.materials import PackageInput, material_row, package_configuration
from app.models.sql import User
from app.services.sfls_package import make_sfls_package
from test_classroom import classroom_actors as actors_fixture, start
from test_sfls_materials import unpack, work_archive

classroom_actors = actors_fixture


def config(**extra):
    return package_configuration(PackageInput(
        request_id=uuid4(), title='我的课堂小助手', runtime='sfls',
        task='制作一个终端运行的课堂抽签小工具，能添加姓名、抽取并查看已抽记录。',
        project_id='experience-classroom-helper',
        curriculum='列表保存姓名，随机抽取一个下标。',
        **extra))


@pytest.mark.parametrize('platform', ['mac', 'windows'])
def test_generic_package_has_no_snake_assets_and_freezes_optional_guide(platform):
    configuration = config(agent_guidance='先听学生描述抽取规则；关键代码先让学生试写，不会则解释并补好。')
    item = SimpleNamespace(id=uuid4(), title='我的课堂小助手', configuration=configuration)
    blob, _ = make_sfls_package(item, uuid4(), uuid4(), platform, None, None)
    with zipfile.ZipFile(io.BytesIO(blob)) as pack:
        task = json.loads(pack.read('sfls-task.json'))
        assert task['project_id'] == 'experience-classroom-helper'
        assert task['support']['mode'] == 'classroom'
        assert 'learning_context' not in task
        assert '贪吃蛇' not in pack.read('materials/TASK.md').decode()
        assert pack.read('project/main.py') == b'# Start your program here.\n'
        assert not any('snake' in name or name == 'materials/environment.json' for name in pack.namelist())
        guide = pack.read('materials/00-teacher-guide.md').decode()
        assert configuration['agent_guidance'] in guide
        assert pack.getinfo('materials/00-teacher-guide.md').external_attr & 0x02
        assert 'materials/00-teacher-guide.md' in pack.read('Start.command' if platform == 'mac' else 'Start.cmd').decode().replace('\\', '/')
        assert '算法与代码实现' in pack.read('project/README.md').decode()


def test_empty_optional_guide_keeps_legacy_configuration_shape():
    configuration = config()
    assert 'agent_guidance' not in configuration
    assert 'worksheet' not in configuration and 'lesson_pack' not in configuration


def test_teacher_note_preserves_frozen_course_guide():
    configuration = config(agent_guidance='额外提示')
    configuration['lesson_pack'] = {'version': 'frozen-test', 'starter_files': {},
        'files': {'materials/00-teacher-guide.md': '原有冻结教学参考'}}
    item = SimpleNamespace(id=uuid4(), title='课堂项目', configuration=configuration)
    blob, _ = make_sfls_package(item, uuid4(), uuid4(), 'mac', None, None)
    with zipfile.ZipFile(io.BytesIO(blob)) as pack:
        guide = pack.read('materials/00-teacher-guide.md').decode()
        assert guide.startswith('原有冻结教学参考') and guide.endswith('额外提示\n')


def test_student_material_omits_teacher_only_guidance_without_mutating_snapshot():
    configuration = config(agent_guidance='教师内部引导')
    item = SimpleNamespace(id=uuid4(), title='体验项目', kind='sfls', configuration=configuration,
        filename='template.zip', size=0, created_at=None, closed_at=None)
    assert material_row(item, student=True)['configuration'].get('agent_guidance') is None
    assert material_row(item)['configuration']['agent_guidance'] == '教师内部引导'
    assert item.configuration['agent_guidance'] == '教师内部引导'


@pytest.mark.asyncio
async def test_experience_task_download_submit_and_group_isolation(client, test_db, classroom_actors):
    a = classroom_actors
    async with test_db() as db:
        for key in ('first_id', 'second_id'):
            student = await db.get(User, a[key])
            student.class_name = '体验组'
            student.experiment_group = 'experience'
        await db.commit()
    sid = (await start(client, a, class_name='体验组'))['id']
    body = {'request_id': str(uuid4()), 'title': '课堂抽签工具', 'runtime': 'sfls',
        'project_id': 'experience-draw-lots', 'task': '添加名单、抽取一名、展示已抽记录。',
        'agent_guidance': '用一个简短问题邀请学生先说明抽签规则。'}
    published = await client.post(f'/api/admin/classroom/sessions/{sid}/packages', headers=a['teacher'], json=body)
    assert published.status_code == 200, published.text
    assert (await client.post(f'/api/admin/classroom/sessions/{sid}/packages', headers=a['teacher'], json=body)).json() == published.json()
    mid = published.json()['data']['id']
    listed = (await client.get('/api/materials', headers=a['first'])).json()['data']
    assert len(listed) == 1 and listed[0]['id'] == mid
    assert 'agent_guidance' not in listed[0]['configuration']
    assert (await client.get('/api/materials', headers=a['other'])).json()['data'] == []
    assert (await client.post(f'/api/materials/{mid}/download', headers=a['other'])).status_code == 404
    for platform in ('mac', 'windows'):
        files = unpack(await client.post(f'/api/materials/{mid}/download?platform={platform}', headers=a['first']))
        task = json.loads(files['sfls-task.json'])
        assert task['title'] == body['title'] and task['project_id'] == body['project_id']
        assert task['platform']['user_id'] == str(a['first_id'])
        assert '00-teacher-guide.md' in ' '.join(files)
    original = work_archive(task, code='names = ["甲", "乙"]', readme='# 课堂抽签工具\n\n用列表保存姓名。')
    url = f'/api/materials/{mid}/submit?request_id={uuid4()}'
    received = await client.post(url, headers=a['first'], content=original)
    assert received.status_code == 200, received.text
    assert received.json()['data']['detail']['task_validation']['status'] == 'matched'
    rid = received.json()['data']['id']
    assert (await client.get(f'/api/admin/classroom/receipts/{rid}/file', headers=a['teacher'])).content == original
    participation = (await client.get(f'/api/admin/classroom/materials/{mid}/participation', headers=a['teacher'])).json()['data']
    assert participation['summary']['eligible_user_count'] == 2
    assert participation['summary']['submission_user_count'] == 1
    assert {row['user_id'] for row in participation['items']} == {str(a['first_id']), str(a['second_id'])}


@pytest.mark.asyncio
async def test_experience_rejects_experimental_course_template(client, test_db, classroom_actors):
    from app.services.worksheet import catalog
    a = classroom_actors
    sid = (await start(client, a, class_name='体验组'))['id']
    template = {key: value for key, value in catalog()[0].items() if key != 'template_hash'}
    denied = await client.post(f'/api/admin/classroom/sessions/{sid}/packages', headers=a['teacher'],
        json={'request_id': str(uuid4()), 'title': '混用实验模板', 'task': '任意任务', 'runtime': 'sfls', 'worksheet': template})
    assert denied.status_code == 422
    listed = await client.get(f'/api/admin/classroom/sessions/{sid}/materials', headers=a['teacher'])
    assert listed.json()['data'] == []

