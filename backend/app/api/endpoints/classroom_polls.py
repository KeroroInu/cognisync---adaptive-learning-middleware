"""Two-option interactions, stored in existing classroom evidence tables."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.api.endpoints.classroom import locked_session, prompt_row, success
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.classroom import ClassroomPublication, ClassroomResponse, ClassroomSession
from app.models.sql.user import User
from app.schemas.assessment import Question
from app.services.classroom_service import effective_state

router = APIRouter(
    prefix="/classroom", tags=["Classroom polls"], dependencies=[Depends(verify_admin_key)]
)


class PollInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    topic: str = Field(min_length=1, max_length=200)
    option_a: str = Field(min_length=1, max_length=80)
    option_b: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def distinct_options(self):
        if self.option_a.casefold() == self.option_b.casefold():
            raise ValueError("两个选项不能相同")
        return self


@router.post("/sessions/{session_id}/polls")
async def create_poll(
    session_id: UUID,
    body: PollInput,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(get_current_user),
):
    session = await locked_session(db, session_id)
    question = {
        **Question(
            id="poll",
            text=body.topic,
            options=[
                {"value": "a", "label": body.option_a},
                {"value": "b", "label": body.option_b},
            ],
        ).model_dump(),
        "kind": "poll",
    }
    existing = await db.get(ClassroomPublication, body.request_id)
    if existing:
        if (existing.session_id, existing.question, existing.created_by) != (
            session.id,
            question,
            teacher.id,
        ):
            raise HTTPException(409, "请求编号已用于其他投票")
        return success(prompt_row(existing))
    if effective_state(session) != "open":
        raise HTTPException(409, "请先开始上课")
    active = await db.scalar(
        select(ClassroomPublication.id).where(
            ClassroomPublication.session_id == session.id, ClassroomPublication.closed_at.is_(None)
        )
    )
    if active:
        raise HTTPException(409, "请先结束正在进行的投票或课堂问答")
    item = ClassroomPublication(
        id=body.request_id,
        session_id=session.id,
        question=question,
        source="课堂互动投票（不计分，非量表）",
        created_by=teacher.id,
    )
    db.add(item)
    await db.commit()
    return success(prompt_row(item))


@router.get("/sessions/{session_id}/polls")
async def poll_results(
    session_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    if not await db.get(ClassroomSession, session_id):
        raise HTTPException(404, "课次不存在")
    scope = (
        ClassroomPublication.session_id == session_id,
        ClassroomPublication.question["kind"].astext == "poll",
    )
    polls = (
        await db.scalars(
            select(ClassroomPublication)
            .where(*scope)
            .order_by(ClassroomPublication.published_at.desc(), ClassroomPublication.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    total = await db.scalar(select(func.count()).select_from(ClassroomPublication).where(*scope))
    counts = (
        (
            await db.execute(
                select(ClassroomResponse.publication_id, ClassroomResponse.answer, func.count())
                .where(ClassroomResponse.publication_id.in_([p.id for p in polls]))
                .group_by(ClassroomResponse.publication_id, ClassroomResponse.answer)
            )
        ).all()
        if polls
        else []
    )
    by_poll = {}
    for poll_id, answer, count in counts:
        by_poll.setdefault(poll_id, {})[answer] = count
    return success(
        {
            "total": total,
            "items": [
                {
                    **prompt_row(p),
                    "counts": {
                        "a": by_poll.get(p.id, {}).get("a", 0),
                        "b": by_poll.get(p.id, {}).get("b", 0),
                    },
                }
                for p in polls
            ],
        }
    )
