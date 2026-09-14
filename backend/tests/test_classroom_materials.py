import io
import json
import zipfile
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.sql import MaterialReceipt, LessonPlan, PreparationRecord
from app.services.classroom_files import inspect_zip, safe_name
from app.services.research_package import build_package
from test_classroom import classroom_actors as actors_fixture, start, change_state

classroom_actors = actors_fixture
pytestmark = pytest.mark.asyncio
ADMIN = '/api/admin/classroom'


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        for name, content in files.items():
            z.writestr(name, content)
    return output.getvalue()


async def package(client, actors, sid):
    body = {'request_id': str(uuid4()), 'title': '独立创作', 'task': '制作一个小游戏', 'support': '短注释，先给两处填空', 'phase': 'pre'}
    response = await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=actors['teacher'], json=body)
    assert response.status_code == 200, response.text
    repeat = await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=actors['teacher'], json=body)
    assert repeat.json() == response.json()
    return response.json()['data']


async def test_material_flow_auth_binding_receipts_and_export(client, test_db, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    assert (await client.get(f'{ADMIN}/sessions/{sid}/materials', headers=a['first'])).status_code == 403
    item = await package(client, a, sid)
    assert (await client.get('/api/materials', headers=a['first'])).json()['data'][0]['id'] == item['id']
    assert (await client.get('/api/materials', headers=a['other'])).json()['data'] == []
    assert (await client.post(f"/api/materials/{item['id']}/download", headers=a['other'])).status_code == 404
    manifests = []
    for platform in ('mac', 'windows'):
        response = await client.post(f"/api/materials/{item['id']}/download?platform={platform}", headers=a['first'])
        assert response.status_code == 200, response.text
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            manifest = json.loads(z.read('manifest.json'))
            manifests.append(manifest)
            assert manifest['user_id'] == str(a['first_id'])
            assert ('Start.command' if platform == 'mac' else 'Start.cmd') in z.namelist()
            assert '先给两处填空' in z.read('AGENTS.md').decode()
            assert 'auth.json' not in z.namelist()
    data = archive({'manifest.json': json.dumps(manifests[0]), 'project/main.py': 'print(1)', 'evidence/sessions/session.jsonl': '{"type":"message"}\n'})
    request_id = uuid4()
    url = f"/api/materials/{item['id']}/submit?request_id={request_id}"
    assert (await client.post(url, headers=a['second'], content=data)).status_code == 422
    response = await client.post(url, headers=a['first'], content=data)
    assert response.status_code == 200, response.text
    assert (await client.post(url, headers=a['first'], content=data)).json() == response.json()
    rid = response.json()['data']['id']
    assert (await client.get(f'{ADMIN}/receipts/{rid}/file', headers=a['second'])).status_code == 403
    received = await client.get(f'{ADMIN}/receipts/{rid}/file', headers=a['teacher'])
    assert received.content == data
    async with test_db() as db:
        assert len((await db.scalars(select(MaterialReceipt).where(MaterialReceipt.kind == 'submission'))).all()) == 1
        result = await build_package(db, class_name='测试一班', include_graph=False)
        try:
            with zipfile.ZipFile(result) as z:
                assert z.read(f'originals/classroom_material_receipts/{rid}.bin') == data
                manifest = json.loads(z.read('manifest.json'))
                assert 'content' not in [c['name'] for c in manifest['tables']['classroom_material_receipts']['columns']]
        finally:
            result.close()
    await change_state(client, a, sid, 'end')
    assert (await client.post(url, headers=a['first'], content=data)).status_code == 403


async def test_file_upload_close_and_receipt_limit(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    url = f'{ADMIN}/sessions/{sid}/files?request_id={uuid4()}&filename=lesson.md'
    response = await client.post(url, headers=a['teacher'], content=b'# Lesson')
    assert response.status_code == 200, response.text
    assert (await client.post(url, headers=a['teacher'], content=b'# Lesson')).json() == response.json()
    assert (await client.post(url, headers=a['teacher'], content=b'changed')).status_code == 409
    mid = response.json()['data']['id']
    assert (await client.post(f'/api/materials/{mid}/download', headers=a['first'])).content == b'# Lesson'
    await client.post(f'{ADMIN}/materials/{mid}/close', headers=a['teacher'])
    assert (await client.post(f'/api/materials/{mid}/download', headers=a['first'])).status_code == 403


async def test_zip_rejects_paths_secrets_and_bad_manifest():
    for files in ({'../x': 'bad'}, {'x/auth.json': '{}'}, {'x.py': 'key="sk-12345678901234567890123456789"'}, {'x': 'x', 'manifest.json': '[]'}):
        with pytest.raises(HTTPException):
            inspect_zip(archive(files), {'schema': 'cognisync-local/1'})
    for name in ('../file', 'a\\b', '.env', 'x\nfoo'):
        with pytest.raises(HTTPException):
            safe_name(name)
    with pytest.raises(HTTPException):
        inspect_zip(b'not a zip')


async def test_lesson_evidence_roles_and_scope(client, test_db, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    async with test_db() as db:
        plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == UUID(sid)))
        plan.configuration = {'knowledge_points': ['列表'], 'tasks': {}}
        db.add(PreparationRecord(user_id=a['first_id'], session_id=UUID(sid), request_id=uuid4(), kind='chat', payload={'request': {'message': '列表是什么', 'code': 'a=[]'}, 'reply': '列表可以存数据'}))
        db.add(PreparationRecord(user_id=a['other_id'], request_id=uuid4(), kind='chat', payload={'request': {'message': '不属于本课'}}))
        await db.commit()
    url = f'{ADMIN}/sessions/{sid}/evidence'
    assert (await client.get(url, headers=a['first'])).status_code == 403
    data = (await client.get(url, headers=a['teacher'])).json()['data']
    assert data['total'] == 1
    assert data['items'][0]['parts'][0]['mentioned_targets'] == ['列表']
    assert data['items'][0]['parts'][2]['role'] == 'assistant'
    assert (await client.get(url + '?offset=50', headers=a['teacher'])).json()['data']['items'] == []


async def test_teacher_zip_assignment_submission_and_private_status(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    url = f'{ADMIN}/sessions/{sid}/files?request_id={uuid4()}&filename=homework.zip&accept_submissions=true'
    content = archive({'TASK.md': 'Make a game', 'main.py': '# Start here'})
    item = (await client.post(url, headers=a['teacher'], content=content)).json()['data']
    assert item['configuration']['accept_submissions'] is True
    assert (await client.post(url.replace('true', 'false'), headers=a['teacher'], content=content)).status_code == 409
    mid = item['id']
    work = archive({'main.py': 'print(1)', 'chat.jsonl': '{}'})
    submit = f'/api/materials/{mid}/submit?request_id={uuid4()}'
    assert (await client.post(submit, headers=a['first'], content=work)).status_code == 422
    assert (await client.post(f'/api/materials/{mid}/download', headers=a['first'])).status_code == 200
    assert (await client.post(submit, headers=a['other'], content=work)).status_code == 404
    response = await client.post(submit, headers=a['first'], content=work)
    assert response.status_code == 200, response.text
    assert response.json()['data']['detail']['source'] == 'unverified_teacher_package_upload'
    assert (await client.post(submit, headers=a['first'], content=work)).json() == response.json()
    own = (await client.get('/api/materials', headers=a['first'])).json()['data'][0]['submission']
    peer = (await client.get('/api/materials', headers=a['second'])).json()['data'][0]['submission']
    assert own['count'] == 1 and own['last_submitted_at']
    assert peer == {'count': 0, 'last_submitted_at': None}
    assert (await client.post(f'/api/materials/{mid}/submit?request_id={uuid4()}', headers=a['first'], content=archive({'../bad.py': 'bad'}))).status_code == 422
    for _ in range(2):
        assert (await client.post(f'/api/materials/{mid}/submit?request_id={uuid4()}', headers=a['first'], content=work)).status_code == 200
    assert (await client.post(f'/api/materials/{mid}/submit?request_id={uuid4()}', headers=a['first'], content=work)).status_code == 409
    # An uncertain request can still retrieve its accepted receipt at the limit.
    assert (await client.post(submit, headers=a['first'], content=work)).status_code == 200
    await client.post(f'{ADMIN}/materials/{mid}/close', headers=a['teacher'])
    assert (await client.post(submit, headers=a['first'], content=work)).status_code == 403


async def test_read_only_files_cannot_receive_work(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    url = f'{ADMIN}/sessions/{sid}/files?request_id={uuid4()}&filename=lesson.md'
    assert (await client.post(url + '&accept_submissions=true', headers=a['teacher'], content=b'read')).status_code == 422
    item = (await client.post(url, headers=a['teacher'], content=b'read')).json()['data']
    assert (await client.post(f"/api/materials/{item['id']}/submit?request_id={uuid4()}", headers=a['first'], content=archive({'main.py': 'pass'}))).status_code == 422
