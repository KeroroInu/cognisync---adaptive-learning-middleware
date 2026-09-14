"""Server-owned lesson selection. Never infer a lesson from an old public task."""
from fastapi import HTTPException
from sqlalchemy import select

from app.models.sql.lesson import LessonPlan
from app.services.classroom_service import current_session, effective_state


async def lesson_for_user(db, user):
    session = await current_session(db, user.class_name)
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session.id)) if session else None
    return session, plan


def lesson_entry(session, plan, group):
    if not session or not plan or not plan.started_at or effective_state(session) != "open":
        return None
    task = plan.configuration.get("tasks", {}).get(group)
    if not task:
        return None
    return {"task_id": task["id"], "lesson_id": str(plan.id), "session_id": str(session.id),
            "title": session.title, "group": group}


async def check_lesson_task(db, user, task_id):
    session, plan = await lesson_for_user(db, user)
    # Historical, not-yet-configured classes keep their existing API compatibility.
    # New published lessons cannot use that legacy fallback, including requests by UUID.
    if plan:
        task = plan.configuration.get("tasks", {}).get(user.experiment_group)
        if not plan.started_at or not task or task["id"] != str(task_id):
            raise HTTPException(404, "本节课没有开放这个任务")
    return plan
