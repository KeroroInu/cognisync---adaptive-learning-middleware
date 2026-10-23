"""Class workspace + ephemeral notices, real JWT/isolated PostgreSQL only."""
import asyncio
import io
import zipfile
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models.sql.classroom import ClassroomSession
from app.models.sql.classroom_notice import ClassroomNotice
from app.models.sql.user import User
from app.services.classroom_notice import purge_expired
from tests.test_classroom import classroom_actors

pytestmark = pytest.mark.asyncio
ADMIN = '/api/admin/classroom'


@pytest.fixture
async def actors(test_db, classroom_actors):
    async with test_db() as db:
        for key, name in [('first_id', '解构班'), ('second_id', '解构班'), ('other_id', '开发班')]:
            (await db.get(User, classroom_actors[key])).class_name = name
        await db.commit()
    return classroom_actors


def body(content='fake-classroom-key-not-a-real-secret', class_name='解构班'):
    return dict(request_id=str(uuid4()), class_name=class_name, content=content)


async def state(client, actors, who='first'):
    response = await client.get('/api/classroom/state', headers=actors[who])
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    return response.json()['data']


async def test_workspace_idempotent_and_no_class_gate(client, test_db, actors):
    assert (await state(client, actors))['session'] is None
    assert (await client.get('/api/materials', headers=actors['first'])).json()['data'] == []
    path = ADMIN + '/workspace'
    assert (await client.post(path, headers=actors['first'], json={'class_name': '解构班'})).status_code == 403
    assert (await client.post(path, headers=actors['teacher'], json={'class_name': '第三班'})).status_code == 422
    replies = await asyncio.gather(*(client.post(path, headers=actors['teacher'], json={'class_name': '解构班'}) for _ in range(3)))
    assert all(r.status_code == 200 for r in replies)
    assert len({r.json()['data']['id'] for r in replies}) == 1
    sid = replies[0].json()['data']['id']
    async with test_db() as db:
        workspace = await db.get(ClassroomSession, UUID(sid))
        workspace.state = 'closed'
        workspace.closes_at = datetime.now(timezone.utc) - timedelta(days=1)
        await db.commit()
    assert (await state(client, actors))['session']['state'] == 'open'
    assert (await client.get('/api/research/active-task', headers=actors['first'])).status_code == 404
    assert (await client.post(ADMIN + f'/sessions/{sid}/state', headers=actors['teacher'], json={'action': 'end'})).status_code == 410
    assert (await client.get('/api/materials', headers=actors['first'])).json()['data'] == []


async def test_notice_without_lesson_scope_replacement_withdrawal(client, test_db, actors):
    payload = body()
    assert (await client.post(ADMIN + '/notices', headers=actors['first'], json=payload)).status_code == 403
    created = await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)
    assert created.status_code == 200
    assert created.headers['cache-control'] == 'no-store'
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)).json() == created.json()
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json={**payload, 'content': 'changed'})).status_code == 409
    assert (await state(client, actors))['notice']['content'] == payload['content']
    assert (await state(client, actors, 'other'))['notice'] is None
    assert (await client.get('/api/classroom/state')).status_code == 401
    assert (await client.get(ADMIN + '/notices?class_name=解构班', headers=actors['first'])).status_code == 403
    second = body('replacement')
    await client.post(ADMIN + '/notices', headers=actors['teacher'], json=second)
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)).json()['data'] is None
    await client.post(ADMIN + f"/notices/{payload['request_id']}/withdraw", headers=actors['teacher'], json={})
    assert (await state(client, actors))['notice']['content'] == 'replacement'
    url = ADMIN + f"/notices/{second['request_id']}/withdraw"
    assert (await client.post(url, headers=actors['first'], json={})).status_code == 403
    for _ in range(2):
        assert (await client.post(url, headers=actors['teacher'], json={})).status_code == 200
    assert (await state(client, actors))['notice'] is None
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=second)).json()['data'] is None
    async with test_db() as db:
        assert all(n.content is None for n in (await db.scalars(select(ClassroomNotice))).all())


async def test_notice_expiry_and_not_exported(client, test_db, actors, monkeypatch, caplog):
    from app.services import research_package
    async def empty_graph(ids):
        yield []
    monkeypatch.setattr(research_package, 'graph_batches', empty_graph)
    payload = body()
    response = await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)
    assert response.status_code == 200
    expires = datetime.fromisoformat(response.json()['data']['expires_at'])
    from zoneinfo import ZoneInfo
    assert expires.astimezone(ZoneInfo('Asia/Shanghai')).hour == 0
    assert datetime.now(timezone.utc) < expires <= datetime.now(timezone.utc) + timedelta(days=1)
    exported = await client.get('/api/admin/export/research-package?class_name=解构班', headers=actors['teacher'])
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert not any('notice' in name for name in archive.namelist())
        assert all(payload['content'].encode() not in archive.read(name) for name in archive.namelist())
    assert payload['content'] not in caplog.text
    async with test_db() as db:
        item = await db.get(ClassroomNotice, UUID(payload['request_id']))
        item.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    # Hidden immediately even before the background cleanup runs.
    assert (await state(client, actors))['notice'] is None
    async with test_db() as db:
        await purge_expired(db)
        assert (await db.get(ClassroomNotice, UUID(payload['request_id']))).content is None
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)).json()['data'] is None


async def test_targeted_notices_private_and_coexist_with_class_content(client, test_db, actors):
    whole = body('全班学习链接 https://example.org/lesson')
    one = {**body('只给甲同学的指令'), 'target_user_ids': [str(actors['first_id'])]}
    subset = {**body('两人共同的参考文字'), 'target_user_ids': [str(actors['first_id']), str(actors['second_id'])]}
    for payload in (whole, one, subset):
        assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload)).status_code == 200
    first = (await state(client, actors))['notices']
    second = (await state(client, actors, 'second'))['notices']
    assert {row['content'] for row in first} == {whole['content'], one['content'], subset['content']}
    assert {row['content'] for row in second} == {whole['content'], subset['content']}
    assert (await state(client, actors, 'other'))['notices'] == []
    assert all('target_user_ids' not in row for row in first + second)
    for path in ('/notices/students?class_name=解构班', '/notices/sent?class_name=解构班'):
        assert (await client.get(ADMIN + path, headers=actors['first'])).status_code == 403
    sent = (await client.get(ADMIN + '/notices/sent?class_name=解构班', headers=actors['teacher'])).json()['data']
    assert len(sent) == 3 and all('content' not in row for row in sent)
    roster = (await client.get(ADMIN + '/notices/students?class_name=解构班', headers=actors['teacher'])).json()['data']
    assert {row['id'] for row in roster} == {str(actors['first_id']), str(actors['second_id'])}
    assert all(set(row) == {'id', 'name', 'student_id'} for row in roster)
    # A private replacement cannot withdraw the whole class's content.
    replacement = {**body('甲同学的新指令'), 'target_user_ids': one['target_user_ids']}
    await client.post(ADMIN + '/notices', headers=actors['teacher'], json=replacement)
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=one)).json()['data'] is None
    assert {row['content'] for row in (await state(client, actors, 'second'))['notices']} == {whole['content'], subset['content']}
    await client.post(ADMIN + '/notices/' + replacement['request_id'] + '/withdraw', headers=actors['teacher'], json={})
    assert one['content'] not in str(await state(client, actors))


async def test_notice_recipients_validate_before_replacement_and_retry_bound(client, test_db, actors):
    payload = {**body('两位同学的内容'), 'target_user_ids': [str(actors['first_id']), str(actors['second_id'])]}
    replies = await asyncio.gather(*(client.post(ADMIN + '/notices', headers=actors['teacher'], json=payload) for _ in range(3)))
    assert all(reply.status_code == 200 for reply in replies)
    created = replies[0]
    assert all(reply.json() == created.json() for reply in replies)
    reordered = {**payload, 'target_user_ids': list(reversed(payload['target_user_ids'])) + [str(actors['first_id'])]}
    assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=reordered)).json() == created.json()
    for target_ids in ([], [str(actors['first_id'])]):
        assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json={**payload, 'target_user_ids': target_ids})).status_code == 409
    for target in (actors['other_id'], uuid4()):
        bad = {**body('不能送达'), 'target_user_ids': [str(target)]}
        assert (await client.post(ADMIN + '/notices', headers=actors['teacher'], json=bad)).status_code == 422
    assert len((await state(client, actors))['notices']) == 1
    async with test_db() as db:
        (await db.get(User, actors['first_id'])).class_name = '开发班'
        await db.commit()
    assert (await state(client, actors))['notices'] == []
