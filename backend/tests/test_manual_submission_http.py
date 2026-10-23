"""Manual recovery through real HTTP routes, with isolated DB doubles only.

No production connection, student content, external model, or local execution is
used. Synthetic secrets are intentionally kept out of assertion diagnostics.
"""
from datetime import datetime, timezone
import hashlib
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import zipfile

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
import pytest

from app.api.endpoints import auth, materials
from app.db.postgres import get_db
from app.models.sql import ClassroomMaterial, MaterialReceipt, User
from app.services.sfls_evidence import evidence_rows
from app.services.sfls_package import POLICY_VERSION, previous_project, task_contract
from app.services.sfls_task_access import issue_task_access
from app.services.work_records import readme_preview
from test_sfls_materials import work_archive


def zipped(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def unpack(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.testzip() is None
        return {name: archive.read(name) for name in archive.namelist()}


def folder_archive(task, *, secret=False):
    """A Windows-style 'compress this task folder', not an SFLS /pack result."""
    token = 'sk-' + 'syntheticneverissuedcredential' * 2
    message = '我想用列表保存蛇身。' + (token if secret else '')
    event = {'schema': 'sfls-event/1', 'id': 'event-1', 'type': 'request_settled',
             'at': '2026-10-22T07:00:00Z', 'run_id': 'run-1', 'sequence': 4,
             'elapsed_ms': 2300, 'duration_ms': 1700,
             'phase': task['phase'], 'task_mode': task['support']['mode'],
             'policy': task['support']['policy_version']}
    session = {'id': 'message-1', 'parentId': 'message-0', 'type': 'message',
               'timestamp': '2026-10-22T07:00:01Z',
               'message': {'role': 'user', 'content': [{'type': 'text', 'text': message}]}}
    files = {'本课任务/sfls-task.json': json.dumps(task, ensure_ascii=False),
             '本课任务/project/main.py': 'snake = [(1, 1)]\n',
             '本课任务/project/README.md': '# 我的作品\n用列表保存蛇身。\n',
             '本课任务/evidence/events.jsonl': json.dumps(event) + '\n',
             '本课任务/evidence/sessions/demo.jsonl': json.dumps(session, ensure_ascii=False) + '\n',
             '本课任务/materials/TASK.md': '实现转向、吃食物和碰撞结束。',
             '本课任务/design/current/requirements.md': '# 我的需求\n方向键控制。',
             '本课任务/.sfls/task-access.json': json.dumps({'token': token}),
             '本课任务/.sfls/environment/ignored.bin': 'not a real runtime',
             '本课任务/project/.env': 'API_KEY=' + token,
             '本课任务/submissions/old.zip': 'not a real old package',
             '本课任务/project/__pycache__/main.pyc': 'not real bytecode'}
    return zipped(files), token


@pytest.fixture
async def manual_http(monkeypatch):
    user = SimpleNamespace(id=uuid4(), name='测试学生', student_id='G20260001',
                           role='learner', class_name='测试班', experiment_group='pdt',
                           is_active=True, auth_version=0)
    material = SimpleNamespace(id=uuid4(), title='本课贪吃蛇', kind='sfls',
                               configuration={'project_id': 'snake-course', 'phase': 'practice',
                                              'policy_version': POLICY_VERSION, 'task': '制作贪吃蛇'})
    download_id = uuid4()
    credential, stored = issue_task_access(user, material.id, download_id, 'https://classroom.example')
    download = SimpleNamespace(id=download_id, material_id=material.id, user_id=user.id,
                               kind='download', detail={'task_access': stored,
                                                       'task_contract': task_contract(material)})
    rows = []

    async def get(model, value):
        if model is MaterialReceipt and value == download.id:
            return download
        if model is User and value == user.id:
            return user
        if model is ClassroomMaterial and value == material.id:
            return material
        return None

    async def commit():
        for row in rows:
            if row.id is None:
                row.id = uuid4()
            if row.created_at is None:
                row.created_at = datetime.now(timezone.utc)

    db = SimpleNamespace(get=AsyncMock(side_effect=get),
                         scalar=AsyncMock(side_effect=[None, 0]), execute=AsyncMock(),
                         add=MagicMock(side_effect=rows.append), commit=AsyncMock(side_effect=commit))
    visible = AsyncMock(return_value=material)
    monkeypatch.setattr(materials, 'student_material', visible)
    app = FastAPI()
    app.include_router(materials.router, prefix='/api')
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[auth.get_current_user] = lambda: user
    task = {**task_contract(material), 'title': material.title,
            'platform': {'server': credential['server'], 'user_id': str(user.id),
                         'material_id': str(material.id), 'download_id': str(download.id)}}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        yield SimpleNamespace(client=client, app=app, user=user, material=material,
                              credential=credential, download=download, db=db, rows=rows,
                              visible=visible, task=task,
                              prefix=f'/api/materials/{material.id}',
                              headers={'Authorization': 'Bearer synthetic-web-login'})


@pytest.mark.asyncio
async def test_http_manual_folder_retains_code_sessions_timing_and_inheritance(manual_http):
    t = manual_http
    raw, _ = folder_archive(t.task)
    request_id = uuid4()
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={request_id}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 200, result.text
    assert result.headers['cache-control'] == 'no-store'
    assert len(t.rows) == 1
    receipt = t.rows[0]
    assert (receipt.user_id, receipt.material_id, receipt.request_id, receipt.kind) == (
        t.user.id, t.material.id, request_id, 'submission')
    assert receipt.size == len(receipt.content)
    assert receipt.sha256 == hashlib.sha256(receipt.content).hexdigest()
    assert receipt.detail['manual_import']['schema'] == 'sfls-manual-import/1'
    assert receipt.detail['manual_import']['source'] == 'server_manual_import_not_execution_attestation'
    assert receipt.detail['task_validation']['status'] == 'matched'
    files = unpack(receipt.content)
    assert files['project/main.py'] == b'snake = [(1, 1)]\n'
    assert 'evidence/sessions/demo.jsonl' in files
    assert 'evidence/context/materials/TASK.md' in files
    assert 'evidence/context/design/current/requirements.md' in files
    assert not any(name.startswith(('本课任务/', '.sfls/', 'submissions/')) for name in files)
    assert not any('.env' in name or '__pycache__' in name for name in files)
    manifest = json.loads(files['manifest.json'])
    for item in manifest['files']:
        assert item['sha256'] == hashlib.sha256(files[item['path']]).hexdigest()
        assert item['size'] == len(files[item['path']])
    inherited = previous_project(receipt.content, t.user.id, 'snake-course', t.material.id)
    assert inherited['project/main.py'] == files['project/main.py']
    assert '用列表保存蛇身' in readme_preview(receipt.content)['text']
    evidence = list(evidence_rows(receipt.content, {'receipt_id': str(receipt.id)}))
    event = next(row for row in evidence if row['kind'] == 'request_settled')
    message = next(row for row in evidence if row['event_id'] == 'message-1')
    assert (event['client_at'], event['sequence'], event['elapsed_ms'], event['duration_ms']) == (
        '2026-10-22T07:00:00Z', 4, 2300, 1700)
    assert message['parent_id'] == 'message-0' and message['role'] == 'user'
    assert message['text'] == '我想用列表保存蛇身。'


@pytest.mark.asyncio
async def test_http_manual_secret_is_redacted_before_any_db_content_is_stored(manual_http):
    t = manual_http
    raw, token = folder_archive(t.task, secret=True)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 200, result.text
    assert len(t.rows) == 1
    receipt = t.rows[0]
    files = unpack(receipt.content)
    assert token not in json.dumps(receipt.detail, ensure_ascii=False)
    assert token not in result.text
    assert all(token.encode() not in value for value in files.values())
    assert receipt.content != raw
    assert receipt.detail['manual_import']['transformation'] == 'server_transformed_copy'
    assert receipt.detail['manual_import']['redactions']
    assert receipt.detail['manual_import']['original_archive_sha256'] == hashlib.sha256(raw).hexdigest()
    message = next(row for row in evidence_rows(receipt.content, {}) if row['event_id'] == 'message-1')
    assert '我想用列表保存蛇身。' in message['text'] and 'REDACTED' in message['text']
    assert 'task_access' not in result.text


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['user_id', 'material_id', 'download_id'])
async def test_http_manual_wrong_binding_never_inserts_receipt(manual_http, field):
    t = manual_http
    t.task['platform'][field] = str(uuid4())
    raw, _ = folder_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 422, result.text
    assert not t.rows
    t.db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('fault', ['owner', 'material', 'kind', 'missing'])
async def test_http_manual_requires_actual_owned_download_record(manual_http, fault):
    t = manual_http
    if fault == 'owner':
        t.download.user_id = uuid4()
    elif fault == 'material':
        t.download.material_id = uuid4()
    elif fault == 'kind':
        t.download.kind = 'submission'
    else:
        t.db.get.side_effect = None
        t.db.get.return_value = None
    raw, _ = folder_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 422, result.text
    assert not t.rows
    t.db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['anonymous', 'task_header', 'task_bearer'])
async def test_http_manual_is_web_login_only_not_task_capability(manual_http, mode):
    t = manual_http
    del t.app.dependency_overrides[auth.get_current_user]
    headers = {'X-SFLS-Task-Token': t.credential['token']} if mode == 'task_header' else (
        {'Authorization': 'Bearer ' + t.credential['token']} if mode == 'task_bearer' else {})
    raw, _ = folder_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=headers, content=raw)
    assert result.status_code == 401, result.text
    assert not t.rows
    t.visible.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_official_submit_still_rejects_secret_in_standard_pack(manual_http):
    t = manual_http
    token = 'sk-' + 'syntheticneverissuedcredential' * 2
    event = {'type': 'message', 'message': {'role': 'user', 'content': token}}
    data = work_archive(t.task, event=event)
    result = await t.client.post(t.prefix + f'/submit?request_id={uuid4()}',
                                 headers=t.headers, content=data)
    assert result.status_code == 422
    assert token not in result.text
    assert not t.rows


@pytest.mark.asyncio
async def test_http_manual_repeat_is_idempotent_and_conflicting_request_rejected(manual_http):
    t = manual_http
    raw, _ = folder_archive(t.task, secret=True)
    url = t.prefix + f'/manual-submit?request_id={uuid4()}'
    first = await t.client.post(url, headers=t.headers, content=raw)
    assert first.status_code == 200, first.text
    t.db.scalar.side_effect = [t.rows[0]]
    repeat = await t.client.post(url, headers=t.headers, content=raw)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json() == first.json() and len(t.rows) == 1
    changed_files = unpack(raw)
    changed_files['本课任务/project/main.py'] = b'print("different work")\n'
    t.db.scalar.side_effect = [t.rows[0]]
    changed = await t.client.post(url, headers=t.headers, content=zipped(changed_files))
    assert changed.status_code == 409 and len(t.rows) == 1
    assert t.db.commit.await_count == 1


@pytest.mark.asyncio
async def test_http_manual_closed_material_never_reads_or_inserts_work(manual_http):
    t = manual_http
    t.visible.side_effect = HTTPException(403, '任务已关闭')
    raw, _ = folder_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 403
    assert not t.rows
    t.db.get.assert_not_awaited()
    t.db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_manual_empty_and_over_limit_uploads_are_bounded(manual_http, monkeypatch):
    t = manual_http
    url = t.prefix + f'/manual-submit?request_id={uuid4()}'
    empty = await t.client.post(url, headers=t.headers, content=b'')
    assert empty.status_code == 422
    monkeypatch.setattr(materials, 'MAX_MANUAL_UPLOAD', 32)
    too_big = await t.client.post(url, headers=t.headers, content=b'x' * 33)
    assert too_big.status_code == 413
    assert not t.rows
    t.db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('kind', ['pi', 'file'])
async def test_http_manual_does_not_change_non_sfls_assignment_routes(manual_http, kind):
    t = manual_http
    t.material.kind = kind
    raw, _ = folder_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 422
    assert not t.rows
    t.db.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_http_manual_accepts_clean_official_pack_without_changing_its_bytes(manual_http):
    t = manual_http
    raw = work_archive(t.task)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 200, result.text
    assert len(t.rows) == 1 and t.rows[0].content == raw
    assert t.rows[0].detail['manual_import']['transformation'] == 'none_original_standard_pack'


@pytest.mark.asyncio
@pytest.mark.parametrize('support', [None, [], 'invalid'])
async def test_http_manual_malformed_task_support_is_a_validation_error(manual_http, support):
    t = manual_http
    raw, _ = folder_archive(t.task)
    files = unpack(raw)
    changed = {**t.task, 'support': support}
    files['本课任务/sfls-task.json'] = json.dumps(changed)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=zipped(files))
    assert result.status_code == 422, result.text
    assert not t.rows
    t.db.commit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['not-a-zip', 'non_finite_json', 'unpaired_surrogate'])
async def test_http_manual_malformed_archive_or_json_never_causes_server_error(manual_http, invalid):
    t = manual_http
    raw, _ = folder_archive(t.task)
    if invalid == 'not-a-zip':
        raw = b'this is not a ZIP archive'
    else:
        files = unpack(raw)
        task = {**t.task, 'extra': float('nan') if invalid == 'non_finite_json' else '\ud800'}
        files['本课任务/sfls-task.json'] = json.dumps(task)
        raw = zipped(files)
    result = await t.client.post(t.prefix + f'/manual-submit?request_id={uuid4()}',
                                 headers=t.headers, content=raw)
    assert result.status_code == 422, result.text
    assert not t.rows
    t.db.commit.assert_not_awaited()
