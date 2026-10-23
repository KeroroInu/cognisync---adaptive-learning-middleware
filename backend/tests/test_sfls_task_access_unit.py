"""Task grants are not web login credentials and never become research evidence."""
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
import zipfile

from fastapi import HTTPException
import pytest

from app.services.sfls_task_access import issue_task_access, resolve_task_access, public_receipt_detail
from app.services.sfls_package import make_sfls_package, POLICY_VERSION


def fixture():
    user = SimpleNamespace(id=uuid4(), name='测试学生', student_id='G20260001', role='learner', is_active=True, auth_version=2)
    material_id, download_id = uuid4(), uuid4()
    credential, stored = issue_task_access(user, material_id, download_id, 'https://classroom.example')
    receipt = SimpleNamespace(id=download_id, user_id=user.id, material_id=material_id, kind='download', detail={'task_access': stored})
    db = SimpleNamespace(get=AsyncMock(side_effect=[receipt, user]))
    return user, material_id, download_id, credential, stored, receipt, db


def test_issue_keeps_raw_token_only_in_separate_client_credential():
    user, material, download, credential, stored, _, _ = fixture()
    assert credential['schema'] == 'sfls-task-access/1'
    assert credential['user_id'] == str(user.id)
    assert credential['material_id'] == str(material) and credential['download_id'] == str(download)
    assert len(credential['token']) == 43
    assert stored['sha256'] == hashlib.sha256(credential['token'].encode()).hexdigest()
    assert credential['token'] not in json.dumps(stored)
    assert stored['auth_version'] == user.auth_version
    assert datetime.fromisoformat(stored['expires_at']) > datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_resolve_returns_only_the_download_owner():
    user, material, download, credential, _, receipt, db = fixture()
    resolved, bound, expires = await resolve_task_access(db, material, download, credential['token'])
    assert resolved is user and bound is receipt and expires == credential['expires_at']


@pytest.mark.asyncio
@pytest.mark.parametrize('fault', ['token', 'material', 'kind', 'expired', 'naive_expiry', 'invalid_digest', 'revoked', 'auth_version', 'inactive', 'role', 'missing_record'])
async def test_task_grant_rejects_invalid_or_revoked_binding_without_echo(fault):
    user, material, download, credential, stored, receipt, _ = fixture()
    token = credential['token']
    if fault == 'token': token = 'A' * 43
    if fault == 'material': receipt.material_id = uuid4()
    if fault == 'kind': receipt.kind = 'submission'
    if fault == 'expired': stored['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    if fault == 'naive_expiry': stored['expires_at'] = datetime.now().isoformat()
    if fault == 'invalid_digest': stored['sha256'] = '非ASCII摘要'
    if fault == 'revoked': stored['revoked_at'] = datetime.now(timezone.utc).isoformat()
    if fault == 'auth_version': user.auth_version += 1
    if fault == 'inactive': user.is_active = False
    if fault == 'role': user.role = 'admin'
    if fault == 'missing_record': receipt.detail = {}
    db = SimpleNamespace(get=AsyncMock(side_effect=[receipt, user]))
    with pytest.raises(HTTPException) as caught:
        await resolve_task_access(db, material, download, token)
    assert caught.value.status_code == 401
    assert token not in str(caught.value.detail)


@pytest.mark.asyncio
@pytest.mark.parametrize('value', [None, '', 'x', 'A' * 44, '含中文的字符串', 'x\n' + 'A' * 43])
async def test_malformed_header_is_rejected_without_querying_or_echoing(value):
    db = SimpleNamespace(get=AsyncMock())
    with pytest.raises(HTTPException) as caught:
        await resolve_task_access(db, uuid4(), uuid4(), value)
    assert caught.value.status_code == 401
    db.get.assert_not_awaited()


def test_internal_grant_metadata_removed_without_mutating_evidence():
    _, _, _, _, stored, receipt, _ = fixture()
    receipt.detail['task_contract'] = {'schema': 'sfls-task/1'}
    public = public_receipt_detail(receipt.detail)
    assert public == {'task_contract': {'schema': 'sfls-task/1'}}
    assert receipt.detail['task_access'] is stored


def test_package_credential_is_separate_and_has_private_permissions():
    user, material_id, download_id, credential, _, _, _ = fixture()
    material = SimpleNamespace(id=material_id, title='贪吃蛇', configuration={'project_id': 'course', 'phase': 'practice', 'policy_version': POLICY_VERSION, 'task': '制作贪吃蛇'})
    content, provenance = make_sfls_package(material, user.id, download_id, 'windows', None, None, server=credential['server'], task_access=credential)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert json.loads(archive.read('.sfls/task-access.json')) == credential
        assert (archive.getinfo('.sfls/task-access.json').external_attr >> 16) & 0o777 == 0o600
        for name in archive.namelist():
            if name != '.sfls/task-access.json':
                assert credential['token'].encode() not in archive.read(name)
        assert 'token' not in json.loads(archive.read('sfls-task.json'))['platform']
    assert credential['token'] not in json.dumps(provenance)


def test_misplaced_task_credential_is_rejected_as_a_secret_upload():
    from app.services.classroom_files import inspect_zip
    for name in ('project/task-access.json', 'evidence/context/task-access.json'):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            archive.writestr(name, '{}')
        with pytest.raises(HTTPException, match='密钥文件'):
            inspect_zip(output.getvalue())
