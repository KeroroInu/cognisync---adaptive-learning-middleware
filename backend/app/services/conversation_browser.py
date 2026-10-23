"""Read-only conversation navigation; list pages never load submitted ZIP bytes.

An offline row is a student's accepted artifact version, not an independent chat
session. A web row groups the student's web messages rather than pretending the
legacy session API separates them. Neither source is an ability score.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from app.models.sql import ClassroomMaterial, ClassroomSession, MaterialReceipt, User
from app.models.sql.message import ChatMessage
from app.services.student_artifacts import _masked, _metadata

STUDENT_ROLES = ("learner", "student", "user")


def _identity_columns():
    return (
        User.id.label("user_id"), User.name.label("user_name"),
        User.student_id, User.school_class,
    )


def _identity(row):
    return {
        "user_id": str(row["user_id"]),
        "user_name": _masked(str(row["user_name"] or "")[:100]),
        "student_id": _masked(str(row["student_id"])[:100]) if row["student_id"] else None,
        "school_class": _masked(str(row["school_class"])[:100]) if row["school_class"] else None,
        "class_name": _masked(str(row["class_name"])[:100]) if row["class_name"] else None,
    }


def artifact_rows(*, query=None, class_name=None, versions="latest"):
    """Rank only metadata. The task's classroom owns historical class filtering."""
    partition = (MaterialReceipt.user_id, MaterialReceipt.material_id)
    statement = select(
        MaterialReceipt.id.label("receipt_id"), MaterialReceipt.material_id,
        MaterialReceipt.created_at, MaterialReceipt.size, MaterialReceipt.sha256,
        MaterialReceipt.detail, ClassroomMaterial.title.label("task_title"),
        ClassroomMaterial.kind.label("task_kind"), *_identity_columns(),
        ClassroomSession.class_name.label("class_name"),
        func.count(MaterialReceipt.id).over(partition_by=partition).label("version_count"),
        func.row_number().over(
            partition_by=partition,
            order_by=(MaterialReceipt.created_at.desc(), MaterialReceipt.id.desc()),
        ).label("version_rank"),
    ).select_from(MaterialReceipt).join(User, User.id == MaterialReceipt.user_id).outerjoin(
        ClassroomMaterial, ClassroomMaterial.id == MaterialReceipt.material_id,
    ).outerjoin(
        ClassroomSession, ClassroomSession.id == ClassroomMaterial.session_id,
    ).where(MaterialReceipt.kind == "submission", User.role.in_(STUDENT_ROLES))
    if query and query.strip():
        value = query.strip()
        statement = statement.where(or_(
            User.name.icontains(value, autoescape=True),
            User.student_id.icontains(value, autoescape=True),
            ClassroomMaterial.title.icontains(value, autoescape=True),
        ))
    if class_name and class_name.strip():
        statement = statement.where(ClassroomSession.class_name == class_name.strip())
    ranked = statement.subquery("artifact_versions")
    result = select(ranked)
    if versions == "latest":
        result = result.where(ranked.c.version_rank == 1)
    return result


async def list_artifacts(db, *, query=None, class_name=None, versions="latest", page=1, page_size=30):
    statement = artifact_rows(query=query, class_name=class_name, versions=versions)
    total = await db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = (await db.execute(statement.order_by(
        statement.selected_columns.created_at.desc(), statement.selected_columns.receipt_id.desc(),
    ).offset((page - 1) * page_size).limit(page_size))).mappings().all()
    return {
        "items": [{**_metadata(row), **_identity(row), "version_count": row["version_count"]}
                  for row in rows],
        "total": total, "page": page, "page_size": page_size,
    }


def web_rows(*, query=None, class_name=None):
    # Explicit aggregate columns: no body, model analysis or User secrets.
    statement = select(
        *_identity_columns(), User.class_name,
        func.count(ChatMessage.id).label("message_count"),
        func.min(ChatMessage.timestamp).label("created_at"),
        func.max(ChatMessage.timestamp).label("updated_at"),
    ).select_from(User).join(ChatMessage, ChatMessage.user_id == User.id).where(
        User.role.in_(STUDENT_ROLES),
    )
    if query and query.strip():
        value = query.strip()
        statement = statement.where(or_(
            User.name.icontains(value, autoescape=True),
            User.student_id.icontains(value, autoescape=True),
        ))
    if class_name and class_name.strip():
        statement = statement.where(User.class_name == class_name.strip())
    return statement.group_by(User.id, User.name, User.student_id, User.school_class, User.class_name)


async def list_web(db, *, query=None, class_name=None, page=1, page_size=30):
    statement = web_rows(query=query, class_name=class_name)
    total = await db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = (await db.execute(statement.order_by(
        func.max(ChatMessage.timestamp).desc(), User.id.desc(),
    ).offset((page - 1) * page_size).limit(page_size))).mappings().all()
    return {
        "items": [{**_identity(row), "message_count": row["message_count"],
                   "created_at": row["created_at"], "updated_at": row["updated_at"]}
                  for row in rows],
        "total": total, "page": page, "page_size": page_size,
    }


async def web_messages(db, user_id, *, limit=50, offset=0):
    if not await db.scalar(select(User.id).where(User.id == user_id, User.role.in_(STUDENT_ROLES))):
        raise HTTPException(404, "学生不存在")
    total = await db.scalar(select(func.count(ChatMessage.id)).where(
        ChatMessage.user_id == user_id,
    )) or 0
    rows = (await db.execute(select(
        ChatMessage.id, ChatMessage.role, ChatMessage.text, ChatMessage.timestamp,
    ).where(ChatMessage.user_id == user_id).order_by(
        ChatMessage.timestamp.asc(), ChatMessage.id.asc(),
    ).limit(limit).offset(offset))).mappings().all()
    return {
        "messages": [{"id": str(row["id"]), "role": getattr(row["role"], "value", row["role"]),
                      "text": _masked(row["text"]), "timestamp": row["timestamp"]}
                     for row in rows],
        "total": total, "limit": limit, "offset": offset,
    }
