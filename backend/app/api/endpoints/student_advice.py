"""Authenticated feedback with immutable, idempotent receipts."""
import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.student_advice import StudentAdvice
from app.models.sql.user import User

router = APIRouter(prefix="/advice", tags=["Student advice"])
admin_router = APIRouter(prefix="/advice", tags=["Student advice"], dependencies=[Depends(verify_admin_key)])


class AdviceContext(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    task_id: str = Field(min_length=1, max_length=100)
    project_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)
    phase: Literal["practice", "pre", "post"]
    sfls_version: str = Field(min_length=1, max_length=50)
    scaffold_revision: str = Field(min_length=1, max_length=50)


class AdviceInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: UUID
    content: str = Field(min_length=1, max_length=2000, repr=False)
    client_created_at: AwareDatetime
    client_context: AdviceContext

    @field_validator("content")
    @classmethod
    def no_obvious_secret(cls, value):
        if re.search(r"sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S{16,}", value, re.I):
            raise ValueError("请移除密钥或密码后再发送")
        return value


@router.post("")
async def submit_advice(body: AdviceInput, response: Response, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    if user.role not in ("learner", "student", "user"):
        raise HTTPException(403, "请使用学生账户发送建议")
    values = body.model_dump()
    await db.execute(insert(StudentAdvice).values(**values, user_id=user.id).on_conflict_do_nothing(index_elements=["id"]))
    item = await db.get(StudentAdvice, body.id)
    if item.user_id != user.id or any(getattr(item, key) != value for key, value in values.items()):
        raise HTTPException(409, "此建议编号已使用，不能覆盖原建议")
    await db.commit()
    return {"success": True, "data": {"id": str(item.id), "user_id": str(item.user_id), "received_at": item.created_at.isoformat()}}


@admin_router.get("")
async def list_advice(response: Response, class_name: str | None = Query(None, max_length=100), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000), db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    query = select(StudentAdvice, User).join(User, StudentAdvice.user_id == User.id)
    count = select(func.count()).select_from(StudentAdvice).join(User, StudentAdvice.user_id == User.id)
    if class_name:
        query = query.where(User.class_name == class_name)
        count = count.where(User.class_name == class_name)
    rows = (await db.execute(query.order_by(StudentAdvice.created_at.desc(), StudentAdvice.id).offset(offset).limit(limit))).all()
    return {"success": True, "data": {"total": await db.scalar(count), "items": [
        {"id": str(item.id), "user_id": str(user.id), "name": user.name, "student_id": user.student_id, "class_name": user.class_name,
         "content": item.content, "client_context": item.client_context, "client_created_at": item.client_created_at.isoformat(), "received_at": item.created_at.isoformat()}
        for item, user in rows]}}
