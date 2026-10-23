"""Real HTTP routes with isolated database doubles; never use classroom data."""
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
import pytest

from app.api.endpoints import materials, auth
from app.db.postgres import get_db
from app.models.sql import ClassroomMaterial, MaterialReceipt, User
from app.services.sfls_package import task_contract, POLICY_VERSION
from app.services.sfls_task_access import issue_task_access
from test_sfls_materials import work_archive


@pytest.fixture
async def task_http(monkeypatch):
    user = SimpleNamespace(id=uuid4(), name='测试学生', student_id='G20260001', role='learner', class_name='测试班', experiment_group='pdt', is_active=True, auth_version=0)
    material = SimpleNamespace(id=uuid4(), title='本课贪吃蛇', kind='sfls', configuration={'project_id': 'snake-course', 'phase': 'practice', 'policy_version': POLICY_VERSION, 'task': '制作贪吃蛇'})
    download_id = uuid4()
    credential, stored = issue_task_access(user, material.id, download_id, 'https://classroom.example')
    download = SimpleNamespace(id=download_id, material_id=material.id, user_id=user.id, kind='download', detail={'task_access': stored, 'task_contract': task_contract(material)})
    rows = []
    async def get(model, value):
        if model is MaterialReceipt and value == download.id: return download
        if model is User and value == user.id: return user
        if model is ClassroomMaterial and value == material.id: return material
        return None
    async def commit():
        for row in rows:
            if row.id is None: row.id = uuid4()
            if row.created_at is None: row.created_at = datetime.now(timezone.utc)
    db = SimpleNamespace(get=AsyncMock(side_effect=get), scalar=AsyncMock(side_effect=[None, 0]), execute=AsyncMock(), add=MagicMock(side_effect=rows.append), commit=AsyncMock(side_effect=commit))
    visible = AsyncMock(return_value=material)
    monkeypatch.setattr(materials, 'student_material', visible)
    app = FastAPI()
    app.include_router(materials.router, prefix='/api')
    app.include_router(auth.router, prefix='/api/auth')
    app.dependency_overrides[get_db] = lambda: db
    prefix = f'/api/materials/{material.id}/downloads/{download_id}'
    task = {**task_contract(material), 'platform': {'server': credential['server'], 'user_id': str(user.id), 'material_id': str(material.id), 'download_id': str(download.id)}}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        yield SimpleNamespace(client=client, app=app, user=user, material=material, credential=credential, download=download, db=db, rows=rows, visible=visible, prefix=prefix, task=task, headers={'X-SFLS-Task-Token': credential['token']})


@pytest.mark.asyncio
async def test_http_identity_verifies_only_this_task_without_login(task_http):
    t = task_http
    response = await t.client.get(t.prefix+'/access', headers=t.headers)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['data'] == {'user': {'id': str(t.user.id), 'name': t.user.name, 'student_id': t.user.student_id}, 'material_id': str(t.material.id), 'download_id': str(t.download.id), 'expires_at': t.credential['expires_at']}
    assert t.credential['token'] not in response.text and 'sha256' not in response.text


@pytest.mark.asyncio
async def test_task_token_never_grants_web_login_or_other_download_access(task_http):
    t = task_http
    for endpoint in ('/api/auth/me', '/api/materials'):
        result = await t.client.get(endpoint, headers={'Authorization': f'Bearer {t.credential["token"]}'})
        assert result.status_code == 401, result.text
    assert (await t.client.get(t.prefix+'/access', headers={'Authorization': f'Bearer {t.credential["token"]}'})).status_code == 401
    foreign = t.prefix.replace(str(t.download.id), str(uuid4()))
    assert (await t.client.get(foreign+'/access', headers=t.headers)).status_code == 401
    foreign = t.prefix.replace(str(t.material.id), str(uuid4()))
    assert (await t.client.get(foreign+'/access', headers=t.headers)).status_code == 401


@pytest.mark.asyncio
async def test_http_closed_task_and_password_change_revoke_access(task_http):
    t = task_http
    t.visible.side_effect = HTTPException(403, '任务已关闭')
    assert (await t.client.get(t.prefix+'/access', headers=t.headers)).status_code == 200
    assert (await t.client.post(t.prefix+f'/submit?request_id={uuid4()}', headers=t.headers, content=work_archive(t.task))).status_code == 403
    body = {'id': str(uuid4()), 'content': '提示可以短一点', 'client_created_at': datetime.now(timezone.utc).isoformat(), 'client_context': {'task_id': str(t.material.id), 'project_id': 'snake-course', 'title': t.material.title, 'version': str(t.material.id), 'phase': 'practice', 'sfls_version': '0.1.15', 'scaffold_revision': 'test'}}
    assert (await t.client.post(t.prefix+'/advice', headers=t.headers, json=body)).status_code == 403
    t.visible.side_effect = None
    t.user.auth_version += 1
    assert (await t.client.get(t.prefix+'/access', headers=t.headers)).status_code == 401


@pytest.mark.asyncio
async def test_http_submission_is_bound_to_token_download_and_retains_evidence(task_http):
    t = task_http
    request_id = uuid4()
    original = work_archive(t.task, code='snake = [(1, 1)]')
    response = await t.client.post(t.prefix+f'/submit?request_id={request_id}', headers=t.headers, content=original)
    assert response.status_code == 200, response.text
    assert response.json()['data']['detail']['task_validation']['status'] == 'matched'
    assert response.headers['cache-control'] == 'no-store'
    assert t.rows[0].user_id == t.user.id and t.rows[0].content == original
    assert t.credential['token'].encode() not in t.rows[0].content
    assert 'task_access' not in response.text
    assert t.rows[0].request_id == request_id
    # Exact retry keeps the existing idempotency receipt, never adds a version.
    t.db.scalar.side_effect = [t.rows[0]]
    retry = await t.client.post(t.prefix+f'/submit?request_id={request_id}', headers=t.headers, content=original)
    assert retry.json() == response.json() and len(t.rows) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('field', ['download_id', 'user_id', 'material_id'])
async def test_http_cannot_upload_another_download_owner_or_task(task_http, field):
    t = task_http
    t.task['platform'][field] = str(uuid4())
    response = await t.client.post(t.prefix+f'/submit?request_id={uuid4()}', headers=t.headers, content=work_archive(t.task))
    assert response.status_code == 422, response.text
    assert not t.rows and t.credential['token'] not in response.text


@pytest.mark.asyncio
async def test_advice_is_scoped_to_this_task_without_full_login_token(task_http, monkeypatch):
    t = task_http
    body = {'id': str(uuid4()), 'content': '希望提示可以短一点', 'client_created_at': datetime.now(timezone.utc).isoformat(), 'client_context': {'task_id': str(t.material.id), 'project_id': 'snake-course', 'title': t.material.title, 'version': str(t.material.id), 'phase': 'practice', 'sfls_version': '0.1.15', 'scaffold_revision': 'test'}}
    accepted = AsyncMock(return_value={'success': True, 'data': {'id': body['id'], 'user_id': str(t.user.id), 'received_at': datetime.now(timezone.utc).isoformat()}})
    monkeypatch.setattr(materials, 'submit_advice', accepted)
    result = await t.client.post(t.prefix+'/advice', headers=t.headers, json=body)
    assert result.status_code == 200 and accepted.await_args.args[2] is t.user
    body['client_context']['task_id'] = str(uuid4())
    assert (await t.client.post(t.prefix+'/advice', headers=t.headers, json=body)).status_code == 422
    assert accepted.await_count == 1


@pytest.mark.asyncio
async def test_original_bearer_submission_route_still_calls_shared_business(task_http):
    t = task_http
    t.app.dependency_overrides[auth.get_current_user] = lambda: t.user
    result = await t.client.post(f'/api/materials/{t.material.id}/submit?request_id={uuid4()}', headers={'Authorization': 'Bearer test-existing-login'}, content=work_archive(t.task))
    assert result.status_code == 200, result.text
    assert len(t.rows) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('configured', [True, False])
async def test_authenticated_download_freezes_private_task_grant_only_with_configured_origin(task_http, monkeypatch, configured):
    import io
    import zipfile
    from app.core.config import settings
    t = task_http
    origin = 'https://classroom.example' if configured else ''
    monkeypatch.setattr(settings, 'PUBLIC_BASE_URL', origin)
    monkeypatch.setattr(materials, 'design_pair', AsyncMock(return_value={'initial': None, 'current': None}))
    monkeypatch.setattr(materials.worksheet, 'package_context', AsyncMock(return_value=None))
    t.app.dependency_overrides[auth.get_current_user] = lambda: t.user
    t.db.scalar.side_effect = [0]
    response = await t.client.post(f'/api/materials/{t.material.id}/download?platform=windows', headers={'Host': 'attacker.invalid'})
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        if configured:
            credential = json.loads(archive.read('.sfls/task-access.json'))
            assert credential['server'] == origin
            assert credential['user_id'] == str(t.user.id)
            assert credential['download_id'] == str(t.rows[0].id)
            assert credential['token'] not in json.dumps(t.rows[0].detail)
            public = materials.receipt_row(t.rows[0])
            assert 'task_access' not in public['detail']
            assert t.rows[0].detail['task_contract']['task_id'] == str(t.material.id)
        else:
            assert '.sfls/task-access.json' not in archive.namelist()
            assert 'task_access' not in t.rows[0].detail
