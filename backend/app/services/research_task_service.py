"""研究任务的**可见性授权**与**提交记录原子写入**。

本模块解决两类此前分散在各端点里、并且各自实现不一致的问题。

一、任务可见性（准实验数据有效性问题，不只是权限问题）
--------------------------------------------------------

``scaffoldContext.taskId`` 与路径参数 ``task_id`` 都完全来自客户端。此前
``chat.py`` 的支架上下文加载只按 UUID 查任务和蓝图，完全没有校验：

- 任务是否属于当前学生的 ``experiment_group``；
- 任务是否为 ``ACTIVE``。

后果不止于越权：对照组学生只要拿到实验组任务的 UUID，就能读取该组的教师蓝图
支架策略、让 AI 按该策略回答，并把 submission / help_request / scaffold_event
写到该任务下。**这会直接污染准实验的组间差异**，比一般的越权读取更严重。

因此所有涉及研究证据的路径统一走 :func:`get_visible_task`：不可见一律 404
（不泄漏任务是否存在），需要写入新证据时再要求 ``ACTIVE``。

二、提交记录的并发写入
----------------------

``research_task_submissions`` 现在有 ``(task_id, user_id)`` 唯一约束。原先
save-workspace / save-progress / complete 三个端点都是「先 SELECT，没有就
``db.add()``」，在下面这些真实场景下会并发插入同一对键并抛 ``IntegrityError``：

- 学生端自动保存与阶段确认同时触发；
- 学生开两个标签页；
- 两次自动保存在同一时刻发出。

所以这里提供唯一的原子入口 :func:`upsert_submission`，四条路径共用，
用 ``INSERT ... ON CONFLICT (task_id, user_id) DO UPDATE`` 一条语句完成，
既不会 500，也不需要额外行锁——单条语句内不存在丢失更新。

字段合并规则（防止「只冻结蓝图的空记录」覆盖学生内容）：

======================  ==========================================================
字段                    规则
======================  ==========================================================
``blueprint_version_id`` 只在当前为 NULL 时写入，一旦冻结不再改动
``workspace_data``       调用方不传则保持原值；传了才覆盖
``code_submitted``       调用方不传、或传空串而库中已有内容时保持原值
``started_at``           只在当前为 NULL 时写入，保留最早的开始时间
``is_completed``         只在调用方显式传值时写入
``updated_at``           只在本次确实写了内容时更新
======================  ==========================================================

"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sql.research import (
    ResearchTask,
    ResearchTaskStatus,
    ResearchTaskSubmission,
)
from app.models.sql.user import User

logger = logging.getLogger(__name__)

# 调用方用来区分「不传」与「显式传 None」。直接用 None 做哨兵无法表达
# 「把 workspace_data 显式清空」这种意图。
_UNSET: Any = object()


def entry_blueprint_version(task: ResearchTask, user_id: uuid.UUID) -> Optional[uuid.UUID]:
    """New evidence uses the published lesson version; existing submissions still win."""
    from app.services.classroom_service import lesson_evidence_context
    context = lesson_evidence_context.get()
    if context and context.get("task_id") == str(task.id) and context.get("user_id") == str(user_id):
        value = context.get("blueprint_version_id")
        return uuid.UUID(value) if value else None
    return task.current_blueprint_version_id


def parse_task_uuid(task_id: str) -> uuid.UUID:
    """把路径参数解析成 UUID，格式非法返回 400。

    与「任务不可见返回 404」区分开：格式非法说明客户端拼错了请求，
    不涉及任何存在性泄漏。
    """
    try:
        return uuid.UUID(task_id)
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid task_id") from exc


async def get_visible_task(
    db: AsyncSession,
    user: User,
    task_id: uuid.UUID,
    *,
    require_active: bool = False,
) -> ResearchTask:
    """返回该学生**有权访问**的任务，否则抛出 HTTP 异常。

    :param require_active:
        写入新的学习证据（阶段事件、产物版本、支架事件、提交记录）时必须为
        ``True``。归档或草稿任务不应再接收新证据——那会让研究数据里出现
        「任务已结束之后还在产生过程数据」这种无法解释的记录。
        只读路径（例如恢复工作区）可以为 ``False``。

    错误语义：

    - 任务不存在，或不属于当前学生的实验组 → **404**，且用同一句 detail，
      避免通过状态码差异反推「这个 UUID 是否存在」；
    - 任务可见但不是 ACTIVE 且 ``require_active`` → **409 TASK_NOT_ACTIVE**，
      前端据此提示「任务已归档」，而不是误导成「任务不存在」。
    """
    from app.services.lesson_service import check_lesson_task
    await check_lesson_task(db, user, task_id)
    task = await db.scalar(
        select(ResearchTask).where(
            ResearchTask.id == task_id,
            or_(
                ResearchTask.target_group == "all",
                ResearchTask.target_group == user.experiment_group,
            ),
        )
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    if require_active and task.status != ResearchTaskStatus.ACTIVE:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TASK_NOT_ACTIVE",
                "message": "Task is not active; new learning evidence is rejected.",
                "status": task.status.value,
            },
        )

    return task


async def upsert_submission(
    db: AsyncSession,
    task: ResearchTask,
    user_id: uuid.UUID,
    *,
    workspace_data: Any = _UNSET,
    code_submitted: Any = _UNSET,
    started_at: Any = _UNSET,
    submitted_at: Any = _UNSET,
    is_completed: Any = _UNSET,
) -> ResearchTaskSubmission:
    """原子地创建或更新学生在该任务下的提交记录。

    四条写入路径（save-workspace / save-progress / complete / 首次关键事件冻结）
    统一走这里，保证：

    1. 并发调用不会撞 ``uq_research_submission_task_user`` 而返回 500；
    2. 教师蓝图版本**只冻结一次**，后续教师发布新版本不会让学生的研究条件漂移；
    3. 只负责冻结的调用（不带任何内容）不会把学生刚保存的工作区或代码清空。

    调用方不传的字段一律保持库中原值——这是「空自动保存覆盖已有代码」这类
    数据丢失的根因，必须在 SQL 层面而不是调用方纪律上解决。
    """
    now = datetime.now(timezone.utc)
    writes_content = any(
        value is not _UNSET
        for value in (
            workspace_data,
            code_submitted,
            started_at,
            submitted_at,
            is_completed,
        )
    )

    insert_values: dict[str, Any] = {
        "task_id": task.id,
        "user_id": user_id,
        # 冻结点：第一次产生记录时就绑定教师当前版本。
        "blueprint_version_id": entry_blueprint_version(task, user_id),
        "code_submitted": "" if code_submitted is _UNSET else (code_submitted or ""),
        "is_completed": False if is_completed is _UNSET else bool(is_completed),
    }
    if workspace_data is not _UNSET:
        insert_values["workspace_data"] = workspace_data
    if started_at is not _UNSET:
        insert_values["started_at"] = started_at
    if submitted_at is not _UNSET:
        insert_values["submitted_at"] = submitted_at

    table = ResearchTaskSubmission.__table__
    stmt = pg_insert(ResearchTaskSubmission).values(**insert_values)

    # 冲突分支：逐字段决定「保留原值」还是「写入新值」。
    set_: dict[str, Any] = {
        # 已冻结就不再改动；只有从未冻结过才补写当前版本。
        "blueprint_version_id": func.coalesce(
            table.c.blueprint_version_id,
            stmt.excluded.blueprint_version_id,
        ),
    }
    if workspace_data is not _UNSET:
        set_["workspace_data"] = stmt.excluded.workspace_data
    if code_submitted is not _UNSET:
        # 空串按「本次没有内容」处理：自动保存在编辑器尚未就绪时会发空串，
        # 直接覆盖会把学生已经写好的代码抹掉。
        set_["code_submitted"] = func.coalesce(
            func.nullif(stmt.excluded.code_submitted, ""),
            table.c.code_submitted,
        )
    if started_at is not _UNSET:
        # 保留最早的开始时间，重进任务不重置学习时长。
        set_["started_at"] = func.coalesce(table.c.started_at, stmt.excluded.started_at)
    if submitted_at is not _UNSET:
        set_["submitted_at"] = stmt.excluded.submitted_at
    if is_completed is not _UNSET:
        set_["is_completed"] = stmt.excluded.is_completed
    if writes_content:
        set_["updated_at"] = now

    stmt = stmt.on_conflict_do_update(
        index_elements=["task_id", "user_id"],
        set_=set_,
    ).returning(ResearchTaskSubmission)

    result = await db.execute(stmt)
    submission = result.scalar_one()
    # ON CONFLICT DO UPDATE 直接返回最新行；identity map 里可能还留着旧副本。
    await db.refresh(submission)
    return submission


async def freeze_blueprint_version(
    db: AsyncSession,
    task: ResearchTask,
    user_id: uuid.UUID,
) -> Optional[uuid.UUID]:
    """确保学生在本任务中的教师蓝图版本被真正冻结，并返回该版本。

    仅仅「读取任务当前版本」是不够的：若学生先上报事件（此时任务为 v1），
    教师随后发布 v2，而学生尚未走过保存工作区的逻辑，后续事件就会绑定 v2，
    同一个学习过程因而跨越两个教师蓝图版本，准实验数据无法解释。

    这里不传任何内容字段，因此不会覆盖学生已保存的工作区与代码。
    """
    submission = await upsert_submission(db=db, task=task, user_id=user_id)
    return submission.blueprint_version_id
