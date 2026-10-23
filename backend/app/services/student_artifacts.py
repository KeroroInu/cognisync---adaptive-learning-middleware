"""Bounded, read-only teacher views of immutable offline student submissions.

Do not confuse local message/event records with verified understanding, execution,
or effective learning time. Nothing here writes records or executes student code.
"""
from __future__ import annotations

import io
import json
from pathlib import PurePosixPath
import re
import stat
import zipfile
import zlib

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.sql import ClassroomMaterial, MaterialReceipt, User
from app.services.manual_submission import _redact
from app.services.research_package import offload

MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_MEMBERS = 500
MAX_EXPANDED_BYTES = 30 * 1024 * 1024
MAX_README_CHARS = 20000
MAX_CODE_FILES = 12
MAX_CODE_CHARS = 40000
MAX_TOTAL_CODE_CHARS = 120000
MAX_MESSAGES = 200
MAX_MESSAGE_CHARS = 6000
MAX_TOTAL_MESSAGE_CHARS = 100000
MAX_SESSION_FILES = 30
MAX_LOG_BYTES = 4 * 1024 * 1024
MAX_LINE_BYTES = 256 * 1024
MAX_SCANNED_LINES = 12000
SOURCE_SUFFIXES = {'.py', '.pyw', '.js', '.ts', '.tsx', '.jsx', '.html', '.css',
                   '.c', '.cpp', '.h', '.java', '.json', '.txt'}
PRIVATE_PARTS = {'.git', '.sfls', '.sfls-runtime', '.venv', 'venv', 'node_modules',
                 '__pycache__', '.env', 'auth.json', 'credentials.json', 'task-access.json'}
TEMPLATE_PHRASES = ('想解决的问题或实现的效果', '需要哪些功能？怎样算完成？',
                    '检查操作、预期、实际', '启动方式与按键', '未提供的内容不代填')


def _masked(value: str) -> str:
    """Reuse the recovery sanitizer; malformed private keys are never displayed."""
    try:
        text = _redact(value.encode('utf-8'))[0].decode('utf-8')
        return re.sub(r'''(?i)((?:\\*["'])?(?:password|passwd|密码)(?:\\*["'])?\s*[:=：]\s*(?:\\*["'])?)([^\s"'\\,;}]{1,200})''',
                      lambda match: match[1] + '[REDACTED_PASSWORD]', text)
    except (HTTPException, UnicodeError):
        return '[此段含无法安全预览的凭据信息，已隐藏]'


def _safe_path(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name and len(name) <= 1024 and not path.is_absolute()
                and '..' not in path.parts and '\\' not in name and ':' not in name
                and not any(ord(c) < 32 for c in name))


def _visible_project(name: str) -> bool:
    parts = PurePosixPath(name).parts
    return (len(parts) > 1 and parts[0] == 'project'
            and not any(part.lower() in PRIVATE_PARTS or part.startswith('.') for part in parts[1:])
            and not name.lower().endswith(('.pem', '.key', '.pfx', '.p12')))


def _metadata(row):
    detail = row['detail'] if isinstance(row['detail'], dict) else {}
    validation = detail.get('task_validation')
    receipt_id = str(row['receipt_id'])
    return {
        'receipt_id': receipt_id, 'material_id': str(row['material_id']),
        'task_title': _masked(str(row['task_title'] or '已归档任务')[:200]),
        'task_kind': row['task_kind'], 'created_at': row['created_at'],
        'filename': _masked(str(detail.get('filename') or f'submission-{receipt_id}.zip')[:200]),
        'size': row['size'], 'sha256': row['sha256'],
        'task_validation_status': (_masked(validation['status'][:100])
                                   if isinstance(validation, dict) and isinstance(validation.get('status'), str) else None),
        'manual_import': isinstance(detail.get('manual_import'), dict),
        'download_url': f'/api/admin/classroom/receipts/{receipt_id}/file',
    }


def _query(user_id):
    # Explicit columns are essential: a version list must never fetch every ZIP.
    return select(
        MaterialReceipt.id.label('receipt_id'), MaterialReceipt.material_id,
        MaterialReceipt.created_at, MaterialReceipt.size, MaterialReceipt.sha256,
        MaterialReceipt.detail, ClassroomMaterial.title.label('task_title'),
        ClassroomMaterial.kind.label('task_kind'),
    ).outerjoin(ClassroomMaterial, ClassroomMaterial.id == MaterialReceipt.material_id).where(
        MaterialReceipt.user_id == user_id, MaterialReceipt.kind == 'submission',
    )


async def list_artifacts(db, user_id, page, page_size):
    if not await db.scalar(select(User.id).where(User.id == user_id)):
        raise HTTPException(404, '学生不存在')
    total = await db.scalar(select(func.count(MaterialReceipt.id)).where(
        MaterialReceipt.user_id == user_id, MaterialReceipt.kind == 'submission',
    )) or 0
    rows = (await db.execute(_query(user_id).order_by(
        MaterialReceipt.created_at.desc(), MaterialReceipt.id.desc(),
    ).offset((page - 1) * page_size).limit(page_size))).mappings().all()
    return {'items': [_metadata(row) for row in rows], 'total': total,
            'page': page, 'page_size': page_size}


async def artifact_detail(db, user_id, receipt_id):
    # Both ownership and kind are checked in the query before obtaining a blob.
    row = (await db.execute(_query(user_id).add_columns(MaterialReceipt.content).where(
        MaterialReceipt.id == receipt_id,
    ))).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, '该学生没有这份提交')
    preview = await offload(preview_archive, row['content'])
    return {**_metadata(row), **preview}


def preview_archive(data):
    """Only allowlisted source and visible user/assistant text; never tool/reasoning."""
    result = {'readme': None, 'code_files': [], 'messages': [],
              'evidence': {'has_events': False, 'has_sessions': False, 'code_file_count': 0,
                           'message_count': 0, 'displayed_message_count': 0, 'truncated': False,
                           'message_selection': 'first_visible_messages_in_archive_session_order',
                           'message_count_is_lower_bound': False, 'omitted_message_count': 0},
              'warnings': [], 'source': 'uploaded_local_records_not_mastery_or_execution_attestation'}
    warnings = result['warnings']
    evidence = result['evidence']

    def warn(message):
        if message not in warnings:
            warnings.append(message)

    if not isinstance(data, bytes) or not data:
        warn('这条记录没有可预览的 ZIP 内容；请核对历史收件记录。')
        return result
    if len(data) > MAX_ARCHIVE_BYTES:
        warn('作品包超过在线预览上限，请下载原件查看。')
        return result
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_MEMBERS or sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
                raise ValueError('archive budget')
            names = set()
            for info in infos:
                mode = info.external_attr >> 16
                if (not _safe_path(info.filename) or info.filename in names or info.flag_bits & 1
                        or stat.S_ISLNK(mode) or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError('unsafe entry')
                names.add(info.filename)
            files = {info.filename: info for info in infos if not info.is_dir()}
            evidence['has_events'] = 'evidence/events.jsonl' in files
            sessions = sorted(name for name in files if name.startswith('evidence/sessions/')
                              and name.endswith('.jsonl'))
            evidence['has_sessions'] = bool(sessions)

            def text_file(name, max_chars):
                info = files[name]
                # Bound decompression, then mask before cutting so a key cannot be
                # split at the preview boundary and accidentally partly displayed.
                with archive.open(info) as stream:
                    raw = stream.read(min(info.file_size, max_chars * 4 + 4096) + 1)
                truncated = len(raw) < info.file_size
                try:
                    text = raw.decode('utf-8-sig', errors='strict')
                except UnicodeError:
                    # A bounded prefix may end mid-character. Reject binary files,
                    # but preserve valid UTF-8 prefixes without leaking raw bytes.
                    text = raw.decode('utf-8-sig', errors='replace')
                if '\x00' in text or text.count('\ufffd') > max(3, len(text) // 100):
                    warn('部分文件不是可安全展示的 UTF-8 文本，已略过。')
                    return None
                text = _masked(text)
                truncated = truncated or len(text) > max_chars
                return {'path': _masked(name), 'text': text[:max_chars], 'truncated': truncated}

            readmes = sorted(name for name in files if _visible_project(name)
                             and PurePosixPath(name).name.lower() in ('readme.md', 'readme.txt', 'readme'))
            if readmes:
                name = next((name for name in readmes if name.lower() == 'project/readme.md'), readmes[0])
                result['readme'] = text_file(name, MAX_README_CHARS)
                if result['readme']:
                    # Template detection is only a conservative wording heuristic.
                    result['readme']['is_template'] = sum(phrase in result['readme']['text']
                                                          for phrase in TEMPLATE_PHRASES) >= 2
            code = sorted(name for name in files if _visible_project(name) and name not in readmes
                          and PurePosixPath(name).suffix.lower() in SOURCE_SUFFIXES)
            evidence['code_file_count'] = len(code)
            code_chars = 0
            for name in code[:MAX_CODE_FILES]:
                budget = min(MAX_CODE_CHARS, MAX_TOTAL_CODE_CHARS - code_chars)
                if budget <= 0:
                    evidence['truncated'] = True
                    break
                file = text_file(name, budget)
                if file:
                    result['code_files'].append(file)
                    code_chars += len(file['text'])
                    evidence['truncated'] |= file['truncated']
            if len(code) > len(result['code_files']):
                evidence['truncated'] = True
                warn('代码文件较多或包含非文本文件；在线只展示部分内容，原件完整保留。')

            remaining = MAX_LOG_BYTES
            scanned_lines = 0
            message_chars = 0
            seen = set()
            if len(sessions) > MAX_SESSION_FILES:
                evidence['truncated'] = True
                evidence['message_count_is_lower_bound'] = True
            for name in sessions[:MAX_SESSION_FILES]:
                if remaining <= 0 or scanned_lines >= MAX_SCANNED_LINES:
                    evidence['truncated'] = True
                    evidence['message_count_is_lower_bound'] = True
                    break
                with archive.open(files[name]) as stream:
                    number = 0
                    while remaining > 0 and scanned_lines < MAX_SCANNED_LINES:
                        line = stream.readline(min(MAX_LINE_BYTES, remaining) + 1)
                        if not line:
                            break
                        number += 1
                        scanned_lines += 1
                        remaining -= len(line)
                        if len(line) > MAX_LINE_BYTES or (remaining <= 0 and not line.endswith(b'\n')):
                            evidence['truncated'] = True
                            evidence['message_count_is_lower_bound'] = True
                            warn('部分对话行超过预览上限，已略过后续内容。')
                            break
                        try:
                            payload = json.loads(line)
                            if not isinstance(payload, dict):
                                continue
                            message = payload.get('message')
                            if not isinstance(message, dict) or message.get('role') not in ('user', 'assistant'):
                                continue
                            content = message.get('content')
                            if isinstance(content, list):
                                content = '\n'.join(part['text'] for part in content
                                                    if isinstance(part, dict) and part.get('type') == 'text'
                                                    and isinstance(part.get('text'), str))
                            if not isinstance(content, str) or not content.strip():
                                continue
                            # Session copies may repeat stable message IDs. Never
                            # deduplicate separate students/receipts or equal text.
                            entry_id = payload.get('id')
                            identity = (entry_id, message['role'], content) if isinstance(entry_id, str) else None
                            if identity is not None and identity in seen:
                                continue
                            if identity is not None:
                                seen.add(identity)
                            evidence['message_count'] += 1
                            if (len(result['messages']) >= MAX_MESSAGES or
                                    message_chars >= MAX_TOTAL_MESSAGE_CHARS):
                                evidence['truncated'] = True
                                continue
                            text = _masked(content)
                            budget = min(MAX_MESSAGE_CHARS, MAX_TOTAL_MESSAGE_CHARS - message_chars)
                            truncated = len(text) > budget
                            text = text[:budget]
                            at = payload.get('timestamp', payload.get('at', message.get('timestamp')))
                            result['messages'].append({'role': message['role'], 'text': text,
                                'at': _masked(str(at)[:100]) if at is not None else None,
                                'session_path': _masked(name), 'line': number, 'truncated': truncated})
                            message_chars += len(text)
                            evidence['truncated'] |= truncated
                        except (ValueError, UnicodeError, RecursionError):
                            warn('部分对话行无法解析，原始记录仍保留在作品包中。')
                    if remaining <= 0 or scanned_lines >= MAX_SCANNED_LINES:
                        evidence['truncated'] = True
                        evidence['message_count_is_lower_bound'] = True
            evidence['displayed_message_count'] = len(result['messages'])
            evidence['omitted_message_count'] = evidence['message_count'] - len(result['messages'])
            if not result['readme']:
                warn('这份提交没有可预览的 README；不代表代码没有提交。')
            elif result['readme']['is_template']:
                warn('README 疑似仍含初始模板，请结合代码和对话核对，不能据此判断学生理解情况。')
            if not code:
                warn('未找到可预览的源代码文件。')
            if not evidence['has_events']:
                warn('未找到 evidence/events.jsonl 过程事件记录。')
            if not sessions:
                warn('未找到 SFLS 对话文件；平台内聊天与离线 SFLS 记录是不同来源。')
            elif not result['messages']:
                warn('对话文件存在，但未提取到可展示的用户或 AI 正文。')
            if evidence['truncated']:
                warn('在线预览已截取部分内容；完整代码、对话和时间信息请下载原件核查。')
    except (ValueError, KeyError, UnicodeError, RuntimeError, zipfile.BadZipFile, zlib.error,
            NotImplementedError, EOFError, OSError):
        # No exception text containing arbitrary names or credential bytes.
        result.update(readme=None, code_files=[], messages=[])
        evidence.update(has_events=False, has_sessions=False, code_file_count=0,
                        message_count=0, displayed_message_count=0)
        warn('作品包无法安全在线预览；收件记录和原件未改动，请下载后核对。')
    return result
