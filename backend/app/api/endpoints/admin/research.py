"""
Admin 研究任务管理 API 端点
"""
from uuid import UUID
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.models.sql.research import ResearchTask, ResearchTaskSubmission, ResearchTaskStatus
from app.models.sql.user import User

router = APIRouter(tags=["Admin - Research Management"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ResearchTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    ai_prompt: Optional[str] = None
    code_content: str
    language: str = "python"


class ResearchTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    ai_prompt: Optional[str] = None
    code_content: Optional[str] = None
    language: Optional[str] = None


class ResearchTaskItem(BaseModel):
    id: str
    title: str
    description: Optional[str]
    instructions: Optional[str]
    ai_prompt: Optional[str]
    code_content: str
    language: str
    status: str
    submissions_count: int
    created_at: str
    updated_at: str


class ResearchSubmissionItem(BaseModel):
    id: str
    task_id: str
    user_id: str
    user_name: Optional[str]
    student_id: Optional[str]
    user_email: Optional[str]
    code_submitted: str
    is_completed: bool
    started_at: Optional[str]
    submitted_at: Optional[str]
    created_at: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/research/tasks", dependencies=[Depends(verify_admin_key)])
async def list_research_tasks(
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """获取所有研究任务列表（含提交数统计）"""
    result = await db.execute(
        select(ResearchTask).order_by(ResearchTask.created_at.desc())
    )
    tasks = result.scalars().all()

    total = await db.scalar(select(func.count()).select_from(ResearchTask)) or 0

    task_items = []
    for task in tasks:
        submissions_count = await db.scalar(
            select(func.count())
            .select_from(ResearchTaskSubmission)
            .where(ResearchTaskSubmission.task_id == task.id)
        ) or 0

        task_items.append(ResearchTaskItem(
            id=str(task.id),
            title=task.title,
            description=task.description,
            instructions=task.instructions,
            ai_prompt=task.ai_prompt,
            code_content=task.code_content,
            language=task.language,
            status=task.status.value,
            submissions_count=submissions_count,
            created_at=task.created_at.isoformat(),
            updated_at=task.updated_at.isoformat(),
        ))

    return SuccessResponse(data={"tasks": task_items, "total": total})


@router.post("/research/tasks", dependencies=[Depends(verify_admin_key)])
async def create_research_task(
    data: ResearchTaskCreate,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[ResearchTaskItem]:
    """创建新研究任务"""
    task = ResearchTask(
        title=data.title,
        description=data.description,
        instructions=data.instructions,
        ai_prompt=data.ai_prompt,
        code_content=data.code_content,
        language=data.language,
        status=ResearchTaskStatus.DRAFT,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    return SuccessResponse(data=ResearchTaskItem(
        id=str(task.id),
        title=task.title,
        description=task.description,
        instructions=task.instructions,
        ai_prompt=task.ai_prompt,
        code_content=task.code_content,
        language=task.language,
        status=task.status.value,
        submissions_count=0,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    ))


@router.patch("/research/tasks/{task_id}", dependencies=[Depends(verify_admin_key)])
async def update_research_task(
    task_id: UUID,
    data: ResearchTaskUpdate,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[ResearchTaskItem]:
    """更新研究任务"""
    result = await db.execute(select(ResearchTask).where(ResearchTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if data.title is not None:
        task.title = data.title
    if data.description is not None:
        task.description = data.description
    if data.instructions is not None:
        task.instructions = data.instructions
    if data.ai_prompt is not None:
        task.ai_prompt = data.ai_prompt
    if data.code_content is not None:
        task.code_content = data.code_content
    if data.language is not None:
        task.language = data.language
    task.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(task)

    submissions_count = await db.scalar(
        select(func.count())
        .select_from(ResearchTaskSubmission)
        .where(ResearchTaskSubmission.task_id == task.id)
    ) or 0

    return SuccessResponse(data=ResearchTaskItem(
        id=str(task.id),
        title=task.title,
        description=task.description,
        instructions=task.instructions,
        ai_prompt=task.ai_prompt,
        code_content=task.code_content,
        language=task.language,
        status=task.status.value,
        submissions_count=submissions_count,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    ))


@router.delete("/research/tasks/{task_id}", dependencies=[Depends(verify_admin_key)])
async def delete_research_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """删除研究任务（级联删除提交记录）"""
    result = await db.execute(select(ResearchTask).where(ResearchTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.delete(task)
    await db.commit()

    return SuccessResponse(data={"deleted": True, "task_id": str(task_id)})


@router.post("/research/tasks/{task_id}/activate", dependencies=[Depends(verify_admin_key)])
async def activate_research_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """激活研究任务（同时将其他激活任务归档）"""
    # 先将其他 ACTIVE 任务改为 ARCHIVED
    await db.execute(
        update(ResearchTask)
        .where(ResearchTask.status == ResearchTaskStatus.ACTIVE)
        .where(ResearchTask.id != task_id)
        .values(status=ResearchTaskStatus.ARCHIVED, updated_at=datetime.now(timezone.utc))
    )

    result = await db.execute(
        update(ResearchTask)
        .where(ResearchTask.id == task_id)
        .values(status=ResearchTaskStatus.ACTIVE, updated_at=datetime.now(timezone.utc))
        .returning(ResearchTask.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    await db.commit()
    return SuccessResponse(data={"message": "Task activated"})


@router.post("/research/tasks/{task_id}/archive", dependencies=[Depends(verify_admin_key)])
async def archive_research_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """归档研究任务"""
    result = await db.execute(
        update(ResearchTask)
        .where(ResearchTask.id == task_id)
        .values(status=ResearchTaskStatus.ARCHIVED, updated_at=datetime.now(timezone.utc))
        .returning(ResearchTask.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    await db.commit()
    return SuccessResponse(data={"message": "Task archived"})


@router.get("/research/tasks/{task_id}/submissions", dependencies=[Depends(verify_admin_key)])
async def get_task_submissions(
    task_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """获取任务的所有学生提交记录"""
    # 检查任务是否存在
    task_result = await db.execute(select(ResearchTask).where(ResearchTask.id == task_id))
    if not task_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    total = await db.scalar(
        select(func.count())
        .select_from(ResearchTaskSubmission)
        .where(ResearchTaskSubmission.task_id == task_id)
    ) or 0

    result = await db.execute(
        select(ResearchTaskSubmission, User.name, User.student_id, User.email)
        .join(User, ResearchTaskSubmission.user_id == User.id)
        .where(ResearchTaskSubmission.task_id == task_id)
        .order_by(ResearchTaskSubmission.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()

    submission_items = [
        ResearchSubmissionItem(
            id=str(sub.id),
            task_id=str(sub.task_id),
            user_id=str(sub.user_id),
            user_name=name,
            student_id=sid,
            user_email=email,
            code_submitted=sub.code_submitted,
            is_completed=sub.is_completed,
            started_at=sub.started_at.isoformat() if sub.started_at else None,
            submitted_at=sub.submitted_at.isoformat() if sub.submitted_at else None,
            created_at=sub.created_at.isoformat(),
        )
        for sub, name, sid, email in rows
    ]

    return SuccessResponse(data={
        "submissions": submission_items,
        "total": total,
        "limit": limit,
        "offset": offset,
    })
