"""
用户端研究任务 API 端点
"""
import uuid
import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, or_, select
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
    ai_prompt: Optional[str]
    code_content: str
    language: str
    target_group: str
    # 当前用户的提交状态（若无提交记录则为默认值）
    is_completed: bool = False
    code_submitted: Optional[str] = None
    workspace_data: Optional[dict] = None
    blueprint_version_id: Optional[str] = None


class SaveProgressRequest(BaseModel):
    code_submitted: str
    started_at: Optional[str] = None


class CompleteTaskRequest(BaseModel):
    code_submitted: str
    started_at: Optional[str] = None


class SaveWorkspaceRequest(BaseModel):
    workspace_data: dict


def _freeze_blueprint_version(
    submission: ResearchTaskSubmission,
    task: ResearchTask,
) -> None:
    """学生一旦产生任务记录，后续教师发布新蓝图也不覆盖其研究条件。"""

    if submission.blueprint_version_id is None and task.current_blueprint_version_id is not None:
        submission.blueprint_version_id = task.current_blueprint_version_id


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/active-task")
async def get_active_task(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[ActiveTaskResponse]:
    """获取当前激活的研究任务"""
    result = await db.execute(
        select(ResearchTask)
        .where(
            ResearchTask.status == ResearchTaskStatus.ACTIVE,
            or_(
                ResearchTask.target_group == "all",
                ResearchTask.target_group == current_user.experiment_group,
            ),
        )
        .order_by(
            case((ResearchTask.target_group == current_user.experiment_group, 0), else_=1),
            ResearchTask.updated_at.desc(),
        )
        .limit(1)
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail="No active research task")

    # 查询该用户的提交记录
    sub_result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == task.id,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = sub_result.scalar_one_or_none()
    effective_blueprint_id = (
        submission.blueprint_version_id
        if submission and submission.blueprint_version_id
        else task.current_blueprint_version_id
    )

    return SuccessResponse(data=ActiveTaskResponse(
        id=str(task.id),
        title=task.title,
        description=task.description,
        instructions=task.instructions,
        ai_prompt=task.ai_prompt,
        code_content=task.code_content,
        language=task.language,
        target_group=task.target_group,
        is_completed=submission.is_completed if submission else False,
        code_submitted=submission.code_submitted if submission else None,
        workspace_data=submission.workspace_data if submission else None,
        blueprint_version_id=str(effective_blueprint_id) if effective_blueprint_id else None,
        # 当前只向学生端暴露版本标识，不返回同义表达、标准前置关系、
        # 隐藏测试和支架内部规则；后续按阶段设计专用公开视图。
    ))


@router.post("/tasks/{task_id}/save-workspace")
async def save_workspace(
    task_id: str,
    data: SaveWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """保存观察卡、功能卡、关系路径和模块进度（账号级 upsert）。"""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    # 防止异常客户端提交超大 JSON；正常完整贪吃蛇蓝图约数十 KB。
    if len(json.dumps(data.workspace_data, ensure_ascii=False)) > 262_144:
        raise HTTPException(status_code=413, detail="Workspace data too large")

    task_result = await db.execute(
        select(ResearchTask).where(
            ResearchTask.id == tid,
            or_(ResearchTask.target_group == "all", ResearchTask.target_group == current_user.experiment_group),
        )
    )
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ResearchTaskSubmission).where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()
    if submission:
        submission.workspace_data = data.workspace_data
        _freeze_blueprint_version(submission, task)
        submission.updated_at = datetime.now(timezone.utc)
    else:
        submission = ResearchTaskSubmission(
            task_id=tid,
            user_id=current_user.id,
            code_submitted="",
            workspace_data=data.workspace_data,
            blueprint_version_id=task.current_blueprint_version_id,
            is_completed=False,
        )
        db.add(submission)

    await db.commit()
    return SuccessResponse(data={"saved": True})


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
    task_result = await db.execute(
        select(ResearchTask).where(
            ResearchTask.id == tid,
            or_(ResearchTask.target_group == "all", ResearchTask.target_group == current_user.experiment_group),
        )
    )
    task = task_result.scalar_one_or_none()
    if not task:
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
        _freeze_blueprint_version(submission, task)
        if data.started_at and not submission.started_at:
            try:
                submission.started_at = datetime.fromisoformat(data.started_at.replace('Z', '+00:00'))
            except ValueError:
                pass
        submission.updated_at = datetime.now(timezone.utc)
    else:
        started = None
        if data.started_at:
            try:
                started = datetime.fromisoformat(data.started_at.replace('Z', '+00:00'))
            except ValueError:
                pass
        submission = ResearchTaskSubmission(
            task_id=tid,
            user_id=current_user.id,
            code_submitted=data.code_submitted,
            blueprint_version_id=task.current_blueprint_version_id,
            is_completed=False,
            started_at=started,
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

    task_result = await db.execute(
        select(ResearchTask).where(
            ResearchTask.id == tid,
            or_(ResearchTask.target_group == "all", ResearchTask.target_group == current_user.experiment_group),
        )
    )
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    started = None
    if data.started_at:
        try:
            started = datetime.fromisoformat(data.started_at.replace('Z', '+00:00'))
        except ValueError:
            pass

    if submission:
        submission.code_submitted = data.code_submitted
        _freeze_blueprint_version(submission, task)
        submission.is_completed = True
        submission.submitted_at = now
        submission.updated_at = now
        if started and not submission.started_at:
            submission.started_at = started
    else:
        submission = ResearchTaskSubmission(
            task_id=tid,
            user_id=current_user.id,
            code_submitted=data.code_submitted,
            blueprint_version_id=task.current_blueprint_version_id,
            is_completed=True,
            submitted_at=now,
            started_at=started,
        )
        db.add(submission)

    await db.commit()
    return SuccessResponse(data={"completed": True})


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[dict]:
    """撤回完成状态，允许学生重新编辑并再次提交"""
    try:
        tid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    result = await db.execute(
        select(ResearchTaskSubmission)
        .where(
            ResearchTaskSubmission.task_id == tid,
            ResearchTaskSubmission.user_id == current_user.id,
        )
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission.is_completed = False
    submission.submitted_at = None
    submission.started_at = None   # 重置计时，下次保存时重新记录
    submission.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return SuccessResponse(data={"reopened": True})
