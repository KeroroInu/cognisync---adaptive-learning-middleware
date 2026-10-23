"""Read-only provenance views. Chronology does not imply adoption or mastery."""
import json

from sqlalchemy import and_, select
from sqlalchemy.orm import aliased

from app.models.sql import ArtifactVersion, StageArtifact, StageEvent, StageEventArtifact

INDEX_FIELDS = ['source_table', 'source_id', 'user_id', 'task_id', 'session_id', 'at',
                'kind', 'response_to', 'stage', 'focus_id', 'reply_generation_ms',
                'code_sha256', 'adopted', 'mastery']


def process_index(table, row):
    """A compact index into exported originals; no invented links for historical data."""
    if table == 'learning_support_turns':
        payload = row.get('payload') or {}
        request = payload.get('request') or {}
        return dict(zip(INDEX_FIELDS, [table, row['id'], row['user_id'], row.get('task_id'),
            row.get('session_id'), row.get('created_at'), request.get('action'), None,
            request.get('stage'), request.get('focus'), payload.get('reply_generation_ms'),
            payload.get('code_sha256'), None, None]))
    if table not in ('chat_messages', 'stage_events', 'preparation_records'):
        return None
    if table == 'chat_messages' and (row.get('analysis') or {}).get('commonSupportId'):
        return None  # New ledger indexes the whole turn; original messages remain exported.
    if table == 'preparation_records' and ((row.get('payload') or {}).get('support') or {}).get('turn_id'):
        return None
    analysis = row.get('analysis') or {}
    detail = row.get('detail') or {}
    evidence = analysis.get('learningEvidence') or {}
    lesson = (analysis if table == 'chat_messages' else detail).get('lesson') or {}
    return dict(zip(INDEX_FIELDS, [
        table, row['id'], row['user_id'], row.get('task_id') or lesson.get('task_id'),
        row.get('session_id') if table == 'preparation_records' else lesson.get('session_id'),
        row.get('timestamp') or row.get('created_at'),
        row.get('event_type') or row.get('kind') or row.get('role'),
        evidence.get('response_to'), row.get('stage') or evidence.get('stage'),
        evidence.get('focus_id'), evidence.get('reply_generation_ms'),
        evidence.get('code_sha256'), None, None,
    ]))


async def artifact_changes(db, event_ids):
    """One batched join, constrained by ownership and artifact lineage."""
    if not event_ids:
        return {}
    previous = aliased(ArtifactVersion)
    rows = (await db.execute(select(StageEventArtifact.event_id, StageArtifact.artifact_key,
        ArtifactVersion, previous, StageEventArtifact.version_created)
        .select_from(StageEventArtifact)
        .join(StageEvent, StageEvent.id == StageEventArtifact.event_id)
        .join(StageArtifact, and_(StageArtifact.id == StageEventArtifact.artifact_id,
              StageArtifact.user_id == StageEvent.user_id, StageArtifact.task_id == StageEvent.task_id))
        .join(ArtifactVersion, and_(ArtifactVersion.id == StageEventArtifact.artifact_version_id,
              ArtifactVersion.artifact_id == StageArtifact.id))
        .outerjoin(previous, and_(previous.id == ArtifactVersion.previous_version_id,
                   previous.artifact_id == StageArtifact.id))
        .where(StageEvent.id.in_(event_ids))
        .order_by(StageEventArtifact.position))).all()
    result = {}
    for event_id, key, version, before, created in rows:
        result.setdefault(event_id, []).append({
            'artifact_key': key, 'version_id': str(version.id), 'version': version.version,
            'previous_version_id': str(before.id) if before else None,
            'version_created': created, 'change_source': version.change_source,
            'before': before.content if before else None, 'after': version.content,
        })
    return result


def change_parts(changes):
    parts = []
    for change in changes:
        for field, label in [('before', '修改前'), ('after', '本次保存')]:
            if change[field] is not None:
                parts.append({'role': f'{change["artifact_key"]} · {label}', 'kind': 'artifact_version',
                              'text': json.dumps(change[field], ensure_ascii=False, indent=2)})
    return parts
