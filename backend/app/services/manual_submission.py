"""Bounded, in-memory recovery of manually zipped SFLS work.

The returned archive is a labelled server-transformed copy, not an attestation of
local execution. The caller must still authenticate the user and look up the
download receipt named in the returned manifest before storing this copy.
"""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import PurePosixPath
import re
import stat
import unicodedata
from uuid import UUID
import zipfile

from fastapi import HTTPException

from app.services.classroom_files import inspect_zip, SECRET_NAMES
from app.services.sfls_package import previous_project

MAX_INPUT = 50 * 1024 * 1024
MAX_EXPANDED = 300 * 1024 * 1024
MAX_MEMBERS = 20000
MAX_RETAINED_FILES = 495
MAX_RETAINED_BYTES = 29 * 1024 * 1024
MAX_OUTPUT = 10 * 1024 * 1024
MAX_JSON_DEPTH = 64
SOURCE = 'server_manual_import_not_execution_attestation'
_HEX = re.compile(r'^[a-f0-9]{64}$')
_KEY = re.compile(r'sk-[A-Za-z0-9_-]{20,}')
_BEARER = re.compile(r'(?i)(\bBearer[ \t]+)([A-Za-z0-9._~+/=-]{20,})')
_FIELD_KEY = re.compile(r'''(?i)((?:(?:\\*["'])?(?:api[_-]?key|secret[_-]?key|access[_-]?token)(?:\\*["'])?\s*[:=]\s*(?:\\*["'])?|(?:\\*["'])key(?:\\*["'])\s*:\s*(?:\\*["'])))([A-Za-z0-9._~+/=-]{20,})''')
_PEM = re.compile(r'-----BEGIN ([A-Z ]*PRIVATE KEY)-----.*?-----END \1-----', re.S)
_PEM_START = re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----')
_SECRET_BYTES = re.compile(rb'sk-[A-Za-z0-9_-]{20,}|(?i:Bearer[ \t]+[A-Za-z0-9._~+/=-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY-----')
_SKIP_DIRS = {'.sfls', '.sfls-runtime', '.git', 'node_modules', '.venv', 'venv',
              'env', '__pycache__', '.pytest_cache', '.mypy_cache', 'dist', 'build'}
_CREDENTIALS = set(SECRET_NAMES) | {'auth.json', 'credentials.json', '.pypirc',
                                     '.netrc', '.npmrc', 'id_ecdsa', 'id_dsa'}


def _fail(message):
    raise HTTPException(422, '手工压缩包未接收：' + message)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    # SFLS snapshot IDs use JavaScript JSON.stringify (UTF-8, no whitespace).
    try:
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (ValueError, UnicodeError, TypeError, RecursionError):
        _fail('JSON 内容或字符编码不受支持')


def _parse_json(data):
    def constant(_value):
        raise ValueError('non-finite JSON number')
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('duplicate JSON property')
            value[key] = item
        return value
    value = json.loads(data, parse_constant=constant, object_pairs_hook=pairs)
    # The JSON decoder can accept deeper trees than later Python transforms.
    # Bound depth iteratively before any recursive snapshot-reference rewrite.
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            raise ValueError('JSON nesting exceeds safe depth')
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
    return value


def _load(data, what):
    if len(data) > 100000:
        _fail(what + '过大')
    try:
        value = _parse_json(data)
    except (ValueError, UnicodeError, RecursionError):
        _fail(what + '不是有效 JSON')
    if not isinstance(value, dict):
        _fail(what + '格式错误')
    return value


def _safe_path(info):
    name = info.filename
    trimmed = name[:-1] if info.is_dir() else name
    parts = trimmed.split('/')
    if (not trimmed or len(name.encode('utf-8')) > 4096 or name.startswith('/')
            or any(part in ('', '.', '..') for part in parts)
            or any(unicodedata.category(character) in ('Cc', 'Cf') for character in name)
            or '\\' in name or ':' in name or _SECRET_BYTES.search(name.encode('utf-8'))):
        _fail('包含不安全路径')
    return trimmed


def _safe_member(info):
    mode = info.external_attr >> 16
    if info.flag_bits & 1 or stat.S_ISLNK(mode):
        _fail('保留的作品包含链接或加密文件')
    if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
        _fail('保留的作品包含不支持的特殊文件')


def _mac_junk(name):
    return any(part == '__MACOSX' or part == '.DS_Store' or part.startswith('._')
               for part in name.split('/'))


def _excluded(name):
    parts = name.lower().split('/')
    if parts[0] == 'submissions' or any(part in _SKIP_DIRS for part in parts):
        return True
    return any(part in _CREDENTIALS or part.startswith('.env') or part.endswith(('.pem', '.key', '.p12', '.pfx'))
               for part in parts)


def _redact(data):
    content = None
    # Text copied from Windows applications may use BOM-labelled UTF-16/32.
    # A changed copy is transcoded to UTF-8 so JSONL remains safely indexable.
    for bom, encoding in ((b'\xff\xfe\x00\x00', 'utf-32'), (b'\x00\x00\xfe\xff', 'utf-32'),
                          (b'\xff\xfe', 'utf-16'), (b'\xfe\xff', 'utf-16')):
        if data.startswith(bom):
            try:
                content = data.decode(encoding)
            except UnicodeError:
                _fail('带编码标记的文本损坏，无法安全脱敏')
            break
    try:
        if content is None:
            content = data.decode('utf-8')
    except UnicodeError:
        flattened = data.replace(b'\x00', b'')
        if (_SECRET_BYTES.search(data) or _SECRET_BYTES.search(flattened)
                or _FIELD_KEY.search(flattened.decode('latin1'))):
            _fail('二进制文件疑似含密钥，无法安全脱敏，请联系老师处理原件')
        return data, 0
    # Unlabelled NUL-interleaved data is not safe to reinterpret as text.
    if '\x00' in content:
        flattened = data.replace(b'\x00', b'')
        if _SECRET_BYTES.search(flattened) or _FIELD_KEY.search(flattened.decode('latin1')):
            _fail('二进制文件疑似含密钥，无法安全脱敏，请联系老师处理原件')
    content, pem_count = _PEM.subn('[REDACTED_PRIVATE_KEY]', content)
    if _PEM_START.search(content):
        # Never remove just a header and leave the private key body behind.
        _fail('含不完整的私钥块，无法安全脱敏，请联系老师处理原件')
    content, key_count = _KEY.subn('[REDACTED_API_KEY]', content)
    content, bearer_count = _BEARER.subn(lambda match: match[1] + '[REDACTED_TOKEN]', content)
    content, field_count = _FIELD_KEY.subn(lambda match: match[1] + '[REDACTED_TOKEN]', content)
    count = pem_count + key_count + bearer_count + field_count
    return (content.encode('utf-8') if count else data), count


def _binding(task, manifest, *, user_id, material_id, project_id):
    if task.get('schema') != 'sfls-task/1' or task.get('project_id') != project_id or task.get('task_id') != material_id:
        _fail('任务或课程标记不匹配，请使用本人从本任务下载的完整文件夹')
    if 'support' in task and not isinstance(task['support'], dict):
        _fail('任务支架配置格式错误')
    binding = task.get('platform')
    if not isinstance(binding, dict) or any(binding.get(key) != value for key, value in
            {'user_id': user_id, 'material_id': material_id}.items()):
        _fail('学生或任务绑定不匹配，请使用本人下载的文件夹')
    download = binding.get('download_id')
    try:
        if not isinstance(download, str) or str(UUID(download)) != download:
            raise ValueError()
    except (ValueError, AttributeError):
        _fail('缺少有效的平台下载编号，不能代造学生身份')
    if manifest is not None and any(manifest.get(key) != binding.get(key) for key in
                                    ('user_id', 'material_id', 'download_id')):
        _fail('作品清单与任务身份绑定不一致')


def _replace_snapshot_refs(value, mapping):
    if isinstance(value, dict):
        return {key: mapping.get(item, item) if key == 'snapshot_id' and isinstance(item, str)
                else _replace_snapshot_refs(item, mapping) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_snapshot_refs(item, mapping) for item in value]
    return value


def _rewrite_events(data, mapping):
    if not mapping:
        return data
    output = []
    for line in data.split(b'\n'):
        suffix = b'\r' if line.endswith(b'\r') else b''
        raw = line[:-1] if suffix else line
        try:
            value = _parse_json(raw)
        except (ValueError, UnicodeError, RecursionError):
            output.append(line)
            continue
        updated = _replace_snapshot_refs(value, mapping)
        output.append(_json(updated) + suffix if updated != value else line)
    return b'\n'.join(output)


def _zip(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.create_system = 3
            archive.writestr(info, files[name])
    return output.getvalue()


def normalize_manual_submission(data: bytes, *, user_id: str, material_id: str,
                                project_id: str) -> tuple[bytes, dict]:
    """Accept a standard pack or one whole task directory, without disk extraction.

    The download UUID is validated syntactically here. The authenticated endpoint
    must verify that it names an actual download owned by this user/material.
    """
    if not data or len(data) > MAX_INPUT:
        _fail('压缩包为空或超过 50 MiB，请不要打包安装环境')
    original_sha = _sha(data)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_MEMBERS or sum(info.file_size for info in infos) > MAX_EXPANDED:
                _fail('展开后超过 300 MiB 或 20000 个成员，请不要打包环境')
            names = {}
            ignored = 0
            seen = set()
            for info in infos:
                name = _safe_path(info)
                if name in seen:
                    _fail('存在重复文件或目录路径')
                seen.add(name)
                # A whole task may include a Python venv with symlinks. These
                # excluded entries are never opened or copied, only counted.
                skip = _excluded(name) or 'submissions' in name.lower().split('/') or _mac_junk(name)
                if not skip:
                    _safe_member(info)
                if not info.is_dir() and _mac_junk(name):
                    ignored += 1
                if not info.is_dir() and not _mac_junk(name):
                    names[name] = info
            metadata = [name for name in names if PurePosixPath(name).name == 'sfls-task.json'
                        and not _excluded(name) and 'submissions' not in name.lower().split('/')]
            # A project's web-app manifest is not an SFLS task manifest.
            for name, info in names.items():
                if (PurePosixPath(name).name != 'manifest.json' or _excluded(name)
                        or 'submissions' in name.lower().split('/') or info.file_size > 100000):
                    continue
                try:
                    candidate = _parse_json(archive.read(info))
                except (ValueError, UnicodeError, RecursionError):
                    continue
                if isinstance(candidate, dict) and candidate.get('schema') == 'cognisync-local/1':
                    metadata.append(name)
            roots = {str(PurePosixPath(name).parent) for name in metadata}
            if not roots:
                _fail('缺少 sfls-task.json 或标准作品清单，请压缩完整任务文件夹')
            if len(roots) != 1:
                _fail('包含多个或嵌套任务，请只压缩一个人的一个任务文件夹')
            root = next(iter(roots))
            if root == '.':
                prefix = ''
            elif '/' not in root:
                prefix = root + '/'
            else:
                _fail('任务目录嵌套过深，请只压缩完整任务文件夹')
            if any(not name.startswith(prefix) for name in names):
                _fail('包含多个根目录，请只压缩一个任务文件夹')
            relative = {name[len(prefix):]: info for name, info in names.items()}
            def metadata_read(name, label):
                if relative[name].file_size > 100000:
                    _fail(label + '过大')
                return _load(archive.read(relative[name]), label)
            original_manifest = metadata_read('manifest.json', '作品清单') if 'manifest.json' in relative else None
            if original_manifest is not None:
                if original_manifest.get('schema') != 'cognisync-local/1' or not isinstance(original_manifest.get('sfls'), dict):
                    _fail('不是标准 SFLS 作品清单')
                task = original_manifest['sfls'].get('task')
                if not isinstance(task, dict):
                    _fail('作品清单缺少任务信息')
            else:
                task = metadata_read('sfls-task.json', '任务信息')
            if 'sfls-task.json' in relative:
                raw_task = metadata_read('sfls-task.json', '任务信息')
                if raw_task != task:
                    _fail('文件夹与作品清单的任务信息不一致')
            _binding(task, original_manifest, user_id=str(user_id), material_id=str(material_id), project_id=str(project_id))

            files = {}
            excluded = ignored
            total = 0
            for name, info in relative.items():
                if name in ('manifest.json', 'sfls-task.json'):
                    continue
                if _excluded(name) or name.split('/')[0] not in ('project', 'evidence', 'materials', 'design'):
                    excluded += 1
                    continue
                target = 'evidence/context/' + name if name.startswith(('materials/', 'design/')) else name
                if target in files:
                    _fail('归一化后文件路径冲突')
                total += info.file_size
                if len(files) >= MAX_RETAINED_FILES or total > MAX_RETAINED_BYTES:
                    _fail('作品与证据超过 495 个文件或 29 MiB，请联系老师保留原件处理')
                content = archive.read(info)
                if len(content) != info.file_size:
                    _fail('压缩包文件长度不一致')
                files[target] = content

            if original_manifest is not None:
                entries = original_manifest.get('files')
                if not isinstance(entries, list) or len(entries) > MAX_MEMBERS:
                    _fail('作品清单缺少文件校验列表')
                checks = {}
                for entry in entries:
                    if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or entry['path'] in checks:
                        _fail('作品文件校验清单格式错误或路径重复')
                    checks[entry['path']] = entry
                original_selected = {name: info for name, info in relative.items() if name != 'manifest.json'}
                # An exported pack may not silently omit or add unlisted files.
                if set(checks) != set(original_selected):
                    _fail('作品文件清单与压缩包内容不一致')
                for name, info in original_selected.items():
                    if _excluded(name):
                        continue  # Never load excluded credentials/dependencies into the retained copy.
                    content = archive.read(info)
                    if checks[name].get('size') != len(content) or checks[name].get('sha256') != _sha(content):
                        _fail('作品文件校验失败，请保留原件联系老师')
    except HTTPException:
        raise
    except (ValueError, KeyError, OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, UnicodeError, RecursionError) as error:
        raise HTTPException(422, '手工压缩包未接收：压缩包损坏或格式不受支持') from error

    if not any(name.startswith('project/') for name in files):
        _fail('没有找到 project 工程文件，请压缩完整任务文件夹')
    if 'evidence/import/server-import.json' in files:
        _fail('请提交本机原始任务文件夹，不要再次打包服务器归一化副本')
    redactions = []
    blob_map = {}
    blob_sizes = {}
    updated = {}
    for name, content in files.items():
        scrubbed, count = _redact(content)
        target = name
        if name.startswith('evidence/blobs/'):
            old_hash = name[len('evidence/blobs/'):]
            if not _HEX.fullmatch(old_hash) or _sha(content) != old_hash:
                _fail('代码快照 blob 的内容校验失败')
            new_hash = _sha(scrubbed)
            if new_hash != old_hash:
                blob_map[old_hash] = new_hash
                blob_sizes[old_hash] = len(scrubbed)
                target = 'evidence/blobs/' + new_hash
        if count:
            redactions.append({'path': name, 'replacements': count})
        if target in updated and updated[target] != scrubbed:
            _fail('脱敏后文件路径冲突')
        updated[target] = scrubbed
    files = updated
    snapshot_map = {}
    updated = {}
    for name, content in files.items():
        target = name
        if name.startswith('evidence/snapshots/'):
            old_id = name[len('evidence/snapshots/'):].removesuffix('.json')
            snapshot = _load(content, '代码快照')
            entries = snapshot.get('files')
            if (not name.endswith('.json') or not _HEX.fullmatch(old_id) or snapshot.get('id') != old_id
                    or snapshot.get('schema') != 'sfls-snapshot/1' or not isinstance(entries, list)):
                _fail('代码快照格式错误')
            changed = False
            for entry in entries:
                if (not isinstance(entry, dict) or not isinstance(entry.get('path'), str)
                        or not isinstance(entry.get('sha256'), str) or not _HEX.fullmatch(entry['sha256'])
                        or type(entry.get('size')) is not int or entry['size'] < 0):
                    _fail('代码快照文件列表格式错误')
                old_hash = entry['sha256']
                if old_hash in blob_map:
                    entry['sha256'] = blob_map[old_hash]
                    entry['size'] = blob_sizes[old_hash]
                    changed = True
                blob = files.get('evidence/blobs/' + entry['sha256'])
                if blob is None or len(blob) != entry['size']:
                    _fail('代码快照缺少对应 blob 或大小不一致')
            new_id = _sha(_json(entries))
            if changed or new_id != old_id:
                snapshot['id'] = new_id
                snapshot_map[old_id] = new_id
                target = 'evidence/snapshots/' + new_id + '.json'
                content = _json(snapshot)
        if target in updated and updated[target] != content:
            _fail('归一化后快照路径冲突')
        updated[target] = content
    files = updated
    if 'evidence/events.jsonl' in files:
        files['evidence/events.jsonl'] = _rewrite_events(files['evidence/events.jsonl'], snapshot_map)

    presence = {'code': any(name.startswith('project/') and name.lower().endswith(('.py', '.js', '.ts')) for name in files),
                'events': bool(files.get('evidence/events.jsonl')),
                'sessions': any(name.startswith('evidence/sessions/') and name.endswith('.jsonl') and value
                                for name, value in files.items())}
    detail = {'schema': 'sfls-manual-import/1', 'source': SOURCE,
              'original_archive_sha256': original_sha, 'excluded_file_count': excluded,
              'redaction_count': sum(item['replacements'] for item in redactions),
              'redactions': sorted(redactions, key=lambda item: item['path']),
              'blob_sha256_map': dict(sorted(blob_map.items())), 'snapshot_id_map': dict(sorted(snapshot_map.items())),
              'evidence_presence': presence}
    # Preserve a genuinely clean standard pack, including its ZIP bytes/times.
    manifest_sensitive = _redact(_json(original_manifest))[1] if original_manifest is not None else 0
    unchanged = (original_manifest is not None and not prefix and not excluded and not redactions and not manifest_sensitive
                 and not blob_map and not snapshot_map and set(relative) == {'manifest.json', *files})
    if unchanged:
        if len(data) > MAX_OUTPUT:
            _fail('作品压缩包超过 10 MiB，请联系老师处理')
        inspect_zip(data, {'schema': 'cognisync-local/1', 'user_id': str(user_id), 'material_id': str(material_id)})
        previous_project(data, str(user_id), str(project_id), str(material_id))
        return data, {**detail, 'transformation': 'none_original_standard_pack'}

    detail['transformation'] = 'server_transformed_copy'
    files['evidence/import/server-import.json'] = _json(detail)
    if original_manifest is not None:
        manifest = dict(original_manifest)
        manifest['sfls'] = dict(original_manifest['sfls'])
    else:
        manifest = {'schema': 'cognisync-local/1', **task['platform'],
                    'platform': 'manual', 'sfls': {'task': task,
                    'policy_version': task.get('support', {}).get('policy_version')}}
    manifest['sfls'] = _replace_snapshot_refs(manifest['sfls'], snapshot_map)
    manifest['manual_import'] = {'schema': detail['schema'], 'source': SOURCE,
                                 'original_archive_sha256': original_sha,
                                 'record_path': 'evidence/import/server-import.json'}
    manifest['files'] = [{'path': name, 'sha256': _sha(value), 'size': len(value)}
                         for name, value in sorted(files.items())]
    manifest_bytes, manifest_redactions = _redact(_json(manifest))
    if manifest_redactions:
        # Manifest metadata can contain model context or student-entered titles.
        detail['manifest_redactions'] = manifest_redactions
        detail['redaction_count'] += manifest_redactions
        files['evidence/import/server-import.json'] = _json(detail)
        manifest['files'] = [{'path': name, 'sha256': _sha(value), 'size': len(value)}
                             for name, value in sorted(files.items())]
        manifest_bytes, _ = _redact(_json(manifest))
    files['manifest.json'] = manifest_bytes
    if (len(manifest_bytes) > 100000 or len(files) > MAX_RETAINED_FILES
            or sum(map(len, files.values())) > MAX_RETAINED_BYTES):
        _fail('归一化后的作品与证据超过平台上限，请联系老师保留原件处理')
    output = _zip(files)
    if len(output) > MAX_OUTPUT:
        _fail('归一化后超过 10 MiB，请联系老师处理，不要删除原始证据')
    inspect_zip(output, {'schema': 'cognisync-local/1', 'user_id': str(user_id), 'material_id': str(material_id)})
    previous_project(output, str(user_id), str(project_id), str(material_id))
    return output, detail
