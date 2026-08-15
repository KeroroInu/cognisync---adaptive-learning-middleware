"""
用户端研究任务 API 端点
"""
import uuid
import json
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.models.sql.research import (
    ProjectBlueprintVersion,
    ResearchTask,
    ResearchTaskSubmission,
    ResearchTaskStatus,
)
from app.schemas.project_blueprint import BlueprintNode, ProjectBlueprintConfig
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


class FunctionMappingSuggestionRequest(BaseModel):
    observation_text: str = Field(default="", max_length=500)
    responsibility: str = Field(min_length=1, max_length=100)
    boundary_reason: str = Field(default="", max_length=300)
    input_text: str = Field(default="", max_length=300)
    output_text: str = Field(default="", max_length=300)
    knowledge: list[str] = Field(default_factory=list, max_length=20)


class FunctionMappingSuggestionItem(BaseModel):
    node_id: str
    title_zh: str
    match_reasons: list[str]
    score: int


class FunctionMappingSuggestionResponse(BaseModel):
    blueprint_version_id: str
    suggestions: list[FunctionMappingSuggestionItem]


def _freeze_blueprint_version(
    submission: ResearchTaskSubmission,
    task: ResearchTask,
) -> None:
    """学生一旦产生任务记录，后续教师发布新蓝图也不覆盖其研究条件。"""

    if submission.blueprint_version_id is None and task.current_blueprint_version_id is not None:
        submission.blueprint_version_id = task.current_blueprint_version_id


async def _load_student_blueprint(
    db: AsyncSession,
    task: ResearchTask,
    user_id: uuid.UUID,
) -> tuple[ProjectBlueprintConfig | None, uuid.UUID | None]:
    """Load the immutable blueprint version assigned to this student."""

    blueprint_id = await db.scalar(
        select(ResearchTaskSubmission.blueprint_version_id).where(
            ResearchTaskSubmission.task_id == task.id,
            ResearchTaskSubmission.user_id == user_id,
        )
    )
    effective_id = blueprint_id or task.current_blueprint_version_id
    if effective_id is None:
        return None, None
    raw_config = await db.scalar(
        select(ProjectBlueprintVersion.config).where(
            ProjectBlueprintVersion.id == effective_id,
            ProjectBlueprintVersion.task_id == task.id,
        )
    )
    if not raw_config:
        return None, effective_id
    return ProjectBlueprintConfig.model_validate(raw_config), effective_id


def _mapping_suggestions(
    data: FunctionMappingSuggestionRequest,
    nodes: list[BlueprintNode],
) -> list[FunctionMappingSuggestionItem]:
    """Rank teacher contracts without exposing aliases, tests or dependencies."""

    query = " ".join(
        [
            data.observation_text,
            data.responsibility,
            data.boundary_reason,
            data.input_text,
            data.output_text,
            *data.knowledge,
        ]
    ).lower()
    query = re.sub(r"\s+", " ", query)
    ranked: list[FunctionMappingSuggestionItem] = []
    for node in nodes:
        score = 0
        reasons: list[str] = []

        responsibility_terms = [node.titleZh, *node.synonyms]
        if any(term.strip().lower() in query for term in responsibility_terms if term.strip()):
            score += 5
            reasons.append("职责表达相近")

        contract_terms = [*node.contract.inputs, *node.contract.outputs]
        contract_hits = sum(
            1 for term in contract_terms if term.strip() and term.strip().lower() in query
        )
        if contract_hits:
            score += min(contract_hits, 3) * 2
            reasons.append("输入输出相近")

        knowledge_hits = sum(
            1
            for item in node.knowledge
            if item.labelZh.strip() and item.labelZh.strip().lower() in query
        )
        if knowledge_hits:
            score += min(knowledge_hits, 3)
            reasons.append("所需知识相近")

        if node.scenarioZh.strip() and node.scenarioZh.strip().lower() in query:
            score += 2
            reasons.append("运行场景相近")

        if score > 0:
            ranked.append(
                FunctionMappingSuggestionItem(
                    node_id=node.id,
                    title_zh=node.titleZh,
                    match_reasons=reasons,
                    score=score,
                )
            )

    ranked.sort(key=lambda item: (-item.score, item.title_zh, item.node_id))
    return ranked[:3]


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


@router.post("/tasks/{task_id}/blueprint/function-mapping-suggestions")
async def suggest_function_mapping(
    task_id: str,
    data: FunctionMappingSuggestionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse[FunctionMappingSuggestionResponse]:
    """Return safe contract suggestions from the student's frozen blueprint.

    The response intentionally excludes synonyms, prerequisites, hidden tests,
    scaffold rules and function templates. Mapping remains a student decision.
    """

    try:
        tid = uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid task_id") from exc

    task = await db.scalar(
        select(ResearchTask).where(
            ResearchTask.id == tid,
            or_(
                ResearchTask.target_group == "all",
                ResearchTask.target_group == current_user.experiment_group,
            ),
        )
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    blueprint, blueprint_id = await _load_student_blueprint(db, task, current_user.id)
    if blueprint is None or blueprint_id is None:
        raise HTTPException(status_code=404, detail="No published project blueprint")

    return SuccessResponse(
        data=FunctionMappingSuggestionResponse(
            blueprint_version_id=str(blueprint_id),
            suggestions=_mapping_suggestions(data, blueprint.nodes),
        )
    )


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
