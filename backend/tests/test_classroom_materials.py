import io
import json
import zipfile
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.sql import MaterialReceipt, LessonPlan, PreparationRecord, ClassroomMaterial
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


async def test_only_teacher_opened_task_is_visible_and_records_survive(client, test_db, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    first = await package(client, a, sid)
    downloaded = await client.post(f'/api/materials/{first["id"]}/download', headers=a['first'])
    assert downloaded.status_code == 200
    second = await package(client, a, sid)
    async def visible():
        return [row['id'] for row in (await client.get('/api/materials', headers=a['first'])).json()['data']]
    assert await visible() == [second['id']]
    assert (await client.post(f'/api/materials/{first["id"]}/download', headers=a['first'])).status_code == 403
    assert (await client.post(f'{ADMIN}/materials/{first["id"]}/open', headers=a['first'])).status_code == 403
    for _ in range(2):
        assert (await client.post(f'{ADMIN}/materials/{first["id"]}/open', headers=a['teacher'])).status_code == 200
        assert await visible() == [first['id']]
    rows = (await client.get(f'{ADMIN}/sessions/{sid}/materials', headers=a['teacher'])).json()['data']
    assert [row['id'] for row in rows if row['student_visible']] == [first['id']]
    receipt = (await client.get(f'{ADMIN}/materials/{first["id"]}/receipts', headers=a['teacher'])).json()['data']
    assert receipt['total'] == 1
    assert receipt['submission_count'] == 0 and receipt['download_count'] == 1
    first_row = next(row for row in rows if row['id'] == first['id'])
    second_row = next(row for row in rows if row['id'] == second['id'])
    assert (first_row['submission_count'], first_row['download_count']) == (0, 1)
    assert (second_row['submission_count'], second_row['download_count']) == (0, 0)
    assert (await client.get('/api/materials', headers=a['other'])).json()['data'] == []
    # Legacy courses with several open packages require an explicit selection.
    async with test_db() as db:
        item = await db.get(ClassroomMaterial, UUID(second['id']))
        item.closed_at = None
        await db.commit()
    assert await visible() == []
    assert (await client.post(f'/api/materials/{first["id"]}/download', headers=a['first'])).status_code == 403
    await client.post(f'{ADMIN}/materials/{second["id"]}/open', headers=a['teacher'])
    assert await visible() == [second['id']]
    await client.post(f'{ADMIN}/materials/{second["id"]}/close', headers=a['teacher'])
    assert await visible() == []
    await change_state(client, a, sid, 'end')
    assert (await client.post(f'{ADMIN}/materials/{first["id"]}/open', headers=a['teacher'])).status_code == 200


async def test_task_switch_keeps_reading_materials_and_serializes_open(client, classroom_actors):
    import asyncio
    a = classroom_actors
    sid = (await start(client, a))['id']
    first = await package(client, a, sid)
    second = await package(client, a, sid)
    ref = str(uuid4())
    assert (await client.post(f'{ADMIN}/sessions/{sid}/files?request_id={ref}&filename=guide.md', headers=a['teacher'], content=b'guide')).status_code == 200
    results = await asyncio.gather(*[client.post(f'{ADMIN}/materials/{row["id"]}/open', headers=a['teacher']) for row in (first, second)])
    assert all(result.status_code == 200 for result in results)
    visible = (await client.get('/api/materials', headers=a['first'])).json()['data']
    assert len(visible) == 2
    assert visible[0]['kind'] == 'pi' and visible[1]['id'] == ref


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
    # Repeated network requests return the same receipt, not an extra "份".
    received_counts = (await client.get(f'{ADMIN}/materials/{item["id"]}/receipts', headers=a['teacher'])).json()['data']
    assert (received_counts['total'], received_counts['submission_count'], received_counts['download_count']) == (3, 1, 2)
    materials = (await client.get(f'{ADMIN}/sessions/{sid}/materials', headers=a['teacher'])).json()['data']
    assert (materials[0]['submission_count'], materials[0]['download_count']) == (1, 2)
    users = (await client.get('/api/admin/users', headers=a['teacher'])).json()['data']['users']
    by_id = {row['id']: row for row in users}
    first_student, second_student = by_id[str(a['first_id'])], by_id[str(a['second_id'])]
    assert (first_student['submission_count'], first_student['download_count']) == (1, 2)
    assert datetime.fromisoformat(first_student['last_submitted_at']) == datetime.fromisoformat(response.json()['data']['created_at'])
    assert (second_student['submission_count'], second_student['download_count'], second_student['last_submitted_at']) == (0, 0, None)
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
    await client.post(f'{ADMIN}/materials/{item["id"]}/close', headers=a['teacher'])
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
    process = (await client.get(url + '?source=process', headers=a['teacher'])).json()['data']
    assert process['total'] == 1
    assert process['items'][0]['source'] == 'preparation'
    assert (await client.get(url + f'?source=process&user_id={a["other_id"]}', headers=a['teacher'])).json()['data']['items'] == []
    assert (await client.get(url + '?source=process', headers=a['first'])).status_code == 403


async def test_teacher_zip_assignment_submission_and_private_status(client, test_db, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    url = f'{ADMIN}/sessions/{sid}/files?request_id={uuid4()}&filename=homework.zip&accept_submissions=true'
    content = archive({'TASK.md': 'Make a game', 'main.py': '# Start here'})
    item = (await client.post(url, headers=a['teacher'], content=content)).json()['data']
    assert item['max_submissions'] == 20
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
    # Every accepted stage is retained, rather than only the previous three submissions.
    for version in range(2, 21):
        updated = archive({'main.py': f'print({version})'})
        assert (await client.post(f'/api/materials/{mid}/submit?request_id={uuid4()}', headers=a['first'], content=updated)).status_code == 200
    assert (await client.post(f'/api/materials/{mid}/submit?request_id={uuid4()}', headers=a['first'], content=work)).status_code == 409
    async with test_db() as db:
        receipts = (await db.scalars(select(MaterialReceipt).where(MaterialReceipt.material_id == UUID(mid), MaterialReceipt.kind == 'submission'))).all()
        assert len(receipts) == 20 and len({row.sha256 for row in receipts}) == 20
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
