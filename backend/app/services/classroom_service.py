"""Deterministic classroom authorization; no LLM, graph, or student history reads."""
from contextvars import ContextVar
from datetime import datetime, timezone
import re

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import async_session_factory, get_db
from app.models.sql.classroom import ClassroomSession
from app.models.sql.research import ResearchTaskSubmission
from app.models.sql.user import User

llm_classroom_scope: ContextVar[str | None] = ContextVar("llm_classroom_scope", default=None)
SAVE_PATH = re.compile(r"/research/tasks/([0-9a-fA-F-]{36})/(save-workspace|save-progress)$")


def effective_state(session):
    if session.state == "closing" and session.closes_at <= datetime.now(timezone.utc):
        return "closed"
    return session.state


async def current_session(db, class_name):
    if not class_name:
        return None
    return await db.scalar(select(ClassroomSession).where(
        ClassroomSession.is_current.is_(True), ClassroomSession.class_name == class_name,
    ))


def denied(state):
    return HTTPException(403, detail={
        "code": "CLASSROOM_CLOSING" if state == "closing" else "CLASSROOM_CLOSED",
        "message": "正在下课，请保存当前内容。" if state == "closing" else "本节课已结束，等待老师重新开放。",
    })


async def require_classroom_access(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Gate protected learning routes, not auth, assessments, status, or admin routes.

    Read once at entry; queued model calls recheck just before dispatch in a fresh
    short transaction. A closing grace window accepts only existing workspaces.
    """
    if user.role == "admin":
        yield
        return
    session = await current_session(db, user.class_name)
    if session:
        state = effective_state(session)
        if state != "open":
            save = SAVE_PATH.search(request.url.path)
            if state != "closing" or request.method != "POST" or not save:
                raise denied(state)
            from uuid import UUID
            exists = await db.scalar(select(ResearchTaskSubmission.id).where(
                ResearchTaskSubmission.user_id == user.id,
                ResearchTaskSubmission.task_id == UUID(save.group(1)),
            ))
            if not exists:
                raise denied(state)
    token = llm_classroom_scope.set(user.class_name)
    try:
        yield
    finally:
        llm_classroom_scope.reset(token)


async def ensure_queued_llm_access():
    class_name = llm_classroom_scope.get()
    if not class_name:
        return
    async with async_session_factory() as db:
        session = await current_session(db, class_name)
        if session and effective_state(session) != "open":
            raise denied(effective_state(session))
