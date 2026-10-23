import hashlib
import io
import json
import zipfile
from uuid import uuid4

import pytest
from test_classroom import classroom_actors as actors_fixture, start

classroom_actors = actors_fixture
pytestmark = pytest.mark.asyncio
ADMIN = '/api/admin/classroom'


async def publish(client, a, sid, phase='practice', inherit=True):
    body = {'request_id': str(uuid4()), 'title': '本课贪吃蛇', 'task': '补充一个自己设计的功能',
            'runtime': 'sfls', 'phase': phase, 'project_id': 'snake-course',
            'curriculum': '列表用来保存多个坐标。', 'inherit_previous': inherit}
    response = await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=a['teacher'], json=body)
    assert response.status_code == 200, response.text
    repeat = await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=a['teacher'], json=body)
    assert repeat.json() == response.json()
    return response.json()['data']


async def test_download_embeds_configured_origin_not_untrusted_host(client, classroom_actors, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'PUBLIC_BASE_URL', 'https://124.222.152.227')
    actors = classroom_actors
    sid = (await start(client, actors))['id']
    item = await publish(client, actors, sid)
    response = await client.post(f'/api/materials/{item["id"]}/download',
                                 headers={**actors['first'], 'Host': 'attacker.invalid'})
    files = unpack(response)
    task = json.loads(files['sfls-task.json'])
    assert task['platform']['server'] == 'https://124.222.152.227'


def unpack(response):
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def work_archive(task, code='print(42)', readme=None, event=None):
    files = {'project/main.py': code.encode(), 'evidence/events.jsonl': b'{"type":"snapshot","at":"2026-10-06T10:00:00Z"}\n',
             'evidence/sessions/demo.jsonl': b'{"type":"message","message":{"role":"user","content":[{"type":"text","text":"how?"}]}}\n'}
    if readme is not None:
        files['project/README.md'] = readme.encode()
    if event is not None:
        files['evidence/events.jsonl'] = (json.dumps(event) + '\n').encode()
    manifest = {'schema': 'cognisync-local/1', **task['platform'], 'pi_version': '0.85.1', 'platform': 'mac',
                'sfls': {'version': '0.1.0', 'task': task, 'policy_version': task.get('support', {}).get('policy_version')},
                'files': [{'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content)} for name, content in files.items()]}
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, content in {**files, 'manifest.json': json.dumps(manifest).encode()}.items():
            archive.writestr(name, content)
    return output.getvalue()


async def test_design_versions_personalized_package_and_next_lesson(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    material = await publish(client, a, sid)
    base = f'/api/materials/{material["id"]}'
    assert (await client.get(base+'/design', headers=a['other'])).status_code == 404
    body = {'request_id': str(uuid4()), 'base_revision': 0, 'requirements': '能改变方向',
            'nodes': [{'id': 'move', 'title': '移动<script>', 'purpose': '更新蛇头位置', 'x': 100, 'y': 120}], 'edges': []}
    saved = await client.post(base+'/design', headers=a['first'], json=body)
    assert saved.status_code == 200, saved.text
    assert (await client.post(base+'/design', headers=a['first'], json=body)).json() == saved.json()
    assert (await client.get(base+'/design', headers=a['second'])).json()['data']['current'] is None
    second = {**body, 'request_id': str(uuid4()), 'base_revision': 1, 'requirements': '方向键控制，不能掉头'}
    assert (await client.post(base+'/design', headers=a['first'], json=second)).status_code == 200
    conflict = await client.post(base+'/design', headers=a['first'], json={**body, 'request_id': str(uuid4())})
    assert conflict.status_code == 409
    pair = (await client.get(base+'/design', headers=a['first'])).json()['data']
    assert pair['initial']['requirements'] == '能改变方向'
    assert pair['current']['revision'] == 2
    files = unpack(await client.post(base+'/download?platform=mac', headers=a['first']))
    task = json.loads(files['sfls-task.json'])
    assert task['platform']['user_id'] == str(a['first_id']) and task['phase'] == 'practice'
    assert b'&lt;script&gt;' in files['design/current/architecture.svg']
    assert '方向键控制' in files['design/current/requirements.md'].decode()
    assert '能改变方向' in files['design/initial/requirements.md'].decode()
    assert files['materials/本课知识.md'].decode().startswith('列表')
    assert 'AGENTS.md' not in files
    assert task['support']['mode'] == 'classroom'
    assert '## 怎么运行' in files['project/README.md'].decode()
    archive = work_archive(task, readme='my own documentation')
    submit_url = base+f'/submit?request_id={uuid4()}'
    assert (await client.post(submit_url, headers=a['second'], content=archive)).status_code == 422
    receipt = await client.post(submit_url, headers=a['first'], content=archive)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()['data']['detail']['task_validation']['status'] == 'matched'
    assert (await client.post(submit_url, headers=a['first'], content=archive)).json() == receipt.json()
    next_material = await publish(client, a, sid)
    next_base = f'/api/materials/{next_material["id"]}'
    inherited = unpack(await client.post(next_base+'/download?platform=windows', headers=a['first']))
    assert inherited['project/main.py'] == b'print(42)'
    assert inherited['project/README.md'] == b'my own documentation'
    assert 'Start.cmd' in inherited and not any(name.startswith('evidence/') for name in inherited)
    provenance = json.loads(inherited['sfls-task.json'])['provenance']
    assert provenance['receipt_id'] == receipt.json()['data']['id']
    peer = unpack(await client.post(next_base+'/download', headers=a['second']))
    assert peer['project/main.py'] != b'print(42)'
    assert not any(name.startswith('design/') for name in peer)
    exported = await client.get('/api/admin/export/research-package?include_graph=false', headers=a['teacher'])
    research = unpack(exported)
    index = [json.loads(line) for line in research['sfls_process.jsonl'].splitlines()]
    assert len(index) == 2
    assert {row['user_id'] for row in index} == {str(a['first_id'])}
    assert {row['receipt_id'] for row in index} == {receipt.json()['data']['id']}
    assert next(row for row in index if row['role'] == 'user')['text'] == 'how?'
    assert all(row['source'] == 'unverified_local_report' for row in index)
    assert all(row['task_validation_status'] == 'matched' for row in index)
    assert research[f'originals/classroom_material_receipts/{receipt.json()["data"]["id"]}.bin'] == archive


async def test_assessments_do_not_inherit_classroom_code_or_design(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    practice = await publish(client, a, sid)
    await client.post(f'/api/materials/{practice["id"]}/design', headers=a['first'], json={
        'request_id': str(uuid4()), 'base_revision': 0, 'requirements': 'classroom secret plan', 'nodes': [], 'edges': []})
    for phase in ('pre', 'post'):
        item = await publish(client, a, sid, phase=phase, inherit=False)
        files = unpack(await client.post(f'/api/materials/{item["id"]}/download', headers=a['first']))
        assert json.loads(files['sfls-task.json'])['phase'] == phase
        assert json.loads(files['sfls-task.json'])['support']['mode'] == 'assessment'
        assert '自由协作' in files['使用说明.md'].decode()
        assert not any(name.startswith('design/') for name in files)
        assert (await client.get(f'/api/materials/{item["id"]}/design', headers=a['first'])).json()['data']['revision'] == 0
    bad = await client.post(f'{ADMIN}/sessions/{sid}/packages', headers=a['teacher'], json={
        'request_id': str(uuid4()), 'title': 'bad', 'task': 'task', 'runtime': 'sfls', 'phase': 'post', 'inherit_previous': True})
    assert bad.status_code == 422


async def test_design_invalid_links_and_tampered_submission(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    item = await publish(client, a, sid)
    base = f'/api/materials/{item["id"]}'
    assert (await client.post(base+'/design', headers=a['first'], json={
        'request_id': str(uuid4()), 'base_revision': 0, 'requirements': 'x', 'nodes': [], 'edges': [{'source': 'x', 'target': 'y'}]})).status_code == 422
    files = unpack(await client.post(base+'/download', headers=a['first']))
    task = json.loads(files['sfls-task.json'])
    task['project_id'] = 'not-this-course'
    response = await client.post(base+f'/submit?request_id={uuid4()}', headers=a['first'], content=work_archive(task))
    assert response.status_code == 409


async def test_changed_mode_is_retained_flagged_exported_and_not_inherited(client, classroom_actors):
    a = classroom_actors
    sid = (await start(client, a))['id']
    item = await publish(client, a, sid)
    base = f'/api/materials/{item["id"]}'
    task = json.loads(unpack(await client.post(base+'/download', headers=a['first']))['sfls-task.json'])
    task['phase'] = 'post'
    task['support']['mode'] = 'assessment'
    archive = work_archive(task, code='changed_mode_code', event={'type': 'request_started', 'phase': 'post', 'task_mode': 'assessment', 'policy': task['support']['policy_version']})
    url = base+f'/submit?request_id={uuid4()}'
    response = await client.post(url, headers=a['first'], content=archive)
    assert response.status_code == 200, response.text
    result = response.json()['data']
    validation = result['detail']['task_validation']
    assert validation['status'] == 'mismatch'
    assert {'phase', 'support', 'event_mode_or_policy'} <= set(validation['differences'])
    assert (await client.post(url, headers=a['first'], content=archive)).json() == response.json()
    teacher = await client.get(f'{ADMIN}/materials/{item["id"]}/receipts', headers=a['teacher'])
    assert next(row for row in teacher.json()['data']['items'] if row['id'] == result['id'])['detail']['task_validation']['status'] == 'mismatch'
    assert (await client.get(f'{ADMIN}/receipts/{result["id"]}/file', headers=a['teacher'])).content == archive
    following = await publish(client, a, sid)
    files = unpack(await client.post(f'/api/materials/{following["id"]}/download', headers=a['first']))
    assert files['project/main.py'] != b'changed_mode_code'
    research = unpack(await client.get('/api/admin/export/research-package?include_graph=false', headers=a['teacher']))
    rows = [json.loads(line) for line in research['sfls_process.jsonl'].splitlines()]
    assert all(row['task_validation_status'] == 'mismatch' for row in rows)
    assert next(row for row in rows if row['kind'] == 'request_started')['task_mode'] == 'assessment'
