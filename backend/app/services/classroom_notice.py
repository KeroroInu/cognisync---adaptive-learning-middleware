"""Notice expiry is independent of class activity; never log notice contents."""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import or_, select, update
from app.models.sql.classroom_notice import ClassroomNotice


def notice_row(item, *, teacher=False):
    return {"id": str(item.id), "class_name": item.class_name, "content": item.content,
            **({"target_user_ids": item.target_user_ids or []} if teacher else {}),
            "expires_at": item.expires_at.astimezone(timezone.utc), "created_at": item.created_at}


async def active_notice(db, class_name):
    items = await active_notices(db, class_name, teacher=True)
    return items[0] if items else None


async def active_notices(db, class_name, user_id=None, *, teacher=False):
    if not class_name:
        return []
    query = select(ClassroomNotice).where(
        ClassroomNotice.class_name == class_name,
        ClassroomNotice.content.is_not(None),
        ClassroomNotice.expires_at > datetime.now(timezone.utc),
    )
    if not teacher:
        if user_id is None:
            return []
        query = query.where(or_(ClassroomNotice.target_user_ids == [], ClassroomNotice.target_user_ids.contains([str(user_id)])))
    items = (await db.scalars(query.order_by(ClassroomNotice.created_at.desc(), ClassroomNotice.id.desc()))).all()
    return [notice_row(item, teacher=teacher) for item in items]


async def purge_expired(db):
    await db.execute(update(ClassroomNotice).where(
        ClassroomNotice.expires_at <= datetime.now(timezone.utc),
        ClassroomNotice.content.is_not(None),
    ).values(content=None))
    await db.commit()


async def expire_notices_loop():
    from app.db.postgres import async_session_factory
    while True:
        try:
            async with async_session_factory() as db:
                await purge_expired(db)
        except Exception:
            # No exception parameters: SQL errors can contain sensitive values.
            logging.getLogger(__name__).warning("Notice expiry cleanup unavailable; retrying")
        await asyncio.sleep(60)
