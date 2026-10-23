"""Read-only index of uploaded SFLS logs. Client claims are never ability scores."""
import io
import json
import zipfile

from fastapi import HTTPException

from app.services.classroom_files import inspect_zip

FIELDS = ('receipt_id', 'user_id', 'material_id', 'received_at', 'archive_path',
          'line', 'kind', 'role', 'client_at', 'text', 'status', 'source',
          'task_validation_status', 'phase', 'task_mode', 'policy_version', 'scaffold_revision',
          'request_id', 'project_run_id', 'exit_code', 'verification', 'run_id', 'sequence', 'elapsed_ms',
          'duration_ms', 'duration_kind', 'support_record_status', 'support_level', 'previous_support_level',
          'topic', 'reason', 'coverage', 'evidence_quote', 'support_source', 'quote_verified',
          'event_id', 'parent_id', 'session_id', 'tool_call_id', 'model', 'provider', 'sfls_version', 'pi_version',
          'input_tokens', 'output_tokens', 'total_tokens', 'reported_coverage', 'coverage_adjustment', 'evidence_kind')


def evidence_rows(data, receipt):
    """Yield references to raw lines, including explicit parse errors, never execute code."""
    base = {field: None for field in FIELDS}
    base.update({field: receipt.get(field) for field in ('receipt_id', 'user_id', 'material_id', 'received_at')})
    base.update(archive_path=None, line=None, kind=None, role=None, client_at=None,
                text=None, status='ok', source='unverified_local_report',
                task_validation_status=receipt.get('task_validation_status'), phase=None, task_mode=None, policy_version=None,
                scaffold_revision=None, request_id=None, project_run_id=None, exit_code=None, verification=None)
    try:
        inspect_zip(data)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if 'manifest.json' not in archive.namelist():
                return  # Generic ZIP assignments are not SFLS sessions.
            if archive.getinfo('manifest.json').file_size > 100000:
                raise ValueError('manifest_too_large')
            manifest = json.loads(archive.read('manifest.json'))
            if not isinstance(manifest, dict) or not isinstance(manifest.get('sfls'), dict):
                return
            for info in archive.infolist():
                if not (info.filename == 'evidence/events.jsonl' or
                        (info.filename.startswith('evidence/sessions/') and info.filename.endswith('.jsonl'))):
                    continue
                with archive.open(info) as stream:
                    for number, line in enumerate(stream, 1):
                        row = {**base, 'archive_path': info.filename, 'line': number}
                        try:
                            payload = json.loads(line)
                            if not isinstance(payload, dict):
                                raise ValueError('not_object')
                            row['kind'] = payload.get('type')
                            row['client_at'] = payload.get('at', payload.get('timestamp'))
                            row['event_id'] = payload.get('id') if isinstance(payload.get('id'), str) else None
                            row['parent_id'] = payload.get('parentId') if isinstance(payload.get('parentId'), str) else None
                            for column in ('run_id', 'duration_kind', 'support_record_status', 'support_level',
                                           'previous_support_level', 'topic', 'reason', 'coverage',
                                           'evidence_quote', 'support_source', 'session_id', 'tool_call_id',
                                           'model', 'provider', 'sfls_version', 'pi_version',
                                           'reported_coverage', 'coverage_adjustment', 'evidence_kind'):
                                row[column] = payload.get(column) if isinstance(payload.get(column), str) else None
                            for column in ('sequence', 'elapsed_ms', 'duration_ms'):
                                value = payload.get(column)
                                row[column] = value if type(value) is int and value >= 0 else None
                            row['quote_verified'] = payload.get('quote_verified') if type(payload.get('quote_verified')) is bool else None
                            for column, key in (('phase', 'phase'), ('task_mode', 'task_mode'), ('policy_version', 'policy'),
                                                ('scaffold_revision', 'scaffold_revision'), ('request_id', 'request_id'),
                                                ('project_run_id', 'project_run_id'), ('verification', 'verification')):
                                row[column] = payload.get(key) if isinstance(payload.get(key), str) else None
                            if payload.get('type') == 'project_run_finished':
                                row['role'] = 'program'
                                row['exit_code'] = payload.get('exit_code') if type(payload.get('exit_code')) is int else None
                                row['text'] = payload.get('output') if isinstance(payload.get('output'), str) else None
                            message = payload.get('message')
                            if isinstance(message, dict):
                                row['role'] = message.get('role')
                                for column in ('model', 'provider'):
                                    if isinstance(message.get(column), str):
                                        row[column] = message[column]
                                if isinstance(message.get('toolCallId'), str):
                                    row['tool_call_id'] = message['toolCallId']
                                usage = message.get('usage')
                                if isinstance(usage, dict):
                                    for column, key in (('input_tokens', 'input'), ('output_tokens', 'output'), ('total_tokens', 'totalTokens')):
                                        value = usage.get(key)
                                        row[column] = value if type(value) is int and value >= 0 else None
                                content = message.get('content')
                                if isinstance(content, str):
                                    row['text'] = content
                                elif isinstance(content, list):
                                    # No model reasoning is promoted to an observable student response.
                                    row['text'] = '\n'.join(part['text'] for part in content if
                                        isinstance(part, dict) and part.get('type') == 'text' and isinstance(part.get('text'), str))
                            yield row
                        except (ValueError, UnicodeError, RecursionError):
                            yield {**row, 'status': 'invalid_json_line'}
    except (HTTPException, ValueError, KeyError, UnicodeError, zipfile.BadZipFile, RuntimeError, RecursionError):
        # The untouched original remains in the research package for manual inspection.
        yield {**base, 'status': 'archive_not_indexed'}


def write_index(data, receipt, raw, csv_file, encode, remaining):
    count = 0
    before = raw.tell() + csv_file.tell()
    batch = []
    for row in evidence_rows(data, receipt):
        batch.append(row)
        if len(batch) == 50:
            encode(batch, FIELDS, raw, csv_file)
            count += len(batch)
            batch = []
            if raw.tell() + csv_file.tell() - before > remaining:
                raise HTTPException(413, '本地过程记录超过研究包上限，请按班级导出')
    if batch:
        encode(batch, FIELDS, raw, csv_file)
        count += len(batch)
    size = raw.tell() + csv_file.tell() - before
    if size > remaining:
        raise HTTPException(413, '本地过程记录超过研究包上限，请按班级导出')
    return count, size
