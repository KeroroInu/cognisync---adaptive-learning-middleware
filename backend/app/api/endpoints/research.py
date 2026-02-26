"""
用户端研究任务 API 端点
"""
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.models.sql.research import ResearchTask, ResearchTaskSubmission, ResearchTaskStatus
from app.models.sql.user import User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ActiveTaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    instructions: Optional[str]
    code_content: str
    language: str


class SaveProgressRequest(BaseModel):
    code_submitted: str


class CompleteTaskRequest(BaseModel):
    code_submitted: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/active-task")
async def get_active_task(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[ActiveTaskResponse]:
    """获取当前激活的研究任务"""
    result = await db.execute(
        select(ResearchTask)
        .where(ResearchTask.status == ResearchTaskStatus.ACTIVE)
        .order_by(ResearchTask.updated_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="No active research task")

    return SuccessResponse(data=ActiveTaskResponse(
        id=str(task.id),
        title=task.title,
        description=task.description,
        instructions=task.instructions,
        code_content=task.code_content,
        language=task.language,
    ))


@router.post("/tasks/{task_id}/save-progress")
async def save_progress(
    task_id: str,
    data: SaveProgressRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """自动保存学生当前代码进度（upsert）"""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    # 检查任务存在
    task_result = await db.execute(select(ResearchTask).where(ResearchTask.id == tid))
    if not task_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    # 查找或创建提交记录
    result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()

    if submission:
        submission.code_submitted = data.code_submitted
        submission.updated_at = datetime.utcnow()
    else:
        submission = ResearchTaskSubmission(
            task_id=tid,
            user_id=current_user.id,
            code_submitted=data.code_submitted,
            is_completed=False,
        )
        db.add(submission)

    await db.commit()
    return SuccessResponse(data={"saved": True})


@router.post("/tasks/{task_id}/complete")
async def complete_task(
    task_id: str,
    data: CompleteTaskRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """标记任务完成并保存最终代码"""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    task_result = await db.execute(select(ResearchTask).where(ResearchTask.id == tid))
    if not task_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()

    now = datetime.utcnow()
    if submission:
        submission.code_submitted = data.code_submitted
        submission.is_completed = True
        submission.submitted_at = now
        submission.updated_at = now
    else:
        submission = ResearchTaskSubmission(
            task_id=tid,
            user_id=current_user.id,
            code_submitted=data.code_submitted,
            is_completed=True,
            submitted_at=now,
        )
        db.add(submission)

    await db.commit()
    return SuccessResponse(data={"completed": True})
