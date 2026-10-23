"""Deterministic classroom authorization; no LLM, graph, or student history reads."""
from contextvars import ContextVar
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import async_session_factory, get_db
from app.models.sql.classroom import ClassroomSession
from app.models.sql.user import User
from app.models.sql.lesson import LessonPlan

llm_classroom_scope: ContextVar[str | None] = ContextVar("llm_classroom_scope", default=None)
lesson_evidence_context: ContextVar[dict | None] = ContextVar("lesson_evidence_context", default=None)


def effective_state(session):
    # Current class workspaces are always available. Historical containers retain
    # their state for evidence; task publication/withdrawal is a separate check.
    if session.is_current:
        return "open"
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
        "message": "任务安排已更新，请刷新页面后重试。",
    })


async def require_classroom_access(request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Attach evidence context; each task endpoint enforces publication scope."""
    if user.role == "admin":
        yield
        return
    session = await current_session(db, user.class_name)
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session.id)) if session else None
    context = None
    if plan and plan.started_at:
        task = plan.configuration.get("tasks", {}).get(user.experiment_group)
        context = {"session_id": str(session.id), "lesson_id": str(plan.id), "task_id": task["id"],
                   "group": user.experiment_group, "user_id": str(user.id),
                   "blueprint_version_id": task.get("blueprint_version_id")} if task else None
    token = llm_classroom_scope.set(user.class_name)
    lesson_token = lesson_evidence_context.set(context)
    try:
        yield
    finally:
        llm_classroom_scope.reset(token)
        lesson_evidence_context.reset(lesson_token)


async def ensure_queued_llm_access():
    from app.services.project_review import review_dispatch_check
    check = review_dispatch_check.get()
    if check:
        await check()
    class_name = llm_classroom_scope.get()
    if not class_name:
        return
    async with async_session_factory() as db:
        session = await current_session(db, class_name)
        context = lesson_evidence_context.get()
        if context and (not session or str(session.id) != context["session_id"]):
            raise denied("closed")
        if session and effective_state(session) != "open":
            raise denied(effective_state(session))
