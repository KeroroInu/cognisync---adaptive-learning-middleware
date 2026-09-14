"""Classroom controls and one-question interactions. Answers remain raw evidence."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.classroom import ClassroomControlEvent, ClassroomPublication, ClassroomResponse, ClassroomSession
from app.models.sql.user import User
from app.models.sql.lesson import LessonPlan
from app.models.sql.research import ResearchTask, ResearchTaskStatus, ResearchTaskKind
from app.services.lesson_service import lesson_entry
from app.schemas.assessment import Question, validate_answer
from app.services.classroom_service import current_session, effective_state

router = APIRouter(prefix="/classroom", tags=["Classroom"])
admin_router = APIRouter(prefix="/classroom", tags=["Admin Classroom"], dependencies=[Depends(verify_admin_key)])
CONTROL_LOCK = 739204824  # Only teacher control mutations; never student responses.
LEARNER_ROLES = ("learner", "student", "user")


class SessionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID = Field(default_factory=uuid4)
    class_name: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=120)


class StateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["open", "end"]


class PromptInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID = Field(default_factory=uuid4)
    question: Question
    source: str = Field(default="", max_length=2000)


class AnswerInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    answer: str | None = Field(default=None, max_length=4000)


def success(data):
    return {"success": True, "data": data}


def session_row(item):
    return {"id": str(item.id), "class_name": item.class_name, "title": item.title,
            "state": effective_state(item), "closes_at": item.closes_at,
            "created_at": item.created_at, "is_current": item.is_current}


def prompt_row(item):
    return {"id": str(item.id), "question": item.question,
            "published_at": item.published_at, "closed_at": item.closed_at}


async def locked_session(db, session_id):
    item = await db.scalar(select(ClassroomSession).where(ClassroomSession.id == session_id).with_for_update())
    if not item:
        raise HTTPException(404, "课次不存在")
    if not item.is_current:
        raise HTTPException(409, "这是历史课次，请操作当前课次")
    return item


@admin_router.get("/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    sessions = (await db.scalars(select(ClassroomSession).order_by(ClassroomSession.created_at.desc(), ClassroomSession.id.desc()).limit(100))).all()
    if not sessions:
        return success([])
    ranked = select(ClassroomPublication.id, func.row_number().over(
        partition_by=ClassroomPublication.session_id, order_by=(ClassroomPublication.published_at.desc(), ClassroomPublication.id.desc()),
    ).label("rn")).where(ClassroomPublication.session_id.in_([s.id for s in sessions])).subquery()
    prompts = (await db.scalars(select(ClassroomPublication).join(ranked, ranked.c.id == ClassroomPublication.id).where(ranked.c.rn == 1))).all()
    counts = dict((await db.execute(select(ClassroomResponse.publication_id, func.count()).where(
        ClassroomResponse.publication_id.in_([p.id for p in prompts]),
    ).group_by(ClassroomResponse.publication_id))).all())
    by_session = {p.session_id: p for p in prompts}
    return success([{**session_row(s), "prompt": prompt_row(by_session[s.id]) if s.id in by_session else None,
                     "response_count": counts.get(by_session[s.id].id, 0) if s.id in by_session else 0} for s in sessions])


@admin_router.post("/sessions")
async def create_session(body: SessionInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": CONTROL_LOCK})
    existing = await db.get(ClassroomSession, body.request_id)
    if existing:
        if (existing.class_name, existing.title, existing.created_by) != (body.class_name, body.title, teacher.id):
            raise HTTPException(409, "请求编号已用于其他课次")
        return success(session_row(existing))
    old = await current_session(db, body.class_name)
    if old:
        old = await locked_session(db, old.id)
        old.is_current, old.state = False, "closed"
        old.closes_at = datetime.now(timezone.utc)
        db.add(ClassroomControlEvent(session_id=old.id, teacher_id=teacher.id, action="replace"))
        await db.execute(update(ClassroomPublication).where(ClassroomPublication.session_id == old.id, ClassroomPublication.closed_at.is_(None)).values(closed_at=old.closes_at))
        await db.flush()
    item = ClassroomSession(id=body.request_id, class_name=body.class_name, title=body.title, created_by=teacher.id)
    db.add(item)
    await db.flush()
    # A newly opened preparation area must not authorize legacy task UUIDs.
    db.add(LessonPlan(session_id=item.id, configuration={"version": 1, "tasks": {}, "knowledge_points": []}))
    db.add(ClassroomControlEvent(session_id=item.id, teacher_id=teacher.id, action="create"))
    await db.commit()
    return success(session_row(item))


@admin_router.post("/sessions/{session_id}/state")
async def change_state(session_id: UUID, body: StateInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    item = await locked_session(db, session_id)
    # Repeated end clicks never extend the grace deadline.
    if body.action == "end" and item.state == "open":
        item.state, item.closes_at = "closing", datetime.now(timezone.utc) + timedelta(seconds=10)
        await db.execute(update(ClassroomPublication).where(ClassroomPublication.session_id == item.id, ClassroomPublication.closed_at.is_(None)).values(closed_at=datetime.now(timezone.utc)))
        db.add(ClassroomControlEvent(session_id=item.id, teacher_id=teacher.id, action="end"))
    elif body.action == "open" and item.state != "open":
        item.state, item.closes_at = "open", None
        db.add(ClassroomControlEvent(session_id=item.id, teacher_id=teacher.id, action="open"))
    await db.commit()
    return success(session_row(item))


@admin_router.post("/sessions/{session_id}/prompts")
async def publish_prompt(session_id: UUID, body: PromptInput, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    session = await locked_session(db, session_id)
    existing = await db.get(ClassroomPublication, body.request_id)
    if existing:
        if (existing.session_id, existing.question, existing.source, existing.created_by) != (session.id, body.question.model_dump(), body.source, teacher.id):
            raise HTTPException(409, "请求编号已用于其他问题")
        return success(prompt_row(existing))
    if effective_state(session) != "open":
        raise HTTPException(409, "请先开始上课")
    await db.execute(update(ClassroomPublication).where(ClassroomPublication.session_id == session.id, ClassroomPublication.closed_at.is_(None)).values(closed_at=datetime.now(timezone.utc)))
    item = ClassroomPublication(id=body.request_id, session_id=session.id, question=body.question.model_dump(), source=body.source, created_by=teacher.id)
    db.add(item)
    await db.commit()
    return success(prompt_row(item))


@admin_router.post("/prompts/{publication_id}/close")
async def close_prompt(publication_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ClassroomPublication, publication_id)
    if not item:
        raise HTTPException(404, "问题不存在")
    await locked_session(db, item.session_id)
    item.closed_at = item.closed_at or datetime.now(timezone.utc)
    await db.commit()
    return success(prompt_row(item))


@router.get("/state")
async def student_state(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = await current_session(db, user.class_name)
    if not session:
        return success({"session": None, "prompt": None, "lesson_entry": None})
    prompt = None
    if effective_state(session) == "open":
        answered = select(ClassroomResponse.publication_id).where(ClassroomResponse.user_id == user.id)
        item = await db.scalar(select(ClassroomPublication).where(
            ClassroomPublication.session_id == session.id, ClassroomPublication.closed_at.is_(None),
            ClassroomPublication.id.not_in(answered),
        ).order_by(ClassroomPublication.published_at.desc()).limit(1))
        if item:
            prompt = {"id": str(item.id), "question": item.question, "served_at": datetime.now(timezone.utc).isoformat()}
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session.id))
    return success({"session": session_row(session), "prompt": prompt,
                    "lesson_entry": lesson_entry(session, plan, user.experiment_group)})


class LessonInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    tasks: dict[Literal["pdt", "ai_pbl"], UUID] = Field(default_factory=dict, max_length=2)
    knowledge_points: list[str] = Field(default_factory=list, max_length=20)


@admin_router.get("/lesson-tasks")
async def lesson_tasks(db: AsyncSession = Depends(get_db)):
    tasks = (await db.scalars(select(ResearchTask).where(
        ResearchTask.status == ResearchTaskStatus.ACTIVE, ResearchTask.task_kind == ResearchTaskKind.LEARNING,
    ).order_by(ResearchTask.title))).all()
    return success([{"id": str(t.id), "title": t.title, "target_group": t.target_group} for t in tasks])


@admin_router.get("/sessions/{session_id}/lesson")
async def get_lesson(session_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(ClassroomSession, session_id):
        raise HTTPException(404, "课次不存在")
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session_id))
    return success(None if not plan else {"id": str(plan.id), "configuration": plan.configuration, "started_at": plan.started_at})


@admin_router.post("/sessions/{session_id}/lesson")
async def configure_lesson(session_id: UUID, body: LessonInput, db: AsyncSession = Depends(get_db)):
    await locked_session(db, session_id)
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session_id))
    if plan and plan.started_at:
        raise HTTPException(409, "本课已经开始，不能改写教学安排；请创建新课次")
    if any(not point.strip() or len(point) > 100 for point in body.knowledge_points):
        raise HTTPException(422, "每个知识点请写 1–100 字")
    tasks = {}
    for group, task_id in body.tasks.items():
        task = await db.get(ResearchTask, task_id)
        if not task or task.status != ResearchTaskStatus.ACTIVE or task.task_kind != ResearchTaskKind.LEARNING or task.target_group not in ("all", group):
            raise HTTPException(422, "所选任务未发布或不适用于该组")
        tasks[group] = {"id": str(task.id), "title": task.title, "description": task.description,
                        "instructions": task.instructions, "ai_prompt": task.ai_prompt,
                        "code_content": task.code_content, "ai_enabled": task.ai_enabled,
                        "blueprint_version_id": str(task.current_blueprint_version_id) if task.current_blueprint_version_id else None}
    config = {"version": 1, "tasks": tasks, "knowledge_points": list(dict.fromkeys(body.knowledge_points))}
    if plan:
        plan.configuration = config
    else:
        plan = LessonPlan(session_id=session_id, configuration=config)
        db.add(plan)
    await db.commit()
    return success({"id": str(plan.id), "configuration": plan.configuration, "started_at": plan.started_at})


@admin_router.post("/sessions/{session_id}/lesson/start")
async def start_lesson(session_id: UUID, db: AsyncSession = Depends(get_db), teacher: User = Depends(get_current_user)):
    session = await locked_session(db, session_id)
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.session_id == session_id))
    if effective_state(session) != "open" or not plan or not plan.configuration.get("tasks"):
        raise HTTPException(409, "先开放课次并保存本课任务")
    if not plan.started_at:
        plan.started_at = datetime.now(timezone.utc)
        db.add(ClassroomControlEvent(session_id=session_id, teacher_id=teacher.id, action="start_lesson"))
    await db.commit()
    return success({"id": str(plan.id), "started_at": plan.started_at})


@router.post("/prompts/{publication_id}/responses")
async def answer_prompt(publication_id: UUID, body: AnswerInput, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    item = await db.get(ClassroomPublication, publication_id)
    if not item:
        raise HTTPException(404, "问题不存在")
    # Shared locks: classmates submit concurrently, teacher close/publish waits.
    session = await db.scalar(select(ClassroomSession).where(ClassroomSession.id == item.session_id).with_for_update(read=True))
    if session.class_name != (user.class_name or "") or user.role not in LEARNER_ROLES:
        raise HTTPException(404, "问题不存在")
    item = await db.scalar(select(ClassroomPublication).where(ClassroomPublication.id == publication_id).execution_options(populate_existing=True).with_for_update(read=True))
    existing = await db.scalar(select(ClassroomResponse).where(ClassroomResponse.user_id == user.id, ClassroomResponse.publication_id == item.id))
    if existing:
        if existing.answer != body.answer:
            raise HTTPException(409, "已经回答，不能覆盖原答案")
        return success({"id": str(existing.id), "already_submitted": True})
    if not session.is_current or effective_state(session) != "open" or item.closed_at:
        raise HTTPException(409, "老师已结束这道题，你的草稿仍保留")
    try:
        validate_answer(item.question, body.answer)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    row_id = await db.scalar(insert(ClassroomResponse).values(user_id=user.id, publication_id=item.id, answer=body.answer,
        class_snapshot=user.class_name or "", group_snapshot=user.experiment_group).on_conflict_do_nothing(
        constraint="uq_classroom_answer").returning(ClassroomResponse.id))
    already_submitted = row_id is None
    if already_submitted:
        existing = await db.scalar(select(ClassroomResponse).where(ClassroomResponse.user_id == user.id, ClassroomResponse.publication_id == item.id))
        if existing.answer != body.answer:
            raise HTTPException(409, "已经回答，不能覆盖原答案")
        row_id = existing.id
    await db.commit()
    return success({"id": str(row_id), "already_submitted": already_submitted})


@admin_router.get("/prompts/{publication_id}/responses")
async def list_responses(publication_id: UUID, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    item = await db.get(ClassroomPublication, publication_id)
    if not item:
        raise HTTPException(404, "问题不存在")
    session = await db.get(ClassroomSession, item.session_id)
    rows = (await db.execute(select(ClassroomResponse, User).join(User, User.id == ClassroomResponse.user_id).where(
        ClassroomResponse.publication_id == item.id).order_by(ClassroomResponse.created_at, ClassroomResponse.id).limit(limit).offset(offset))).all()
    total = await db.scalar(select(func.count()).select_from(ClassroomResponse).where(ClassroomResponse.publication_id == item.id))
    students = await db.scalar(select(func.count()).select_from(User).where(User.class_name == session.class_name, User.role.in_(LEARNER_ROLES), User.is_active.is_(True)))
    return success({"prompt": {**prompt_row(item), "source": item.source}, "responses": [
        {"id": str(r.id), "user_id": str(u.id), "student_id": u.student_id, "name": u.name, "answer": r.answer, "created_at": r.created_at} for r, u in rows
    ], "total": total, "total_students": students})
