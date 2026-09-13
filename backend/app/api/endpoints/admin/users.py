"""
用户管理 API 端点
"""
from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal, Optional

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.schemas.base import SuccessResponse
from app.schemas.admin.user_management import UserListResponse, UserSummary

router = APIRouter(tags=["Admin - User Management"])


@router.get("/users", dependencies=[Depends(verify_admin_key)])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    query: Optional[str] = Query(None, description="搜索关键词（邮箱或用户名）"),
    experiment_group: Optional[str] = Query(None, description="按实验条件筛选"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserListResponse]:
    """获取用户列表（分页 + 搜索）"""
    message_stats = (
        select(
            ChatMessage.user_id.label("user_id"),
            func.count(ChatMessage.id).label("message_count"),
            func.max(ChatMessage.timestamp).label("last_active_at"),
        )
        .group_by(ChatMessage.user_id)
        .subquery()
    )
    base_stmt = select(
        User,
        func.coalesce(message_stats.c.message_count, 0),
        message_stats.c.last_active_at,
    ).outerjoin(message_stats, message_stats.c.user_id == User.id)
    count_stmt = select(func.count(User.id))

    # 支持按 student_id、name、email 搜索
    if query:
        like = f"%{query}%"
        condition = or_(
            User.student_id.ilike(like),
            User.name.ilike(like),
            User.email.ilike(like)
        )
        base_stmt = base_stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    if experiment_group:
        base_stmt = base_stmt.where(User.experiment_group == experiment_group)
        count_stmt = count_stmt.where(User.experiment_group == experiment_group)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    stmt = base_stmt.offset(offset).limit(page_size).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    rows = result.all()

    user_summaries = []
    for user, msg_count, last_active in rows:
        user_summaries.append(UserSummary(
            id=str(user.id),
            student_id=user.student_id,
            email=user.email,
            name=user.name or "",
            role=getattr(user, "role", "user") or "user",
            is_active=getattr(user, "is_active", True) if hasattr(user, "is_active") else True,
            created_at=user.created_at,
            message_count=msg_count,
            last_active_at=last_active,
            class_name=user.class_name,
            experiment_group=user.experiment_group,
        ))

    return SuccessResponse(data=UserListResponse(
        users=user_summaries,
        total=total,
        page=page,
        pageSize=page_size
    ))


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    class_name: Optional[str] = None
    experiment_group: Optional[Literal["unassigned", "pdt", "ai_pbl", "lecture"]] = None


@router.patch("/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """更新用户信息（名称 / 激活状态）"""
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.experiment_group == "lecture" and user.experiment_group != "lecture":
        raise HTTPException(422, "本轮实验仅分配项目解构＋AI、常规 AI 协作两组；讲授组仅保留历史记录")

    if body.name is not None:
        user.name = body.name
    if body.is_active is not None and hasattr(user, "is_active"):
        user.is_active = body.is_active
    if body.class_name is not None:
        user.class_name = body.class_name.strip() or None
    if body.experiment_group is not None:
        user.experiment_group = body.experiment_group

    await db.commit()
    await db.refresh(user)

    return SuccessResponse(data={
        "id": str(user.id),
        "student_id": user.student_id,
        "email": user.email,
        "name": user.name or "",
        "is_active": getattr(user, "is_active", True),
        "class_name": user.class_name,
        "experiment_group": user.experiment_group,
    })


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password", dependencies=[Depends(verify_admin_key)])
async def reset_user_password(
    user_id: str,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """管理员重置用户密码"""
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="密码长度不能少于 6 位")
    if len(body.new_password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="密码不能超过 72 个字节")

    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(User).where(User.id == uid).with_for_update())
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "admin":
        raise HTTPException(422, "此入口仅重置学生密码")

    import bcrypt
    user.password_hash = bcrypt.hashpw(
        body.new_password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    user.auth_version += 1

    await db.commit()
    return SuccessResponse(data={"reset": True, "user_id": user_id})


@router.delete("/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[dict]:
    """删除用户（同时删除相关消息、画像记录）

    研究证据保护：若该用户已产生不可覆盖的研究证据（产物版本、关键事件或支架事件），
    则拒绝物理删除并返回 409。这类数据是准实验的原始记录，一次误操作删除后无法重建；
    需要移除被试时应改用停用账号或匿名化流程。
    """
    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    evidence = await _count_research_evidence(db, user_id=uid)
    if evidence["total"] > 0:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "RESEARCH_EVIDENCE_EXISTS",
                "message": (
                    "该用户已产生不可覆盖的研究证据，禁止物理删除。"
                    "请改为停用账号或先归档/匿名化研究数据。"
                ),
                "evidence": evidence,
            },
        )

    # 删除关联数据（依赖 DB 级联或手动删除）
    from app.models.sql.message import ChatMessage
    from app.models.sql.profile import ProfileSnapshot
    from sqlalchemy import delete as sql_delete

    # 上面的统计覆盖直接归属的研究记录与课堂备注，但聊天消息也可能
    # 被其他记录（例如同一会话里的支架事件）以 RESTRICT 引用。
    # 让数据库兜底，并把 IntegrityError 翻译成与上面一致的 409。
    try:
        await db.execute(sql_delete(ChatMessage).where(ChatMessage.user_id == uid))
        await db.execute(sql_delete(ProfileSnapshot).where(ProfileSnapshot.user_id == uid))
        await db.delete(user)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "RESEARCH_EVIDENCE_EXISTS",
                "message": (
                    "该用户的聊天消息被研究证据引用，禁止物理删除。"
                    "请改为停用账号或先归档/匿名化研究数据。"
                ),
            },
        ) from exc

    return SuccessResponse(data={"deleted": True, "user_id": user_id})


async def _count_research_evidence(
    db: AsyncSession,
    user_id: Optional[UUID] = None,
    task_id: Optional[UUID] = None,
) -> dict:
    """统计某个学生或任务名下的不可覆盖研究证据条数。"""
    from app.models.sql.research_event import ScaffoldEvent, StageArtifact, StageEvent
    from app.models.sql.teacher_note import TeacherNote

    counts: dict = {}
    for key, model in (
        ("artifacts", StageArtifact),
        ("stageEvents", StageEvent),
        ("scaffoldEvents", ScaffoldEvent),
    ):
        stmt = select(func.count(model.id))
        if user_id is not None:
            stmt = stmt.where(model.user_id == user_id)
        if task_id is not None:
            stmt = stmt.where(model.task_id == task_id)
        counts[key] = int(await db.scalar(stmt) or 0)

    counts["teacherNotes"] = 0
    if user_id is not None and task_id is None:
        counts["teacherNotes"] = int(await db.scalar(select(func.count(TeacherNote.id)).where(
            or_(TeacherNote.student_id == user_id, TeacherNote.teacher_id == user_id)
        )) or 0)
    counts["total"] = counts["artifacts"] + counts["stageEvents"] + counts["scaffoldEvents"] + counts["teacherNotes"]
    return counts


async def count_submission_evidence(
    db: AsyncSession,
    submission_ids: list[UUID],
) -> dict:
    """统计这些提交记录对应的「学生 × 任务」下有多少不可覆盖证据。

    删除 submission 看起来只是删一条汇总记录，实际会破坏蓝图冻结：
    记录消失后，学生的下一条事件会按教师**当前**版本重新创建 submission，
    于是同一个学习过程跨越了两个教师蓝图版本，准实验数据无法解释。

    **查询规模**：一次批量清理最多发 4 条 SQL（1 条取 (task_id,user_id) 对，
    3 条按对分组统计），与批量大小无关。此前是逐个 submission × 3 张表各发
    一条 count，40–50 人的班级一次清理就是上百条 SQL。

    Returns:
        ``{"artifacts": n, "stageEvents": n, "scaffoldEvents": n, "total": n,
        "protected": {submission_id: {证据类型: 条数}}}``。``protected`` 让管理端
        能明确告诉管理员**是哪几条**提交记录被**哪类证据**保护，而不是只给总数。
    """
    from app.models.sql.research import ResearchTaskSubmission
    from app.models.sql.research_event import ScaffoldEvent, StageArtifact, StageEvent

    empty = {
        "artifacts": 0,
        "stageEvents": 0,
        "scaffoldEvents": 0,
        "total": 0,
        "protected": {},
    }
    if not submission_ids:
        return empty

    rows = (
        await db.execute(
            select(
                ResearchTaskSubmission.id,
                ResearchTaskSubmission.task_id,
                ResearchTaskSubmission.user_id,
            ).where(ResearchTaskSubmission.id.in_(submission_ids))
        )
    ).all()
    if not rows:
        return empty

    # 同一个 (task_id, user_id) 理论上只对应一条 submission（有唯一约束），
    # 但这里仍按多值收集，避免约束尚未建立的存量库上出现 KeyError。
    by_pair: dict[tuple[UUID, UUID], list[UUID]] = {}
    for submission_id, task_id, user_id in rows:
        by_pair.setdefault((task_id, user_id), []).append(submission_id)

    task_ids = {task_id for task_id, _ in by_pair}
    user_ids = {user_id for _, user_id in by_pair}

    counts: dict = {"artifacts": 0, "stageEvents": 0, "scaffoldEvents": 0}
    protected: dict[str, dict[str, int]] = {}

    for key, model in (
        ("artifacts", StageArtifact),
        ("stageEvents", StageEvent),
        ("scaffoldEvents", ScaffoldEvent),
    ):
        # 先按 (task_id, user_id) 分组统计，再在 Python 侧筛出本批真正涉及的组合。
        # 用 IN + GROUP BY 而不是逐对 OR：前者能走 (task_id, user_id) 上的既有索引，
        # 且 SQL 长度不随批量大小增长。
        grouped = (
            await db.execute(
                select(
                    model.task_id,
                    model.user_id,
                    func.count(model.id),
                )
                .where(
                    model.task_id.in_(task_ids),
                    model.user_id.in_(user_ids),
                )
                .group_by(model.task_id, model.user_id)
            )
        ).all()

        for task_id, user_id, amount in grouped:
            pair = (task_id, user_id)
            if pair not in by_pair:
                # IN × IN 是笛卡尔积，会命中本批之外的组合，必须剔除。
                continue
            amount = int(amount or 0)
            if amount <= 0:
                continue
            counts[key] += amount
            for submission_id in by_pair[pair]:
                protected.setdefault(str(submission_id), {})[key] = amount

    counts["total"] = counts["artifacts"] + counts["stageEvents"] + counts["scaffoldEvents"]
    counts["protected"] = protected
    return counts


async def count_session_scaffold_links(
    db: AsyncSession,
    session_id: UUID,
) -> int:
    """统计该会话中有多少条消息被 ``ScaffoldEvent`` 引用。

    用途是给出**可读的** 409 与证据条数。真正的兜底是
    ``scaffold_events`` → ``chat_messages`` 的外键 ``RESTRICT``：本函数是
    「先查再删」，检查通过之后、删除发生之前仍可写入新的支架事件，
    其他删除路径也不会经过这里。
    """
    from app.models.sql.message import ChatMessage
    from app.models.sql.research_event import ScaffoldEvent

    message_ids = select(ChatMessage.id).where(ChatMessage.session_id == session_id)
    return int(
        await db.scalar(
            select(func.count(ScaffoldEvent.id)).where(
                or_(
                    ScaffoldEvent.student_message_id.in_(message_ids),
                    ScaffoldEvent.assistant_message_id.in_(message_ids),
                )
            )
        )
        or 0
    )
