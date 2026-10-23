"""Shared Python preparation area. No group prompts, blueprints or profile mutations."""
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import get_db
from app.models.sql.lesson import PreparationRecord
from app.models.sql.user import User
from app.services.classroom_service import current_session, effective_state
from app.services.common_support import Action

router = APIRouter(prefix="/preparation", tags=["Preparation"])
POLICY = "preparation-python-v1"


class RecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    kind: Literal["save", "run", "chat"]
    code: str = Field(default="", max_length=50000)
    message: str = Field(default="", max_length=4000)
    output: list[str] = Field(default_factory=list, max_length=200)
    error: str = Field(default="", max_length=2000)
    last_run_code: str | None = Field(default=None, max_length=50000)
    support_action: Action = "message"
    support_practice_id: UUID | None = None
    support_answer: str = Field(default="", max_length=1000)


def row(record):
    return {"id": str(record.id), "kind": record.kind, "payload": record.payload,
            "created_at": record.created_at, "session_id": str(record.session_id) if record.session_id else None}


@router.get("/records")
async def records(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = (await db.scalars(select(PreparationRecord).where(PreparationRecord.user_id == user.id)
                             .order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).limit(40))).all()
    saved = await db.scalar(select(PreparationRecord).where(PreparationRecord.user_id == user.id, PreparationRecord.kind == "save")
                           .order_by(PreparationRecord.created_at.desc(), PreparationRecord.id.desc()).limit(1))
    if saved and all(item.id != saved.id for item in items):
        items.append(saved)
    return {"success": True, "data": [row(item) for item in reversed(items)]}


@router.post("/records")
async def record(body: RecordInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if sum(len(line) for line in body.output) > 16000:
        raise HTTPException(422, "输出过长")
    if body.kind == "chat" and not body.message.strip():
        raise HTTPException(422, "先写一句想问的问题")
    # Per-student lock only until durable request reservation; never across model wait.
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": user.id.int % (2**63 - 1)})
    existing = await db.scalar(select(PreparationRecord).where(
        PreparationRecord.user_id == user.id, PreparationRecord.request_id == body.request_id))
    request = body.model_dump(mode="json", exclude={"request_id"})
    if existing:
        if existing.payload.get("request") != request:
            raise HTTPException(409, "请求编号已使用，请重新操作")
        return {"success": True, "data": row(existing)}
    session = await current_session(db, user.class_name)
    if body.kind == "chat" and session and effective_state(session) != "open":
        raise HTTPException(403, "老师已关闭 AI，仍可在这里测试和保存 Python")
    item = PreparationRecord(user_id=user.id, session_id=session.id if session else None,
        request_id=body.request_id, kind=body.kind,
        payload={"request": request, "status": "pending" if body.kind == "chat" else "saved",
                 "policy_version": POLICY, "class_snapshot": user.class_name, "group_snapshot": user.experiment_group,
                 "source": "browser_report"})
    db.add(item)
    await db.commit()
    if body.kind == "chat":
        from app.api.endpoints.learning_support import reply as common_reply
        from app.services.common_support import SupportInput
        payload = dict(item.payload)
        try:
            result = await common_reply(SupportInput(request_id=body.request_id, message=body.message, code=body.code,
                entry="preparation", action=body.support_action, practice_id=body.support_practice_id,
                answer=body.support_answer, context=json.dumps({"last_run_code": body.last_run_code,
                    "output": body.output, "error": body.error, "note": "结果仅对应last_run_code，不等于当前code已运行"}, ensure_ascii=False)), db, user)
            payload.update(status="answered", reply=result["message"], support=result["support"])
        except Exception:
            payload.update(status="failed", reply="这次没有收到 AI 回复。你的提问已保存，可以稍后重试。")
        item.payload = payload
        await db.commit()
    return {"success": True, "data": row(item)}
