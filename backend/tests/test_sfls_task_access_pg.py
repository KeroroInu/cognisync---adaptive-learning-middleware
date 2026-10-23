"""End-to-end capability storage/export checks; dedicated *_test PostgreSQL only."""
import json
from uuid import UUID, uuid4

import pytest

from app.models.sql import MaterialReceipt, User
from test_classroom import classroom_actors as actors_fixture, start
from test_sfls_materials import publish, unpack, work_archive

classroom_actors = actors_fixture
pytestmark = pytest.mark.asyncio


async def test_task_capability_round_trip_retains_research_and_never_exports_authorization(client, test_db, classroom_actors, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'PUBLIC_BASE_URL', 'https://classroom.example')
    a = classroom_actors
    session_id = (await start(client, a))['id']
    item = await publish(client, a, session_id)
    files = unpack(await client.post(f'/api/materials/{item["id"]}/download?platform=windows', headers=a['first']))
    task = json.loads(files['sfls-task.json'])
    credential = json.loads(files['.sfls/task-access.json'])
    prefix = f'/api/materials/{item["id"]}/downloads/{credential["download_id"]}'
    headers = {'X-SFLS-Task-Token': credential['token']}
    identity = await client.get(prefix+'/access', headers=headers)
    assert identity.status_code == 200, identity.text
    assert identity.json()['data']['user']['id'] == str(a['first_id'])
    assert (await client.get('/api/auth/me', headers={'Authorization': f'Bearer {credential["token"]}'})).status_code == 401
    data = work_archive(task, code='snake = [(1, 1)]', readme='我的蛇身用列表记录坐标。')
    url = prefix+f'/submit?request_id={uuid4()}'
    response = await client.post(url, headers=headers, content=data)
    assert response.status_code == 200, response.text
    assert (await client.post(url, headers=headers, content=data)).json() == response.json()
    assert response.json()['data']['detail']['task_validation']['status'] == 'matched'
    async with test_db() as db:
        receipt = await db.get(MaterialReceipt, UUID(credential['download_id']))
        digest = receipt.detail['task_access']['sha256']
        assert credential['token'] not in json.dumps(receipt.detail)
    teacher_rows = (await client.get(f'/api/admin/classroom/materials/{item["id"]}/receipts', headers=a['teacher'])).json()['data']['items']
    assert all('task_access' not in row['detail'] for row in teacher_rows)
    exported = unpack(await client.get('/api/admin/export/research-package?include_graph=false', headers=a['teacher']))
    assert all(credential['token'].encode() not in value and digest.encode() not in value for value in exported.values())
    raw = [json.loads(line) for line in exported['classroom_material_receipts.jsonl'].splitlines()]
    assert all('task_access' not in row['detail'] for row in raw)
    assert exported[f'originals/classroom_material_receipts/{response.json()["data"]["id"]}.bin'] == data
    following = await publish(client, a, session_id)
    inherited = unpack(await client.post(f'/api/materials/{following["id"]}/download', headers=a['first']))
    next_credential = json.loads(inherited['.sfls/task-access.json'])
    assert inherited['project/main.py'] == b'snake = [(1, 1)]'
    assert next_credential['token'] != credential['token']
    assert all(credential['token'].encode() not in value for value in inherited.values())
    next_prefix = f'/api/materials/{following["id"]}/downloads/{next_credential["download_id"]}'
    assert (await client.get(next_prefix+'/access', headers=headers)).status_code == 401
    # Closing collection leaves local identity usable but rejects server writes.
    assert (await client.get(prefix+'/access', headers=headers)).status_code == 200
    assert (await client.post(url, headers=headers, content=data)).status_code == 403
    async with test_db() as db:
        user = await db.get(User, a['first_id'])
        user.auth_version += 1
        await db.commit()
    assert (await client.get(prefix+'/access', headers=headers)).status_code == 401
