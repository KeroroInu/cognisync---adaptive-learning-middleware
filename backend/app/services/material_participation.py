"""Read-only classroom participation, using receipt metadata rather than ZIP bodies.

The current class roster is the denominator. A fresh statistics window changes
only this view; historical receipts and the original attempt counters remain.
"""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, func, or_, select

from app.models.sql import ClassroomMaterial, ClassroomSession, MaterialReceipt, User


ParticipationStatus = Literal['all', 'pending', 'submitted', 'not_downloaded']


def statistics_started_at(configuration):
    """Treat malformed/ambiguous configuration as all-time, never as a SQL cast."""
    value = (configuration or {}).get('statistics_started_at')
    if not isinstance(value, str) or len(value) > 100:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def excluded_student_ids(configuration):
    values = (configuration or {}).get('statistics_excluded_student_ids')
    if not isinstance(values, list):
        return []
    # Only exact registered student IDs are meaningful. Never interpret patterns.
    return sorted({value.strip() for value in values
                   if isinstance(value, str) and 0 < len(value.strip()) <= 50})


def excluded_user_ids(configuration):
    values = (configuration or {}).get('statistics_excluded_user_ids')
    if not isinstance(values, list):
        return []
    result = set()
    for value in values:
        if not isinstance(value, str):
            continue
        try:
            result.add(UUID(value))
        except ValueError:
            pass
    return sorted(result)


def summary_row(item, eligible=0, downloaded=0, submitted=0):
    started = statistics_started_at(item.configuration)
    return {
        'eligible_user_count': eligible,
        'download_user_count': downloaded,
        'submission_user_count': submitted,
        'pending_user_count': eligible - submitted,
        'statistics_started_at': started.isoformat() if started else None,
        'excluded_student_ids': excluded_student_ids(item.configuration),
        'has_exclusions': bool(excluded_student_ids(item.configuration) or excluded_user_ids(item.configuration)),
    }


def summary_statement(items):
    """One grouped query for all cards, including classes with an empty roster."""
    eligible = [User.class_name == ClassroomSession.class_name,
                User.role == 'learner', User.is_active.is_(True)]
    exclusions = [and_(ClassroomMaterial.id == item.id,
                       User.student_id.in_(excluded_student_ids(item.configuration)))
                  for item in items if excluded_student_ids(item.configuration)]
    exclusions += [and_(ClassroomMaterial.id == item.id,
                        User.id.in_(excluded_user_ids(item.configuration)))
                   for item in items if excluded_user_ids(item.configuration)]
    if exclusions:
        eligible.append(~or_(*exclusions))
    windows = []
    for item in items:
        started = statistics_started_at(item.configuration)
        windows.append(and_(ClassroomMaterial.id == item.id, MaterialReceipt.created_at >= started)
                       if started else ClassroomMaterial.id == item.id)
    return select(
        ClassroomMaterial.id.label('material_id'),
        func.count(User.id.distinct()).label('eligible_user_count'),
        func.count(MaterialReceipt.user_id.distinct()).filter(
            MaterialReceipt.kind == 'download').label('download_user_count'),
        func.count(MaterialReceipt.user_id.distinct()).filter(
            MaterialReceipt.kind == 'submission').label('submission_user_count'),
    ).select_from(ClassroomMaterial).join(
        ClassroomSession, ClassroomSession.id == ClassroomMaterial.session_id
    ).outerjoin(User, and_(*eligible)).outerjoin(MaterialReceipt, and_(
        MaterialReceipt.material_id == ClassroomMaterial.id,
        MaterialReceipt.user_id == User.id,
        MaterialReceipt.kind.in_(('download', 'submission')),
        or_(*windows),
    )).where(ClassroomMaterial.id.in_([item.id for item in items])).group_by(ClassroomMaterial.id)


async def summaries(db, items):
    if not items:
        return {}
    values = {row[0]: row[1:] for row in (await db.execute(summary_statement(items))).all()}
    return {item.id: summary_row(item, *values.get(item.id, (0, 0, 0))) for item in items}


def roster_statement(item, class_name, *, status: ParticipationStatus, offset, limit):
    """A fixed query count: grouped metadata and one latest-ID window, not N+1."""
    conditions = [MaterialReceipt.material_id == item.id,
                  MaterialReceipt.kind.in_(('download', 'submission'))]
    started = statistics_started_at(item.configuration)
    if started:
        conditions.append(MaterialReceipt.created_at >= started)
    receipts = select(
        MaterialReceipt.user_id,
        func.count().filter(MaterialReceipt.kind == 'download').label('download_count'),
        func.count().filter(MaterialReceipt.kind == 'submission').label('submission_count'),
        func.max(MaterialReceipt.created_at).filter(MaterialReceipt.kind == 'download').label('last_downloaded_at'),
        func.max(MaterialReceipt.created_at).filter(MaterialReceipt.kind == 'submission').label('last_submitted_at'),
    ).where(*conditions).group_by(MaterialReceipt.user_id).subquery('participation_receipts')
    latest = select(
        MaterialReceipt.user_id, MaterialReceipt.id,
        func.row_number().over(partition_by=MaterialReceipt.user_id,
                               order_by=(MaterialReceipt.created_at.desc(), MaterialReceipt.id.desc())).label('position'),
    ).where(*conditions, MaterialReceipt.kind == 'submission').subquery('participation_latest')
    download_count = func.coalesce(receipts.c.download_count, 0)
    submission_count = func.coalesce(receipts.c.submission_count, 0)
    query = select(
        User.id.label('user_id'), User.name, User.student_id, User.school_class,
        download_count.label('download_count'), submission_count.label('submission_count'),
        receipts.c.last_downloaded_at, receipts.c.last_submitted_at,
        latest.c.id.label('latest_submission_id'),
    ).select_from(User).outerjoin(receipts, receipts.c.user_id == User.id).outerjoin(latest, and_(
        latest.c.user_id == User.id, latest.c.position == 1,
    )).where(User.class_name == class_name, User.role == 'learner', User.is_active.is_(True))
    excluded = excluded_student_ids(item.configuration)
    if excluded:
        query = query.where(User.student_id.not_in(excluded))
    excluded_users = excluded_user_ids(item.configuration)
    if excluded_users:
        query = query.where(User.id.not_in(excluded_users))
    if status == 'pending':
        query = query.where(submission_count == 0)
    elif status == 'submitted':
        query = query.where(submission_count > 0)
    elif status == 'not_downloaded':
        query = query.where(download_count == 0)
    return query.order_by(User.student_id, User.id).offset(offset).limit(limit)


async def roster(db, item, class_name, *, status: ParticipationStatus, offset, limit):
    summary = (await summaries(db, [item]))[item.id]
    totals = {
        'all': summary['eligible_user_count'],
        'pending': summary['pending_user_count'],
        'submitted': summary['submission_user_count'],
        'not_downloaded': summary['eligible_user_count'] - summary['download_user_count'],
    }
    rows = (await db.execute(roster_statement(item, class_name, status=status, offset=offset, limit=limit))).all()
    items = []
    for row in rows:
        value = dict(row._mapping)
        value['downloaded'] = value['download_count'] > 0
        value['submitted'] = value['submission_count'] > 0
        items.append(value)
    return {'total': totals[status], 'summary': summary, 'items': items}
