import asyncio
import io
import json
import zipfile
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from tests.test_classroom import classroom_actors

pytestmark = pytest.mark.asyncio


def payload(content="希望多一点读代码的例子"):
    return dict(id=str(uuid4()), content=content, client_created_at=datetime.now(timezone.utc).isoformat(),
                client_context=dict(task_id="snake-1", project_id="snake", title="第一课", version="1", phase="practice", sfls_version="0.1.8", scaffold_revision="2026-10-14.1"))


async def test_advice_auth_idempotency_and_scope(client, test_db, classroom_actors):
    a = classroom_actors
    body = payload()
    assert (await client.post('/api/advice', json=body)).status_code == 401
    assert (await client.get('/api/admin/advice', headers=a['first'])).status_code == 403
    assert (await client.post('/api/advice', json=body, headers=a['teacher'])).status_code == 403
    replies = await asyncio.gather(*(client.post('/api/advice', json=body, headers=a['first']) for _ in range(3)))
    assert all(r.status_code == 200 for r in replies), [r.text for r in replies]
    assert replies[0].json() == replies[1].json() == replies[2].json()
    assert replies[0].headers['cache-control'] == 'no-store'
    assert replies[0].json()['data']['user_id'] == str(a['first_id'])
    for who, changed in [('first', {**body, 'content': 'changed'}), ('second', body), ('first', {**body, 'client_context': {**body['client_context'], 'title': 'changed'}})]:
        assert (await client.post('/api/advice', json=changed, headers=a[who])).status_code == 409
    await client.post('/api/advice', json=payload('另一班建议'), headers=a['other'])
    listing = await client.get('/api/admin/advice?class_name=测试一班&limit=1', headers=a['teacher'])
    assert listing.headers['cache-control'] == 'no-store'
    data = listing.json()['data']
    assert data['total'] == 1 and data['items'][0]['content'] == body['content']
    assert (await client.get('/api/admin/advice?class_name=测试一班&offset=1', headers=a['teacher'])).json()['data']['items'] == []
    assert (await client.get('/api/admin/advice?limit=101', headers=a['teacher'])).status_code == 422


async def test_advice_validation(client, test_db, classroom_actors):
    for content in ['', '   ', 'x' * 2001, 'sk-' + 'x' * 25, 'Bearer ' + 'x' * 25]:
        assert (await client.post('/api/advice', json=payload(content), headers=classroom_actors['first'])).status_code == 422
    body = payload()
    assert (await client.post('/api/advice', json={**body, 'user_id': str(classroom_actors['other_id'])}, headers=classroom_actors['first'])).status_code == 422
    assert (await client.post('/api/advice', json={**body, 'client_created_at': '2026-10-14T09:00:00'}, headers=classroom_actors['first'])).status_code == 422


async def test_advice_export_original_text_class_scope_and_no_credentials(client, test_db, classroom_actors, monkeypatch):
    from app.services import research_package
    async def empty_graph(ids):
        yield []
    monkeypatch.setattr(research_package, 'graph_batches', empty_graph)
    a = classroom_actors
    body = payload('=原文保留\n再加一个例子')
    await client.post('/api/advice', json=body, headers=a['first'])
    await client.post('/api/advice', json=payload('不能导出这一班'), headers=a['other'])
    exported = await client.get('/api/admin/export/research-package?class_name=测试一班&include_graph=false', headers=a['teacher'])
    assert exported.status_code == 200, exported.text[:300] if exported.status_code != 200 else ''
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        raw = 'student_advice.jsonl'
        rows = [json.loads(line) for line in archive.read(raw).decode().splitlines()]
        assert len(rows) == 1 and rows[0]['content'] == body['content']
        assert rows[0]['user_id'] == str(a['first_id'])
        csv = archive.read(raw.replace('.jsonl', '.csv')).decode('utf-8-sig')
        assert "'=原文保留" in csv
        assert '不能导出这一班' not in csv
        assert a['first']['Authorization'].encode() not in archive.read(raw)
