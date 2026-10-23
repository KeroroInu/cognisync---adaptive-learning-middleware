"""Teacher research archives are read-only, lesson-bound, and never latest-only."""
import hashlib
import io
import json
import uuid
import zipfile

import pytest

from app.models.sql import ClassroomMaterial, ClassroomSession, MaterialReceipt, User


def rows(archive, path):
    return [json.loads(line) for line in archive.read(path).splitlines()]


def checked(response):
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert archive.testzip() is None
    manifest = json.loads(archive.read('manifest.json'))
    for entry in manifest['files']:
        content = archive.read(entry['path'])
        assert len(content) == entry['bytes']
        assert hashlib.sha256(content).hexdigest() == entry['sha256']
    assert len(archive.namelist()) == len(set(archive.namelist()))
    return archive, manifest


@pytest.fixture
async def lesson_data(test_db):
    def content(version):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('project/main.py', f'print({version})')
            if version != 'generic':
                archive.writestr('manifest.json', json.dumps({'sfls': {}}))
                archive.writestr('evidence/events.jsonl', json.dumps({'type': 'message', 'run_id': 'same', 'sequence': 1}) + '\n')
        return stream.getvalue()

    async with test_db() as db:
        teacher = User(student_id='lesson-teacher', name='教师', role='admin')
        a = User(student_id='G202610001', name='甲同学', role='student', class_name='解构班', experiment_group='pdt')
        b = User(student_id='G202610002', name='乙同学', role='student', class_name='开发班', experiment_group='ai_pbl')
        absent = User(student_id='G202610003', name='未提交同学', role='student', class_name='开发班', experiment_group='ai_pbl')
        db.add_all([teacher, a, b, absent])
        await db.flush()
        materials, receipts, originals = [], [], {}
        for user in (a, b):
            session = ClassroomSession(class_name=user.class_name, title='跨课工作区', created_by=teacher.id)
            db.add(session)
            await db.flush()
            for lesson in ('C01', 'C02'):
                material = ClassroomMaterial(session_id=session.id, created_by=teacher.id, title='同名任务', kind='sfls',
                    configuration={'project_id': 'snake', 'worksheet': {'lesson_id': lesson}}, filename='task.zip')
                db.add(material)
                await db.flush()
                materials.append(material)
                db.add(MaterialReceipt(user_id=user.id, material_id=material.id, request_id=uuid.uuid4(), kind='download',
                    size=123, detail={'class_name': user.class_name, 'group': user.experiment_group}))
                for version in (('1', '2') if user is a and lesson == 'C01' else ('generic',)):
                    data = content(version)
                    receipt = MaterialReceipt(user_id=user.id, material_id=material.id, request_id=uuid.uuid4(), kind='submission',
                        content=data, size=len(data), sha256=hashlib.sha256(data).hexdigest(),
                        detail={'class_name': '旧解构班' if user is a else user.class_name, 'group': user.experiment_group})
                    db.add(receipt)
                    await db.flush()
                    receipts.append(receipt)
                    originals[str(receipt.id)] = data
        await db.commit()
        return {'users': [str(a.id), str(b.id), str(absent.id)], 'absent': str(absent.id), 'teacher': str(teacher.id),
                'materials': [str(material.id) for material in materials], 'originals': originals}


@pytest.mark.asyncio
async def test_per_lesson_keeps_both_classes_every_version_shared_context_and_missing_students(admin_client, lesson_data):
    catalog_response = await admin_client.get('/api/admin/export/research-lessons')
    assert catalog_response.status_code == 200
    lessons = catalog_response.json()['data']['lessons']
    assert len(lessons) == 2
    first = next(item for item in lessons if 'C01' in item['key'])
    assert first['materials'] == 2 and first['submissions'] == 3
    archive, manifest = checked(await admin_client.get('/api/admin/export/research-package',
        params={'lesson_key': first['key'], 'include_graph': 'false'}))
    assert manifest['filters']['lesson_key'] == first['key']
    materials = rows(archive, 'classroom_materials.jsonl')
    assert len(materials) == 2 and {row['configuration']['worksheet']['lesson_id'] for row in materials} == {'C01'}
    receipts = rows(archive, 'classroom_material_receipts.jsonl')
    assert len(receipts) == 5
    originals = rows(archive, 'original_files.jsonl')
    assert len(originals) == 3 and manifest['originals']['records'] == 3
    for entry in originals:
        assert entry['archive_path'].endswith('.zip')
        assert archive.read(entry['archive_path']) == lesson_data['originals'][entry['source_id']]
    assert any('/解构班/' in entry['archive_path'] for entry in originals)
    assert any('开发班' in entry['archive_path'] for entry in originals)
    assert any(row['record_class'] == '旧解构班' and row['current_class'] == '解构班'
               for row in rows(archive, '索引/提交版本.jsonl'))
    assert len(rows(archive, '公共资料/完整发布材料.jsonl')) == 4
    assert {row['id'] for row in rows(archive, 'users.jsonl') if row['role'] == 'student'} == set(lesson_data['users'])
    assert '归档说明.md' in archive.namelist()
    assert len(rows(archive, '索引/SFLS覆盖.jsonl')) == 3
    assert any(row['index_status'] == 'no_indexable_sfls_logs' for row in rows(archive, '索引/SFLS覆盖.jsonl'))
    person_paths = [name for name in archive.namelist() if name.endswith('/平台记录.jsonl')]
    assert len(person_paths) == 3
    assert all('G20261000' not in name and '同学' not in name for name in archive.namelist())
    absent = next(name for name in person_paths if lesson_data['absent'] in name)
    assert {row['source_table'] for row in rows(archive, absent)} == {'users'}


@pytest.mark.asyncio
async def test_lesson_class_filters_identity_and_original_opt_out(admin_client, lesson_data):
    response = await admin_client.get('/api/admin/export/research-lessons', params={'class_name': '解构班'})
    first = next(item for item in response.json()['data']['lessons'] if 'C01' in item['key'])
    assert first['materials'] == 1 and first['submissions'] == 2
    archive, _ = checked(await admin_client.get('/api/admin/export/research-package', params={
        'class_name': '解构班', 'lesson_key': first['key'], 'include_originals': 'false', 'include_graph': 'false', 'include_identity': 'true'}))
    assert len(rows(archive, 'classroom_material_receipts.jsonl')) == 3
    assert all(row['archive_path'] is None for row in rows(archive, 'original_files.jsonl'))
    assert not any(name.endswith('.zip') for name in archive.namelist())
    assert any('G202610001' in name and '甲同学' in name for name in archive.namelist())
    assert {row['id'] for row in rows(archive, 'users.jsonl') if row['role'] == 'student'} == {lesson_data['users'][0]}


@pytest.mark.asyncio
async def test_unknown_lesson_is_visible_error_not_silent_full_export(admin_client, lesson_data):
    response = await admin_client.get('/api/admin/export/research-package', params={'lesson_key': 'lesson:missing:C99'})
    assert response.status_code == 422
    empty = await admin_client.get('/api/admin/export/research-lessons', params={'class_name': '不存在'})
    assert empty.status_code == 200 and empty.json()['data']['lessons'] == []


@pytest.mark.asyncio
async def test_lesson_catalog_requires_teacher_auth(client):
    assert (await client.get('/api/admin/export/research-lessons')).status_code in (401, 403)


@pytest.mark.asyncio
async def test_other_class_review_actor_cannot_expand_cohort(admin_client, test_db, lesson_data):
    from app.models.sql import ProjectReviewRound, ProjectReviewResponse, ProjectReviewEvent, ResearchTask
    async with test_db() as db:
        task = ResearchTask(title='回顾', code_content='')
        review = ProjectReviewRound(created_by=uuid.UUID(lesson_data['teacher']), title='回顾', template={}, template_hash='hash', session_ids=[])
        db.add_all([task, review])
        await db.flush()
        material = await db.get(ClassroomMaterial, uuid.UUID(lesson_data['materials'][2]))
        response = ProjectReviewResponse(user_id=uuid.UUID(lesson_data['users'][1]), round_id=review.id,
            session_id=material.session_id, task_id=task.id, class_snapshot='开发班', group_snapshot='ai_pbl')
        db.add(response)
        await db.flush()
        db.add(ProjectReviewEvent(user_id=response.user_id, actor_id=response.user_id, response_id=response.id,
            request_id=uuid.uuid4(), kind='student_answer', payload={}))
        await db.commit()
    archive, _ = checked(await admin_client.get('/api/admin/export/research-package',
        params={'class_name': '解构班', 'include_graph': 'false'}))
    assert {row['id'] for row in rows(archive, 'users.jsonl') if row['role'] == 'student'} == {lesson_data['users'][0]}
    assert not any(lesson_data['users'][1] in name for name in archive.namelist())


@pytest.mark.asyncio
async def test_metadata_budget_fails_before_unbounded_catalog_or_archive(admin_client, lesson_data, monkeypatch):
    from app.services import research_package
    monkeypatch.setattr(research_package, 'MAX_LAYOUT_BYTES', 10)
    for path in ('research-lessons', 'research-package'):
        response = await admin_client.get('/api/admin/export/' + path)
        assert response.status_code == 413 and '未截断' in response.text


@pytest.mark.asyncio
async def test_roster_product_is_bounded_before_index_materialization(admin_client, lesson_data, monkeypatch):
    from app.services import research_package
    monkeypatch.setattr(research_package, 'MAX_ROSTER_ROWS', 1)
    response = await admin_client.get('/api/admin/export/research-package', params={'include_graph': 'false'})
    assert response.status_code == 413 and '课次学生索引' in response.text
