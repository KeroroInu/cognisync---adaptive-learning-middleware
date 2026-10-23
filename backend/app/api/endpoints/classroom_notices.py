"""Teacher-to-class copyable notices, not questionnaires or research evidence."""
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.classroom_notice import ClassroomNotice
from app.models.sql.user import User
from app.services.classroom_notice import active_notice, active_notices, notice_row

router = APIRouter(prefix="/classroom", tags=["Admin Classroom"], dependencies=[Depends(verify_admin_key)])
NoticeClass = Literal["解构班", "开发班"]
NOTICE_LOCK = 739204825


class NoticeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    class_name: NoticeClass
    content: str = Field(min_length=1, max_length=4000, repr=False)
    target_user_ids: list[UUID] = Field(default_factory=list, max_length=100)


@router.get("/notices/students")
async def notice_students(class_name: NoticeClass, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    rows = (await db.scalars(select(User).where(User.class_name == class_name, User.role.in_(["learner", "student", "user"])).order_by(User.student_id, User.id))).all()
    return {"success": True, "data": [{"id": str(user.id), "name": user.name, "student_id": user.student_id} for user in rows]}


@router.get("/notices/sent")
async def sent_notices(class_name: NoticeClass, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    items = await active_notices(db, class_name, teacher=True)
    # The teacher's polling/list view needs delivery metadata, not repeated secrets.
    return {"success": True, "data": [{key: value for key, value in row.items() if key != "content"} for row in items]}


@router.get("/notices")
async def get_notice(class_name: NoticeClass, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return {"success": True, "data": await active_notice(db, class_name)}


@router.post("/notices")
async def publish_notice(body: NoticeInput, response: Response, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": NOTICE_LOCK})
    targets = sorted(set(str(uid) for uid in body.target_user_ids))
    previous = await db.get(ClassroomNotice, body.request_id)
    if previous:
        if previous.class_name != body.class_name or previous.created_by != teacher.id or (previous.target_user_ids or []) != targets:
            raise HTTPException(409, "请求编号已使用")
        if previous.content is not None and previous.content != body.content:
            raise HTTPException(409, "通知内容已变化，请重新发送")
        # Retrying an old request must never restore a withdrawn/replaced key.
        return {"success": True, "data": notice_row(previous, teacher=True) if previous.content and previous.expires_at > datetime.now(ZoneInfo("Asia/Shanghai")) else None}
    if targets:
        valid = (await db.scalars(select(User.id).where(User.id.in_([UUID(uid) for uid in targets]), User.class_name == body.class_name, User.role.in_(["learner", "student", "user"])))).all()
        if len(valid) != len(targets):
            raise HTTPException(422, "所选学生不在这个班级，请重新选择")
    # Replace only the same audience; personal messages cannot erase class notices.
    await db.execute(update(ClassroomNotice).where(ClassroomNotice.class_name == body.class_name, ClassroomNotice.target_user_ids == targets).values(content=None))
    tomorrow = datetime.now(ZoneInfo("Asia/Shanghai")) + timedelta(days=1)
    item = ClassroomNotice(id=body.request_id, class_name=body.class_name, content=body.content, target_user_ids=targets,
                           created_by=teacher.id, expires_at=tomorrow.replace(hour=0, minute=0, second=0, microsecond=0))
    db.add(item)
    await db.commit()
    return {"success": True, "data": notice_row(item, teacher=True)}


@router.post("/notices/{notice_id}/withdraw")
async def withdraw_notice(notice_id: UUID, response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": NOTICE_LOCK})
    # ID-scoped: a stale teacher tab cannot withdraw a newer replacement.
    item = await db.get(ClassroomNotice, notice_id)
    if not item:
        raise HTTPException(404, "通知不存在")
    item.content = None
    await db.commit()
    return {"success": True, "data": None}
