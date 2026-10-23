import hashlib
import io
import json
import stat
from uuid import uuid4
import zipfile

from fastapi import HTTPException
import pytest

from app.services import manual_submission as service
from app.services.classroom_files import inspect_zip
from app.services.sfls_package import previous_project

USER = str(uuid4())
MATERIAL = str(uuid4())
DOWNLOAD = str(uuid4())
PROJECT = 'snake-course'
KEY = 'sk-' + 'x' * 36


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def task():
    return {'schema': 'sfls-task/1', 'project_id': PROJECT, 'task_id': MATERIAL,
            'version': MATERIAL, 'phase': 'practice', 'support': {'mode': 'classroom', 'policy_version': 'policy/1'},
            'platform': {'user_id': USER, 'material_id': MATERIAL, 'download_id': DOWNLOAD,
                         'server': 'http://classroom.example'}}


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def unpack(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.testzip() is None
        return {name: archive.read(name) for name in archive.namelist()}


def raw_files():
    return {'sfls-task.json': encoded(task()), 'project/main.py': b'print("snake")\n',
            'evidence/events.jsonl': encoded({'at': '2026-10-22T09:01:02.123Z', 'elapsed_ms': 123,
                                               'type': 'request_started'}) + b'\n',
            'evidence/sessions/session.jsonl': encoded({'timestamp': '2026-10-22T09:01:03.456Z',
                'type': 'message', 'message': {'role': 'user', 'content': '让蛇移动'}}) + b'\n'}


def standard_pack(files=None, change_manifest=None):
    files = files or {name: content for name, content in raw_files().items() if name != 'sfls-task.json'}
    manifest = {'schema': 'cognisync-local/1', **task()['platform'], 'pi_version': '0.1', 'platform': 'windows',
                'sfls': {'version': '0.1.17', 'task': task(), 'policy_version': 'policy/1'},
                'files': [{'path': name, 'sha256': digest(content), 'size': len(content)} for name, content in files.items()]}
    if change_manifest:
        change_manifest(manifest)
    return zip_bytes({**files, 'manifest.json': encoded(manifest)})


def normalize(data):
    return service.normalize_manual_submission(data, user_id=USER, material_id=MATERIAL, project_id=PROJECT)


def assert_valid(data):
    inspect_zip(data, {'schema': 'cognisync-local/1', 'user_id': USER, 'material_id': MATERIAL})
    assert previous_project(data, USER, PROJECT, MATERIAL)
    files = unpack(data)
    manifest = json.loads(files['manifest.json'])
    entries = manifest['files']
    assert {item['path'] for item in entries} == set(files) - {'manifest.json'}
    for item in entries:
        assert item['sha256'] == digest(files[item['path']])
        assert item['size'] == len(files[item['path']])
    return files, manifest


def test_whole_folder_wrapper_excludes_environment_credentials_and_maps_context():
    files = raw_files() | {'materials/TASK.md': '做好贪吃蛇'.encode(), 'design/current/architecture.drawio': b'<mxfile/>',
                          '.sfls/task-access.json': encoded({'secret': KEY}), '.venv/lib/big.py': b'not retained',
                          'node_modules/pkg/a.js': b'not retained', 'submissions/old.zip': b'old zip',
                          'project/.env': KEY.encode(), 'project/auth.json': KEY.encode(),
                          'project/__pycache__/cache.pyc': b'cache', 'Start.cmd': b'launch'}
    files = {'我的任务/' + name: content for name, content in files.items()}
    files['__MACOSX/._我的任务'] = b'junk'
    output, detail = normalize(zip_bytes(files))
    retained, manifest = assert_valid(output)
    assert retained['evidence/context/materials/TASK.md'] == '做好贪吃蛇'.encode()
    assert retained['evidence/context/design/current/architecture.drawio'] == b'<mxfile/>'
    assert not any('.sfls' in name or 'node_modules' in name or 'submissions' in name for name in retained)
    assert detail['excluded_file_count'] == 9
    assert manifest['sfls']['task'] == task()
    assert detail['source'] == service.SOURCE
    assert detail['evidence_presence'] == {'code': True, 'events': True, 'sessions': True}
    assert KEY.encode() not in b''.join(retained.values())
    assert 'task-access' not in json.dumps(detail)


def test_clean_standard_pack_preserves_exact_bytes():
    original = standard_pack()
    output, detail = normalize(original)
    assert output == original
    assert detail['transformation'] == 'none_original_standard_pack'
    assert_valid(output)


def test_standard_pack_wrapper_is_normalized():
    original = unpack(standard_pack())
    output, detail = normalize(zip_bytes({'提交包/' + name: content for name, content in original.items()}))
    assert detail['transformation'] == 'server_transformed_copy'
    assert_valid(output)


def test_dialogue_redaction_preserves_time_roles_and_rest_of_message():
    files = raw_files()
    event = {'type': 'message', 'at': '2026-10-22T09:01:02.123Z', 'elapsed_ms': 12034,
             'duration_ms': 789, 'message': {'role': 'user', 'content': '密钥 ' + KEY + ' 我想让蛇向上移动'}}
    files['evidence/sessions/session.jsonl'] = encoded(event) + b'\n'
    output, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(output)
    actual = json.loads(retained['evidence/sessions/session.jsonl'])
    assert actual['at'] == event['at'] and actual['elapsed_ms'] == 12034 and actual['duration_ms'] == 789
    assert actual['message']['role'] == 'user'
    assert actual['message']['content'] == '密钥 [REDACTED_API_KEY] 我想让蛇向上移动'
    assert detail['redactions'] == [{'path': 'evidence/sessions/session.jsonl', 'replacements': 1}]
    assert retained['evidence/events.jsonl'] == files['evidence/events.jsonl']


def test_standard_pack_secret_is_redacted_not_rejected():
    files = {name: value for name, value in raw_files().items() if name != 'sfls-task.json'}
    files['evidence/sessions/session.jsonl'] = ('{"type":"message","at":"2026-10-22T09:00:00Z","text":"' + KEY + '"}\n').encode()
    output, detail = normalize(standard_pack(files))
    retained, _ = assert_valid(output)
    assert KEY.encode() not in b''.join(retained.values())
    assert detail['redactions'][0]['replacements'] == 1


def test_blob_snapshot_event_and_manifest_chain_is_rehashed():
    code = ('token = "' + KEY + '"\nprint("snake")\n').encode()
    old_hash = digest(code)
    entries = [{'path': 'project/main.py', 'sha256': old_hash, 'size': len(code)}]
    old_id = digest(encoded(entries))
    snapshot = {'schema': 'sfls-snapshot/1', 'id': old_id, 'files': entries}
    event = {'type': 'snapshot', 'snapshot_id': old_id, 'at': '2026-10-22T09:00:00Z', 'elapsed_ms': 555}
    files = {'project/main.py': code, 'evidence/blobs/' + old_hash: code,
             'evidence/snapshots/' + old_id + '.json': encoded(snapshot),
             'evidence/events.jsonl': encoded(event) + b'\r\n'}
    def change(manifest):
        manifest['sfls']['snapshot_id'] = old_id
    output, detail = normalize(standard_pack(files, change))
    retained, manifest = assert_valid(output)
    new_hash = digest(retained['project/main.py'])
    new_id = detail['snapshot_id_map'][old_id]
    assert detail['blob_sha256_map'] == {old_hash: new_hash}
    assert 'evidence/blobs/' + old_hash not in retained
    assert retained['evidence/blobs/' + new_hash] == retained['project/main.py']
    actual = json.loads(retained['evidence/snapshots/' + new_id + '.json'])
    assert actual['files'] == [{'path': 'project/main.py', 'sha256': new_hash, 'size': len(retained['project/main.py'])}]
    assert new_id == digest(encoded(actual['files'])) and actual['id'] == new_id
    actual_event = json.loads(retained['evidence/events.jsonl'])
    assert actual_event == {**event, 'snapshot_id': new_id}
    assert retained['evidence/events.jsonl'].endswith(b'\r\n')
    assert manifest['sfls']['snapshot_id'] == new_id


def test_bearer_and_complete_pem_are_redacted_including_body():
    files = raw_files()
    files['project/README.md'] = ("Bearer " + 'a' * 40 + '\n-----BEGIN RSA PRIVATE KEY-----\nVERY_PRIVATE_BODY\n-----END RSA PRIVATE KEY-----\nkeep this').encode()
    output, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(output)
    actual = retained['project/README.md'].decode()
    assert actual == 'Bearer [REDACTED_TOKEN]\n[REDACTED_PRIVATE_KEY]\nkeep this'
    assert sum(item['replacements'] for item in detail['redactions']) == 2


def test_escaped_pem_in_json_is_fully_redacted():
    files = raw_files()
    files['evidence/sessions/session.jsonl'] = encoded({'at': 'unchanged', 'text': '-----BEGIN PRIVATE KEY-----\nPRIVATEBODY\n-----END PRIVATE KEY-----'}) + b'\n'
    retained, _ = assert_valid(normalize(zip_bytes(files))[0])
    assert json.loads(retained['evidence/sessions/session.jsonl']) == {'at': 'unchanged', 'text': '[REDACTED_PRIVATE_KEY]'}


@pytest.mark.parametrize('payload', [b'\xff' + KEY.encode(), b'-----BEGIN PRIVATE KEY-----\nBODY'])
def test_unsafe_to_redact_binary_or_truncated_pem_is_rejected(payload):
    with pytest.raises(HTTPException) as error:
        normalize(zip_bytes(raw_files() | {'project/image.png': payload}))
    assert error.value.status_code == 422


@pytest.mark.parametrize('name', ['../outside.txt', '/absolute', 'project/../outside', 'project\\bad.py',
                                 'project/a\n.py', 'project//bad.py', 'C:/bad.py'])
def test_all_paths_checked_even_when_under_excluded_folders(name):
    with pytest.raises(HTTPException) as error:
        normalize(zip_bytes(raw_files() | {name: b'bad'}))
    assert error.value.status_code == 422


def test_duplicate_member_and_symlink_are_rejected():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('project/main.py', b'first')
        with pytest.warns(UserWarning):
            archive.writestr('project/main.py', b'second')
    with pytest.raises(HTTPException):
        normalize(output.getvalue())
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, value in raw_files().items():
            archive.writestr(name, value)
        info = zipfile.ZipInfo('project/link')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, '../other')
    with pytest.raises(HTTPException):
        normalize(output.getvalue())


@pytest.mark.parametrize('extra', [{'another/sfls-task.json': encoded(task())},
                                 {'project/nested/sfls-task.json': encoded(task())},
                                 {'other/project/main.py': b'other'}])
def test_multiple_roots_or_nested_tasks_rejected(extra):
    base = {'folder/' + name: value for name, value in raw_files().items()}
    with pytest.raises(HTTPException):
        normalize(zip_bytes(base | extra))


@pytest.mark.parametrize('key,value', [('user_id', str(uuid4())), ('material_id', str(uuid4())),
                                     ('download_id', 'not-a-uuid')])
def test_binding_mismatch_is_rejected(key, value):
    files = raw_files()
    changed = task()
    changed['platform'][key] = value
    files['sfls-task.json'] = encoded(changed)
    with pytest.raises(HTTPException) as error:
        normalize(zip_bytes(files))
    assert error.value.status_code == 422


def test_missing_task_and_wrong_project_rejected():
    with pytest.raises(HTTPException):
        normalize(zip_bytes({'project/main.py': b'print(1)'}))
    changed = task()
    changed['project_id'] = 'other'
    with pytest.raises(HTTPException):
        normalize(zip_bytes(raw_files() | {'sfls-task.json': encoded(changed)}))


def test_original_pack_hash_or_outer_binding_mismatch_rejected():
    original = unpack(standard_pack())
    original['project/main.py'] = b'changed without updating manifest'
    with pytest.raises(HTTPException):
        normalize(zip_bytes(original))
    def change(manifest):
        manifest['user_id'] = str(uuid4())
    with pytest.raises(HTTPException):
        normalize(standard_pack(change_manifest=change))


@pytest.mark.parametrize('setting,value', [('MAX_INPUT', 20), ('MAX_EXPANDED', 20), ('MAX_MEMBERS', 2),
                                         ('MAX_RETAINED_BYTES', 10), ('MAX_RETAINED_FILES', 2), ('MAX_OUTPUT', 20)])
def test_limits_are_enforced_without_dropping_evidence(monkeypatch, setting, value):
    monkeypatch.setattr(service, setting, value)
    with pytest.raises(HTTPException) as error:
        normalize(zip_bytes(raw_files()))
    assert error.value.status_code == 422


def test_repeated_normalization_of_same_request_is_byte_deterministic():
    original = zip_bytes(raw_files() | {'project/README.md': KEY.encode()})
    first, first_detail = normalize(original)
    second, second_detail = normalize(original)
    assert first == second and first_detail == second_detail


def test_manifest_secret_is_sanitized_and_import_record_hash_remains_correct():
    def change(manifest):
        manifest['sfls']['task']['title'] = '学生粘贴 ' + KEY
    output, detail = normalize(standard_pack(change_manifest=change))
    retained, manifest = assert_valid(output)
    assert KEY.encode() not in b''.join(retained.values())
    assert manifest['sfls']['task']['title'] == '学生粘贴 [REDACTED_API_KEY]'
    assert detail['manifest_redactions'] == 1


def test_standard_pack_with_mac_junk_is_not_returned_unsanitized():
    files = unpack(standard_pack())
    files['__MACOSX/._main.py'] = KEY.encode()
    output, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(output)
    assert detail['excluded_file_count'] == 1
    assert '__MACOSX/._main.py' not in retained


def test_environment_manifests_and_symlinks_are_skipped_but_web_manifest_is_retained():
    output = io.BytesIO()
    files = raw_files() | {'.sfls/environment/manifest.json': b'{"runtime":"python"}',
                          'node_modules/a/manifest.json': b'{"package":"ignored"}',
                          'project/assets/manifest.json': b'{"name":"Snake app"}'}
    with zipfile.ZipFile(output, 'w') as archive:
        for name, value in files.items():
            archive.writestr('任务/' + name, value)
        link = zipfile.ZipInfo('任务/.sfls/environment/bin/python')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, '/system/python')
    data, detail = normalize(output.getvalue())
    retained, _ = assert_valid(data)
    assert retained['project/assets/manifest.json'] == files['project/assets/manifest.json']
    assert detail['excluded_file_count'] == 3


@pytest.mark.parametrize('encoding', ['utf-16', 'utf-16-be', 'utf-32'])
def test_bom_labelled_unicode_chat_redacted(encoding):
    original = {'timestamp': '2026-10-22T09:00:00Z', 'role': 'user', 'content': '我的密钥 ' + KEY}
    raw = json.dumps(original, ensure_ascii=False).encode(encoding)
    if encoding == 'utf-16-be':
        raw = b'\xfe\xff' + raw
    files = raw_files() | {'evidence/sessions/win.jsonl': raw}
    data, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(data)
    actual = json.loads(retained['evidence/sessions/win.jsonl'])
    assert actual == {**original, 'content': '我的密钥 [REDACTED_API_KEY]'}
    assert detail['redaction_count'] == 1


def test_unlabelled_utf16_binary_with_secret_is_refused():
    with pytest.raises(HTTPException):
        normalize(zip_bytes(raw_files() | {'project/binary.dat': KEY.encode('utf-16-le')}))


def test_non_sk_key_fields_are_redacted_in_json_and_code():
    token = 'someOtherProvider1234567890abcdefgh'
    files = raw_files() | {'project/README.md': ('API_KEY="' + token + '"\n{"key":"' + token + '"}').encode()}
    output, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(output)
    assert token.encode() not in b''.join(retained.values())
    assert detail['redaction_count'] == 2


def test_secret_in_path_is_rejected_without_returning_secret():
    with pytest.raises(HTTPException) as error:
        normalize(zip_bytes(raw_files() | {'project/' + KEY + '.txt': b'unsafe'}))
    assert KEY not in str(error.value.detail)


@pytest.mark.parametrize('nesting', [1, 2, 3])
def test_api_key_inside_escaped_json_chat_is_redacted(nesting):
    token = 'otherProvider123456789abcdefghij'
    value = {'api_key': token, 'at': 'unchanged'}
    for _ in range(nesting):
        value = {'content': json.dumps(value)}
    files = raw_files() | {'evidence/sessions/nested.jsonl': encoded(value) + b'\n'}
    output, detail = normalize(zip_bytes(files))
    retained, _ = assert_valid(output)
    assert token.encode() not in b''.join(retained.values())
    assert detail['redaction_count'] == 1
    actual = json.loads(retained['evidence/sessions/nested.jsonl'])
    for _ in range(nesting):
        actual = json.loads(actual['content'])
    assert actual == {'api_key': '[REDACTED_TOKEN]', 'at': 'unchanged'}


@pytest.mark.parametrize('depth', [80, 200, 400])
@pytest.mark.parametrize('standard', [False, True])
def test_deep_task_context_returns_safe_422_not_recursion_500(depth, standard):
    value = {'text': 'PRIVATE_CONTEXT_NOT_IN_ERRORS'}
    for _ in range(depth):
        value = {'next': value}
    changed = task()
    changed['learning_context'] = value
    if standard:
        def change(manifest):
            manifest['sfls']['task'] = changed
        data = standard_pack(change_manifest=change)
    else:
        data = zip_bytes(raw_files() | {'sfls-task.json': encoded(changed)})
    with pytest.raises(HTTPException) as error:
        normalize(data)
    assert error.value.status_code == 422
    assert 'PRIVATE_CONTEXT_NOT_IN_ERRORS' not in str(error.value.detail)
