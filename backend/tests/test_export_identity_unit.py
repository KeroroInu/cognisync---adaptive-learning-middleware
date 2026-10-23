"""Export identity is a teacher opt-in join, never a client-authored credential."""
import io
import json
import zipfile

from app.services.research_package import export_queries
from app.services.sfls_evidence import evidence_rows


def columns_for(table, include_identity):
    return next({column.name for column in columns}
                for name, columns, _ in export_queries(include_identity=include_identity)
                if name == table)


def test_teacher_identity_opt_in_keeps_full_registration_join_without_secrets():
    private = columns_for('users', True)
    assert {'id', 'name', 'student_id', 'school_class', 'class_name', 'experiment_group'} <= private
    assert not {'password_hash', 'auth_version', 'password', 'api_key', 'token'} & private
    research = columns_for('users', False)
    assert {'id', 'school_class', 'class_name', 'experiment_group'} <= research
    assert not {'name', 'student_id', 'email', 'password_hash'} & research


def test_raw_receipt_export_preserves_the_canonical_student_and_download_join():
    columns = columns_for('classroom_material_receipts', True)
    assert {'id', 'request_id', 'user_id', 'material_id', 'created_at', 'detail', 'sha256'} <= columns
    assert 'content' not in columns  # Untouched original is exported separately.


def test_sfls_index_uses_server_owner_not_manifest_or_message_claims():
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        archive.writestr('manifest.json', json.dumps({'sfls': {}, 'user_id': 'claimed-other-user'}))
        archive.writestr('evidence/sessions/demo.jsonl', json.dumps({
            'type': 'message', 'user_id': 'claimed-other-user',
            'message': {'role': 'user', 'content': 'A synthetic teaching question'},
        }) + '\n')
    rows = list(evidence_rows(stream.getvalue(), {
        'user_id': 'canonical-registration-id', 'receipt_id': 'server-receipt',
        'material_id': 'server-task', 'received_at': '2026-10-20T11:34:40Z',
    }))
    assert len(rows) == 1
    assert rows[0]['user_id'] == 'canonical-registration-id'
    assert rows[0]['receipt_id'] == 'server-receipt' and rows[0]['material_id'] == 'server-task'
