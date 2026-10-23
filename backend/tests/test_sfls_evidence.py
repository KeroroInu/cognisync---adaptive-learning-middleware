import io
import json
import zipfile

import pytest
from fastapi import HTTPException

from app.services.research_package import encode_batch
from app.services.sfls_evidence import evidence_rows, write_index


def archive(log):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as zip_file:
        zip_file.writestr('manifest.json', json.dumps({'sfls': {}}))
        zip_file.writestr('evidence/sessions/test.jsonl', log)
    return output.getvalue()


def test_invalid_local_rows_are_explicit_and_formula_text_is_safe():
    blob = archive('{"type":"message","message":{"role":"user","content":"=1+1"}}\ninvalid\n')
    rows = list(evidence_rows(blob, {'receipt_id': 'server-receipt', 'user_id': 'server-user'}))
    assert rows[0]['text'] == '=1+1' and rows[0]['user_id'] == 'server-user'
    assert rows[1]['status'] == 'invalid_json_line' and rows[1]['line'] == 2
    raw, csv_file = io.BytesIO(), io.BytesIO()
    count, size = write_index(blob, {}, raw, csv_file, encode_batch, 10000)
    assert count == 2 and size > 0 and b"'=1+1" in csv_file.getvalue()
    with pytest.raises(HTTPException) as error:
        write_index(blob, {}, io.BytesIO(), io.BytesIO(), encode_batch, 1)
    assert error.value.status_code == 413


def test_bad_archive_has_a_visible_index_failure():
    assert list(evidence_rows(b'not-a-zip', {}))[0]['status'] == 'archive_not_indexed'


def test_run_output_and_prompt_revision_are_exported_without_becoming_student_answers():
    row = list(evidence_rows(archive(json.dumps({'type': 'project_run_finished', 'project_run_id': 'run-1',
        'scaffold_revision': '2026-10-07.2', 'exit_code': 0, 'output': 'finished',
        'verification': 'execution_only_not_functional_pass'})), {}))[0]
    assert row['role'] == 'program' and row['text'] == 'finished'
    assert row['scaffold_revision'] == '2026-10-07.2' and row['project_run_id'] == 'run-1'
    assert row['exit_code'] == 0 and row['verification'] == 'execution_only_not_functional_pass'
    assert row['source'] == 'unverified_local_report'


def test_support_reports_and_monotonic_timing_remain_attributed_not_scores():
    payload = {'type': 'support_reported', 'run_id': 'r1', 'sequence': 9, 'elapsed_ms': 1500,
               'support_level': 'L2', 'previous_support_level': 'L1', 'topic': '列表',
               'reason': '学生询问列表', 'coverage': 'student_evidence', 'evidence_quote': '列表是什么',
               'quote_verified': True, 'support_source': 'ai_self_report_not_observed_mastery'}
    row = list(evidence_rows(archive(json.dumps(payload)), {}))[0]
    assert row['support_level'] == 'L2' and row['quote_verified'] is True
    assert row['elapsed_ms'] == 1500 and row['role'] is None
    assert row['support_source'] == 'ai_self_report_not_observed_mastery'
    legacy = list(evidence_rows(archive('{"type":"request_settled"}'), {}))[0]
    assert legacy['support_level'] is None and legacy['duration_ms'] is None
    invalid = list(evidence_rows(archive('{"type":"request_settled","duration_ms":true,"elapsed_ms":-2}'), {}))[0]
    assert invalid['duration_ms'] is None and invalid['elapsed_ms'] is None


def test_message_ids_usage_and_model_are_available_for_deduplication():
    payload = {'id': 'entry-1', 'parentId': 'parent-1', 'type': 'message', 'message': {
        'role': 'assistant', 'model': 'test-model', 'provider': 'test-provider', 'content': 'reply',
        'usage': {'input': 3, 'output': 5, 'totalTokens': 8}}}
    row = list(evidence_rows(archive(json.dumps(payload)), {}))[0]
    assert row['event_id'] == 'entry-1' and row['parent_id'] == 'parent-1'
    assert row['model'] == 'test-model' and row['total_tokens'] == 8
    assert row['input_tokens'] == 3 and row['output_tokens'] == 5


def test_support_coverage_adjustment_keeps_report_and_review_provenance():
    payload = {'type': 'support_reported', 'coverage': 'unknown', 'reported_coverage': 'student_evidence',
        'coverage_adjustment': 'missing_evidence_kind', 'evidence_kind': 'none',
        'evidence_quote': '好了', 'quote_verified': True, 'verification': 'requires_transcript_review'}
    row = list(evidence_rows(archive(json.dumps(payload)), {}))[0]
    assert row['reported_coverage'] == 'student_evidence'
    assert row['coverage'] == 'unknown' and row['coverage_adjustment'] == 'missing_evidence_kind'
    assert row['evidence_kind'] == 'none' and row['verification'] == 'requires_transcript_review'
    legacy = list(evidence_rows(archive('{"type":"support_reported"}'), {}))[0]
    assert legacy['reported_coverage'] is None and legacy['coverage_adjustment'] is None and legacy['evidence_kind'] is None
