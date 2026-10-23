"""Registration/correction regression: dedicated test DB, never production students."""
import asyncio
import hashlib
import io
import json
import zipfile
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, func

from app.models.sql import User, ProfileSnapshot, MaterialReceipt, ClassroomMaterial, AssessmentResponse
from tests.test_classroom import classroom_actors, start
from tests.test_assessments import draft, publish

pytestmark = pytest.mark.asyncio


def registration(**changes):
    return {"student_id": "G2026001234", "name": "测试学生", "gender": "female", "className": "解构班", "password": "test-only-password", "mode": "classroom", **changes}


async def create(client, **changes):
    result = await client.post('/api/auth/register', json=registration(**changes))
    assert result.status_code == 200, result.text
    data = result.json()
    return data, {"Authorization": "Bearer " + data['token']}


@pytest.mark.parametrize('school_class', ['高一（1）班', '高二（4）班', '高三（7）班'])
async def test_school_class_is_separate_from_experiment_group(client, admin_client, test_db, school_class):
    data, headers = await create(client, className=None, schoolClass=school_class)
    uid = UUID(data['user']['id'])
    assert data['user']['className'] is None
    assert data['user']['schoolClass'] == school_class
    assert data['user']['experimentGroup'] == 'unassigned'
    assert (await client.get('/api/auth/me', headers=headers)).json()['data']['user']['schoolClass'] == school_class
    async with test_db() as db:
        assert (await db.get(User, uid)).school_class == school_class
    listing = (await admin_client.get('/api/admin/users')).json()['data']['users']
    assert next(item for item in listing if item['id'] == str(uid))['school_class'] == school_class
    changed = await admin_client.patch(f'/api/admin/users/{uid}', json={'school_class': '高二（7）班', 'class_name': '开发班'})
    assert changed.status_code == 200
    async with test_db() as db:
        user = await db.get(User, uid)
        assert user.school_class == '高二（7）班' and user.class_name == '开发班' and user.experiment_group == 'ai_pbl'
    exported = await admin_client.get('/api/admin/export/research-package?include_graph=false')
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert '高二（7）班' in archive.read('users.jsonl').decode()


@pytest.mark.parametrize('invalid', ['高一（0）班', '高一（8）班', '高四（1）班', '解构班'])
async def test_reject_invalid_school_class(client, invalid):
    result = await client.post('/api/auth/register', json=registration(className=None, schoolClass=invalid))
    assert result.status_code == 422


@pytest.mark.parametrize('class_name,group', [('解构班', 'pdt'), ('开发班', 'ai_pbl'), ('体验组', 'experience')])
async def test_registration_assigns_class_and_login_identity(client, test_db, class_name, group):
    data, headers = await create(client, className=class_name, student_id=' g2026001234 ')
    assert data['user']['student_id'] == 'G2026001234'
    assert data['user']['className'] == class_name and data['user']['experimentGroup'] == group
    assert data['user']['gender'] == 'female'
    assert not data['user']['hasCompletedOnboarding']
    assert data['initialProfile'] is None
    assert 'password' not in str(data['user'])
    login = await client.post('/api/auth/login', json={'student_id': ' g2026001234 ', 'password': registration()['password']})
    assert login.status_code == 200 and login.json()['user']['id'] == data['user']['id']
    assert (await client.get('/api/auth/me', headers=headers)).status_code == 200
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(ProfileSnapshot)) == 0


async def test_correction_preserves_answers_originals_and_export(client, admin_client, test_db, classroom_actors):
    data, student_headers = await create(client)
    uid = UUID(data['user']['id'])
    item = await publish(admin_client, draft(class_name='解构班'))
    pending = (await client.get('/api/assessments/pending', headers=student_headers)).json()['data']
    assert pending['id'] == item['id']
    assert (await client.post(f"/api/assessments/{item['id']}/responses", headers=student_headers, json={'answers': {'q1': '2'}, 'started_at': pending['served_at']})).status_code == 200
    sid = (await start(client, classroom_actors, class_name='解构班'))['id']
    # Store an original ZIP and verify its actual bytes, not just a mocked receipt.
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('main.py', 'print("original student code")')
    original = buffer.getvalue()
    checksum = hashlib.sha256(original).hexdigest()
    async with test_db() as db:
        material = ClassroomMaterial(session_id=UUID(sid), created_by=classroom_actors['teacher_id'], title='身份修正测试', kind='pi')
        db.add(material)
        await db.flush()
        receipt = MaterialReceipt(material_id=material.id, user_id=uid, request_id=uuid4(), kind='upload', content=original, sha256=checksum, size=len(original))
        db.add(receipt)
        await db.commit()
        receipt_id = receipt.id
        old_hash = (await db.get(User, uid)).password_hash
    path = f'/api/admin/users/{uid}'
    # No learner may edit another student's identity or their own through admin API.
    # admin_client overrides authentication, so check real auth in a separate test below.
    changed = await admin_client.patch(path, json={'name': '更正姓名', 'student_id': ' g2026009999 ', 'gender': 'male', 'class_name': '开发班'})
    assert changed.status_code == 200, changed.text
    assert changed.json()['data']['id'] == str(uid)
    assert changed.json()['data']['experiment_group'] == 'ai_pbl'
    me = (await client.get('/api/auth/me', headers=student_headers)).json()['data']['user']
    assert me['id'] == str(uid) and me['name'] == '更正姓名' and me['gender'] == 'male'
    assert me['student_id'] == 'G2026009999' and me['className'] == '开发班'
    assert (await client.post('/api/auth/login', json={'student_id': 'G2026001234', 'password': registration()['password']})).status_code == 401
    assert (await client.post('/api/auth/login', json={'student_id': 'G2026009999', 'password': registration()['password']})).status_code == 200
    async with test_db() as db:
        user = await db.get(User, uid)
        assert user.password_hash == old_hash and user.auth_version == 0
        saved = await db.scalar(select(AssessmentResponse).where(AssessmentResponse.user_id == uid))
        assert saved.class_snapshot == '解构班' and saved.group_snapshot == 'pdt' and saved.answers['q1'] == '2'
        content = await db.scalar(select(MaterialReceipt.content).where(MaterialReceipt.id == receipt_id))
        assert content == original
    exported = await admin_client.get('/api/admin/export/research-package?include_graph=false&include_identity=true')
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert archive.testzip() is None
        users = [json.loads(line) for line in archive.read('users.jsonl').decode().splitlines()]
        row = next(row for row in users if row['id'] == str(uid))
        assert row['student_id'] == 'G2026009999' and row['gender'] == 'male'
        originals = [json.loads(line) for line in archive.read('original_files.jsonl').decode().splitlines()]
        entry = next(row for row in originals if row['source_id'] == str(receipt_id))
        assert entry['sha256'] == checksum
        assert archive.read(entry['archive_path']) == original


async def test_only_teacher_can_correct_identity(client, classroom_actors):
    data, student_headers = await create(client)
    path = '/api/admin/users/' + data['user']['id']
    assert (await client.patch(path, json={'name': '不允许'})).status_code == 401
    assert (await client.patch(path, json={'name': '不允许'}, headers=student_headers)).status_code == 403
    assert (await client.patch(path, json={'name': '老师更正'}, headers=classroom_actors['teacher'])).status_code == 200


async def test_duplicates_and_conflicts_are_atomic(client, admin_client, test_db):
    first, _ = await create(client)
    second, _ = await create(client, student_id='G2026005678')
    path = '/api/admin/users/' + first['user']['id']
    conflict = await admin_client.patch(path, json={'student_id': second['user']['student_id'], 'name': '不能写入', 'gender': 'male'})
    assert conflict.status_code == 409
    mismatch = await admin_client.patch(path, json={'class_name': '开发班', 'experiment_group': 'pdt'})
    assert mismatch.status_code == 422
    for invalid in ({'name': ' '}, {'student_id': ''}, {'student_id': None}, {'student_id': 'G2026 00'}, {'gender': 'invalid'}):
        assert (await admin_client.patch(path, json=invalid)).status_code == 422
    duplicate = await client.post('/api/auth/register', json=registration(name='不能覆盖', password='other-password'))
    assert duplicate.status_code == 409
    async with test_db() as db:
        user = await db.get(User, UUID(first['user']['id']))
        assert user.name == '测试学生' and user.gender == 'female' and user.class_name == '解构班'
    assert (await admin_client.patch(path, json={'gender': None})).status_code == 200


async def test_concurrent_duplicate_registration_creates_one_account(client, test_db):
    replies = await asyncio.gather(*(client.post('/api/auth/register', json=registration()) for _ in range(3)))
    assert sorted(reply.status_code for reply in replies) == [200, 409, 409]
    async with test_db() as db:
        assert await db.scalar(select(func.count()).select_from(User)) == 1


async def test_new_class_choice_validated_and_legacy_registration_retained(client):
    assert (await client.post('/api/auth/register', json=registration(className='讲授班'))).status_code == 422
    data, _ = await create(client, student_id='user1', className=None, gender=None)
    assert data['user']['student_id'] == 'user1' and data['user']['className'] is None
