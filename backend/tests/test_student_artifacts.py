"""Read-only offline artifacts, bounded previews, and real admin JWT boundaries.

Uses only synthetic records and in-memory DB doubles; never connects to the live
database, calls a model, extracts an archive, or executes uploaded source code.
"""
from datetime import datetime, timezone
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4
import zipfile

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.dialects import postgresql

from app.api.endpoints.admin import users
from app.api.endpoints.admin.auth import _create_admin_token
from app.api.endpoints.auth import create_access_token
from app.db.postgres import get_db
from app.services import student_artifacts as service


def zipped(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value)
    return output.getvalue()


def message(text, role='user', entry='entry-1', **extra):
    return json.dumps({'id': entry, 'timestamp': '2026-10-22T08:00:00Z',
                       'type': 'message', 'message': {'role': role, 'content': text}, **extra}, ensure_ascii=False)


def work(**extra):
    return zipped({'manifest.json': '{"sfls":{}}',
                   'project/main.py': 'snake = [(1, 1)]\nsnake.insert(0, (2, 1))\n',
                   'project/README.md': '# 贪吃蛇\n用列表保存蛇身，每次在头部插入坐标。',
                   'evidence/events.jsonl': '{"type":"request_settled","elapsed_ms":1000}\n',
                   'evidence/sessions/demo.jsonl': message('蛇身用列表。') + '\n' +
                       message([{'type': 'text', 'text': '请尝试先写移动一格的代码。'},
                                {'type': 'thinking', 'thinking': 'PRIVATE_REASONING_NOT_FOR_UI'},
                                {'type': 'toolCall', 'name': 'write', 'arguments': {'hidden': True}}],
                               role='assistant', entry='entry-2') + '\n' +
                       message('TOOL_OUTPUT_NOT_FOR_UI', role='toolResult', entry='entry-3') + '\n',
                   **extra})


def test_real_offline_records_are_visible_without_any_online_chat():
    data = work()
    original = bytes(data)
    result = service.preview_archive(data)
    assert result['code_files'][0]['text'].startswith('snake = ')
    assert result['readme']['text'].startswith('# 贪吃蛇')
    assert result['readme']['is_template'] is False
    assert [(row['role'], row['text']) for row in result['messages']] == [
        ('user', '蛇身用列表。'), ('assistant', '请尝试先写移动一格的代码。')]
    assert result['messages'][0]['at'] == '2026-10-22T08:00:00Z'
    assert result['messages'][0]['line'] == 1
    assert result['evidence']['has_events'] and result['evidence']['has_sessions']
    assert result['evidence']['message_count'] == 2
    assert 'PRIVATE_REASONING' not in str(result) and 'TOOL_OUTPUT' not in str(result)
    assert data == original  # No normalization or write-back of the original.
    assert result['source'] == 'uploaded_local_records_not_mastery_or_execution_attestation'


def test_corrupt_deflate_returns_warning_without_breaking_student_detail():
    original = work()
    with zipfile.ZipFile(io.BytesIO(original)) as archive:
        offset = archive.getinfo('project/main.py').header_offset
    name_length = int.from_bytes(original[offset + 26:offset + 28], 'little')
    extra_length = int.from_bytes(original[offset + 28:offset + 30], 'little')
    compressed_offset = offset + 30 + name_length + extra_length
    damaged = bytearray(original)
    damaged[compressed_offset] = 0xff  # Invalid DEFLATE block type, not valid source code.
    data = bytes(damaged)
    result = service.preview_archive(data)
    assert result['code_files'] == [] and result['messages'] == []
    assert any('无法安全在线预览' in warning for warning in result['warnings'])
    assert bytes(damaged) == data


def test_template_readme_is_flagged_without_hiding_received_code():
    result = service.preview_archive(work(**{'project/README.md':
        '# 我的作品\n想解决的问题或实现的效果。\n需要哪些功能？怎样算完成？\n启动方式与按键。'}))
    assert result['readme']['is_template']
    assert result['evidence']['code_file_count'] == 1
    assert any('初始模板' in value for value in result['warnings'])


def test_legacy_missing_evidence_is_explicit_not_a_fabricated_empty_chat():
    result = service.preview_archive(zipped({'project/main.py': 'print("ok")'}))
    assert result['readme'] is None and result['messages'] == []
    assert not result['evidence']['has_events'] and not result['evidence']['has_sessions']
    assert any('README' in value for value in result['warnings'])
    assert any('events.jsonl' in value for value in result['warnings'])
    assert any('对话文件' in value for value in result['warnings'])


@pytest.mark.parametrize('raw', [None, b'', b'not-a-zip', b'PK\x03\x04corrupt'])
def test_missing_or_bad_archive_returns_a_warning_not_an_exception(raw):
    result = service.preview_archive(raw)
    assert result['warnings'] and result['messages'] == [] and result['code_files'] == []


@pytest.mark.parametrize('name', ['../project/main.py', '/project/main.py', 'project\\evil.py',
                                  'project/C:evil.py', 'project/\x01main.py'])
def test_unsafe_paths_are_never_shown(name):
    result = service.preview_archive(zipped({name: 'SHOULD_NOT_BE_SHOWN'}))
    assert 'SHOULD_NOT_BE_SHOWN' not in str(result)
    assert any('无法安全' in value for value in result['warnings'])


def test_credentials_private_folders_and_non_source_files_are_not_previewed():
    result = service.preview_archive(work(**{
        'project/.env': 'password=NEVER_DISPLAY',
        'project/.sfls/auth.json': '{"key":"NEVER_DISPLAY"}',
        'project/node_modules/module.js': 'NEVER_DISPLAY',
        'project/private.pem': 'NEVER_DISPLAY',
        'evidence/sessions/raw.bin': 'NEVER_DISPLAY',
        'project/picture.png': 'NEVER_DISPLAY'}))
    assert [row['path'] for row in result['code_files']] == ['project/main.py']
    assert 'NEVER_DISPLAY' not in str(result)


def test_mistaken_secrets_in_source_readme_chat_and_paths_are_masked():
    key = 'sk-' + 'syntheticneverissuedcredential' * 2
    token = 'syntheticbearertokenneverissued' * 2
    password = 'synthetic_student_password'
    result = service.preview_archive(work(**{
        'project/main.py': f'API_KEY="{key}"\npassword="{password}"',
        'project/README.md': 'Bearer ' + token,
        'project/' + key + '.py': '# source',
        'evidence/sessions/demo.jsonl': message(json.dumps({'api_key': key, 'password': password}))}))
    assert key not in str(result) and token not in str(result) and password not in str(result)
    assert 'REDACTED' in str(result)


def test_incomplete_private_key_is_withheld_not_partially_leaked():
    result = service.preview_archive(work(**{'project/README.md':
        '-----BEGIN PRIVATE KEY-----\nNEVER_DISPLAY_THIS_PRIVATE_BODY'}))
    assert 'NEVER_DISPLAY_THIS_PRIVATE_BODY' not in str(result)
    assert '已隐藏' in result['readme']['text']


def test_repeated_message_ids_are_deduplicated_but_equal_student_text_is_not():
    first = message('不会。', entry='entry-a')
    result = service.preview_archive(work(**{
        'evidence/sessions/demo.jsonl': first + '\n' + message('不会。', entry='entry-b'),
        'evidence/sessions/copy.jsonl': first}))
    assert result['evidence']['message_count'] == 2
    assert len(result['messages']) == 2


def test_long_source_and_chat_are_capped_with_explicit_selection_and_omission():
    rows = '\n'.join(message('我先写一个坐标。' * 100, entry=str(index)) for index in range(260))
    result = service.preview_archive(work(**{'project/main.py': '#' * 150000,
                                            'evidence/sessions/demo.jsonl': rows}))
    assert result['code_files'][0]['truncated']
    assert len(result['code_files'][0]['text']) == service.MAX_CODE_CHARS
    assert result['evidence']['message_count'] == 260
    assert len(result['messages']) <= service.MAX_MESSAGES
    assert sum(len(row['text']) for row in result['messages']) <= service.MAX_TOTAL_MESSAGE_CHARS
    assert result['evidence']['omitted_message_count'] == 260 - len(result['messages'])
    assert result['evidence']['message_selection'].startswith('first_visible')
    assert result['evidence']['truncated']
    assert any('在线预览已截取' in value for value in result['warnings'])


def test_too_many_code_files_and_oversize_log_line_are_explicit():
    result = service.preview_archive(work(**{
        **{f'project/extra_{index}.py': '# source' for index in range(20)},
        'evidence/sessions/demo.jsonl': message('x' * (service.MAX_LINE_BYTES + 100))}))
    assert result['evidence']['code_file_count'] == 21
    assert len(result['code_files']) == service.MAX_CODE_FILES
    assert result['evidence']['truncated'] and result['evidence']['message_count_is_lower_bound']


def test_binary_and_invalid_json_do_not_hide_valid_later_messages():
    result = service.preview_archive(work(**{
        'project/binary.py': b'\x00\x00\xff\xff',
        'evidence/sessions/demo.jsonl': 'invalid\n' + message('这条有效。')}))
    assert result['messages'][0]['text'] == '这条有效。'
    assert len(result['code_files']) == 1
    assert result['warnings']


def test_archive_count_and_expansion_budgets_fail_closed():
    result = service.preview_archive(zipped({f'project/{index}.py': '#' for index in range(501)}))
    assert result['code_files'] == [] and result['warnings']
    result = service.preview_archive(b'x' * (service.MAX_ARCHIVE_BYTES + 1))
    assert result['code_files'] == [] and any('上限' in value for value in result['warnings'])


class MappingRows:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def one_or_none(self):
        assert len(self.rows) <= 1
        return self.rows[0] if self.rows else None


@pytest.fixture
async def artifact_http():
    admin = SimpleNamespace(id=uuid4(), role='admin', is_active=True, auth_version=0)
    student, stranger, receipt = uuid4(), uuid4(), uuid4()
    at = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)
    row = {'receipt_id': receipt, 'material_id': uuid4(), 'task_title': '第一课贪吃蛇',
           'task_kind': 'sfls', 'created_at': at, 'size': 1234, 'sha256': 'a' * 64,
           'detail': {'task_validation': {'status': 'matched'}}, 'content': work()}
    statements = []

    async def scalar(statement):
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
        statements.append(sql)
        return 1 if 'count(' in sql else student

    async def execute(statement):
        sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))
        statements.append(sql)
        assert "classroom_material_receipts.kind = 'submission'" in sql
        if str(stranger) in sql:
            return MappingRows([])
        assert str(student) in sql
        if 'classroom_material_receipts.content' in sql:
            assert str(receipt) in sql
            return MappingRows([row])
        return MappingRows([{key: value for key, value in row.items() if key != 'content'}])

    db = SimpleNamespace(scalar=AsyncMock(side_effect=scalar), execute=AsyncMock(side_effect=execute),
                         get=AsyncMock(return_value=admin))
    app = FastAPI()
    app.include_router(users.router, prefix='/api/admin')
    app.dependency_overrides[get_db] = lambda: db
    headers = {'Authorization': 'Bearer ' + _create_admin_token(str(admin.id))}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        yield SimpleNamespace(client=client, db=db, admin=admin, student=student, stranger=stranger,
                              receipt=receipt, row=row, statements=statements, headers=headers,
                              prefix=f'/api/admin/users/{student}/artifacts')


@pytest.mark.asyncio
async def test_list_is_metadata_only_and_supports_students_without_web_messages(artifact_http):
    t = artifact_http
    response = await t.client.get(t.prefix + '?page=2&page_size=10', headers=t.headers)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    data = response.json()['data']
    assert data['total'] == 1 and data['page'] == 2 and data['page_size'] == 10
    assert data['items'][0]['receipt_id'] == str(t.receipt)
    assert data['items'][0]['task_title'] == '第一课贪吃蛇'
    assert data['items'][0]['download_url'].endswith(f'/receipts/{t.receipt}/file')
    assert all('classroom_material_receipts.content' not in sql for sql in t.statements)
    assert 'LIMIT 10 OFFSET 10' in t.statements[-1]
    assert 'chat_messages' not in t.statements[-1]


@pytest.mark.asyncio
async def test_detail_binds_submission_to_student_and_does_not_execute_source(artifact_http):
    t = artifact_http
    t.row['content'] = work(**{'project/main.py': 'raise RuntimeError("NEVER_EXECUTE_UPLOADED_CODE")'})
    response = await t.client.get(t.prefix + '/' + str(t.receipt), headers=t.headers)
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    data = response.json()['data']
    assert 'NEVER_EXECUTE_UPLOADED_CODE' in data['code_files'][0]['text']
    assert data['messages'][0]['role'] == 'user'
    assert data['task_validation_status'] == 'matched'
    assert len(t.statements) == 1


@pytest.mark.asyncio
async def test_other_student_receipt_is_not_accessible_under_wrong_student_path(artifact_http):
    t = artifact_http
    response = await t.client.get(f'/api/admin/users/{t.stranger}/artifacts/{t.receipt}', headers=t.headers)
    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize('suffix', ['', '/00000000-0000-4000-8000-000000000000'])
async def test_anonymous_and_student_tokens_cannot_read_any_offline_evidence(artifact_http, suffix):
    t = artifact_http
    assert (await t.client.get(t.prefix + suffix)).status_code == 401
    headers = {'Authorization': 'Bearer ' + create_access_token(str(t.student))}
    assert (await t.client.get(t.prefix + suffix, headers=headers)).status_code == 403
    assert not t.statements


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['disabled', 'demoted', 'revoked'])
async def test_admin_is_revalidated_at_request_time(artifact_http, state):
    t = artifact_http
    if state == 'disabled':
        t.admin.is_active = False
    elif state == 'demoted':
        t.admin.role = 'learner'
    else:
        t.admin.auth_version = 1
    response = await t.client.get(t.prefix, headers=t.headers)
    assert response.status_code in (401, 403)
    assert not t.statements


@pytest.mark.asyncio
async def test_invalid_pagination_and_uuid_are_rejected_before_data_query(artifact_http):
    t = artifact_http
    for query in ('?page=0', '?page_size=51', '?page_size=0'):
        assert (await t.client.get(t.prefix + query, headers=t.headers)).status_code == 422
    assert (await t.client.get(t.prefix + '/not-a-uuid', headers=t.headers)).status_code == 422
    assert not t.statements


@pytest.mark.asyncio
async def test_bad_historical_archive_keeps_a_readable_receipt_and_download_link(artifact_http):
    t = artifact_http
    t.row['content'] = b'broken historical file'
    response = await t.client.get(t.prefix + '/' + str(t.receipt), headers=t.headers)
    assert response.status_code == 200
    data = response.json()['data']
    assert data['receipt_id'] == str(t.receipt) and data['warnings']
    assert data['download_url'] and not data['code_files']
