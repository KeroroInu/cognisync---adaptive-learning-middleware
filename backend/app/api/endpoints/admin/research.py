"""Admin 研究任务与教师项目蓝图管理 API。"""
import hashlib
import json
from uuid import UUID
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.models.sql.research import (
    ProjectBlueprintStatus,
    ProjectBlueprintVersion,
    ResearchTask,
    ResearchTaskSubmission,
    ResearchTaskStatus,
)
from app.models.sql.user import User
from app.schemas.project_blueprint import (
    ProjectBlueprintConfig,
    validate_blueprint_for_publish,
)

router = APIRouter(tags=["Admin - Research Management"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ResearchTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    ai_prompt: Optional[str] = None
    code_content: str
    language: str = "python"
    target_group: Literal["all", "pdt", "ai_pbl", "lecture", "unassigned"] = "all"


class ResearchTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    ai_prompt: Optional[str] = None
    code_content: Optional[str] = None
    language: Optional[str] = None
    target_group: Optional[Literal["all", "pdt", "ai_pbl", "lecture", "unassigned"]] = None


class ResearchTaskItem(BaseModel):
    id: str
    title: str
    description: Optional[str]
    instructions: Optional[str]
    ai_prompt: Optional[str]
    code_content: str
    language: str
    target_group: str
    status: str
    current_blueprint_version_id: Optional[str]
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
    blueprint_version_id: Optional[str]
    is_completed: bool
    started_at: Optional[str]
    submitted_at: Optional[str]
    created_at: str


class BlueprintVersionItem(BaseModel):
    id: str
    task_id: str
    version: int
    schema_version: int
    status: str
    config: ProjectBlueprintConfig
    content_hash: str
    published_at: Optional[str]
    created_at: str
    updated_at: str


def _blueprint_item(blueprint: ProjectBlueprintVersion) -> BlueprintVersionItem:
    return BlueprintVersionItem(
        id=str(blueprint.id),
        task_id=str(blueprint.task_id),
        version=blueprint.version,
        schema_version=blueprint.schema_version,
        status=blueprint.status.value,
        config=ProjectBlueprintConfig.model_validate(blueprint.config),
        content_hash=blueprint.content_hash,
        published_at=blueprint.published_at.isoformat() if blueprint.published_at else None,
        created_at=blueprint.created_at.isoformat(),
        updated_at=blueprint.updated_at.isoformat(),
    )


def _canonical_blueprint(config: ProjectBlueprintConfig) -> tuple[dict, str]:
    payload = config.model_dump(mode="json")
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(canonical) > 262_144:
        raise HTTPException(status_code=413, detail="Blueprint exceeds 256 KB")
    return payload, hashlib.sha256(canonical).hexdigest()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/research/tasks", dependencies=[Depends(verify_admin_key)])
async def list_research_tasks(
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """获取所有研究任务列表（含提交数统计）"""
    result = await db.execute(
        select(ResearchTask, func.count(ResearchTaskSubmission.id).label("submissions_count"))
        .outerjoin(ResearchTaskSubmission, ResearchTaskSubmission.task_id == ResearchTask.id)
        .group_by(ResearchTask.id)
        .order_by(ResearchTask.created_at.desc())
    )
    task_rows = result.all()

    total = await db.scalar(select(func.count()).select_from(ResearchTask)) or 0

    task_items = []
    for task, submissions_count in task_rows:
        task_items.append(ResearchTaskItem(
            id=str(task.id),
            title=task.title,
            description=task.description,
            instructions=task.instructions,
            ai_prompt=task.ai_prompt,
            code_content=task.code_content,
            language=task.language,
            target_group=task.target_group,
            status=task.status.value,
            current_blueprint_version_id=(
                str(task.current_blueprint_version_id)
                if task.current_blueprint_version_id
                else None
            ),
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
        target_group=data.target_group,
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
        target_group=task.target_group,
        status=task.status.value,
        current_blueprint_version_id=None,
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
    if data.target_group is not None:
        task.target_group = data.target_group
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
        target_group=task.target_group,
        status=task.status.value,
        current_blueprint_version_id=(
            str(task.current_blueprint_version_id)
            if task.current_blueprint_version_id
            else None
        ),
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

    # 先解除任务指向子版本的引用，再由数据库级联删除版本和学生提交。
    task.current_blueprint_version_id = None
    await db.flush()
    await db.delete(task)
    await db.commit()

    return SuccessResponse(data={"deleted": True, "task_id": str(task_id)})


@router.post("/research/tasks/{task_id}/activate", dependencies=[Depends(verify_admin_key)])
async def activate_research_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """激活研究任务（同时将其他激活任务归档）"""
    task_result = await db.execute(select(ResearchTask).where(ResearchTask.id == task_id))
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # 每个实验条件只保留一个当前任务，互不覆盖其他组。
    await db.execute(
        update(ResearchTask)
        .where(
            ResearchTask.status == ResearchTaskStatus.ACTIVE,
            ResearchTask.target_group == task.target_group,
        )
        .where(ResearchTask.id != task_id)
        .values(status=ResearchTaskStatus.ARCHIVED, updated_at=datetime.now(timezone.utc))
    )

    result = await db.execute(
        update(ResearchTask)
        .where(ResearchTask.id == task_id)
        .values(status=ResearchTaskStatus.ACTIVE, updated_at=datetime.now(timezone.utc))
        .returning(ResearchTask.id)
    )
    result.scalar_one()

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
    limit: int = Query(2000, ge=1, le=5000),
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
            blueprint_version_id=(
                str(sub.blueprint_version_id) if sub.blueprint_version_id else None
            ),
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


@router.delete("/research/submissions/batch", dependencies=[Depends(verify_admin_key)])
async def delete_research_submissions_batch(
    submission_ids: list[str],
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """批量删除研究任务提交记录"""
    from sqlalchemy import delete as sql_delete
    try:
        uuids = [UUID(sid) for sid in submission_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid submission_id in list")

    result = await db.execute(
        sql_delete(ResearchTaskSubmission)
        .where(ResearchTaskSubmission.id.in_(uuids))
        .returning(ResearchTaskSubmission.id)
    )
    deleted_ids = [str(row[0]) for row in result.all()]
    await db.commit()

    return SuccessResponse(data={"deleted": True, "count": len(deleted_ids)})


# ── Versioned teacher blueprint endpoints ───────────────────────────────────

@router.get(
    "/research/tasks/{task_id}/blueprints",
    dependencies=[Depends(verify_admin_key)],
)
async def list_project_blueprints(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[dict]:
    """按版本倒序读取任务的教师蓝图（管理员可见完整配置）。"""

    if not await db.scalar(select(ResearchTask.id).where(ResearchTask.id == task_id)):
        raise HTTPException(status_code=404, detail="Task not found")
    result = await db.execute(
        select(ProjectBlueprintVersion)
        .where(ProjectBlueprintVersion.task_id == task_id)
        .order_by(ProjectBlueprintVersion.version.desc())
    )
    items = [_blueprint_item(item) for item in result.scalars().all()]
    return SuccessResponse(data={"blueprints": items, "total": len(items)})


@router.put(
    "/research/tasks/{task_id}/blueprints/draft",
    dependencies=[Depends(verify_admin_key)],
)
async def save_project_blueprint_draft(
    task_id: UUID,
    data: ProjectBlueprintConfig,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[BlueprintVersionItem]:
    """更新当前草稿；若只有已发布版本则创建下一个版本草稿。"""

    task = await db.scalar(
        select(ResearchTask).where(ResearchTask.id == task_id).with_for_update()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    config, content_hash = _canonical_blueprint(data)
    draft = await db.scalar(
        select(ProjectBlueprintVersion)
        .where(
            ProjectBlueprintVersion.task_id == task_id,
            ProjectBlueprintVersion.status == ProjectBlueprintStatus.DRAFT,
        )
        .order_by(ProjectBlueprintVersion.version.desc())
        .limit(1)
        .with_for_update()
    )
    now = datetime.now(timezone.utc)
    if draft:
        draft.config = config
        draft.schema_version = data.schemaVersion
        draft.content_hash = content_hash
        draft.updated_at = now
    else:
        latest_version = await db.scalar(
            select(func.max(ProjectBlueprintVersion.version)).where(
                ProjectBlueprintVersion.task_id == task_id
            )
        ) or 0
        draft = ProjectBlueprintVersion(
            task_id=task_id,
            version=latest_version + 1,
            schema_version=data.schemaVersion,
            status=ProjectBlueprintStatus.DRAFT,
            config=config,
            content_hash=content_hash,
        )
        db.add(draft)

    await db.commit()
    await db.refresh(draft)
    return SuccessResponse(data=_blueprint_item(draft))


@router.post(
    "/research/tasks/{task_id}/blueprints/{blueprint_id}/publish",
    dependencies=[Depends(verify_admin_key)],
)
async def publish_project_blueprint(
    task_id: UUID,
    blueprint_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SuccessResponse[BlueprintVersionItem]:
    """发布不可覆盖的蓝图版本，并把任务当前版本指向它。"""

    task = await db.scalar(
        select(ResearchTask).where(ResearchTask.id == task_id).with_for_update()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    blueprint = await db.scalar(
        select(ProjectBlueprintVersion)
        .where(
            ProjectBlueprintVersion.id == blueprint_id,
            ProjectBlueprintVersion.task_id == task_id,
        )
        .with_for_update()
    )
    if not blueprint:
        raise HTTPException(status_code=404, detail="Blueprint not found")

    if blueprint.status == ProjectBlueprintStatus.DRAFT:
        try:
            config = ProjectBlueprintConfig.model_validate(blueprint.config)
            validate_blueprint_for_publish(config)
        except (ValidationError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        blueprint.status = ProjectBlueprintStatus.PUBLISHED
        blueprint.published_at = datetime.now(timezone.utc)
        blueprint.updated_at = blueprint.published_at

    task.current_blueprint_version_id = blueprint.id
    task.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(blueprint)
    return SuccessResponse(data=_blueprint_item(blueprint))
