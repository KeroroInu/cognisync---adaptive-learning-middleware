"""
用户管理 API 端点
"""
from uuid import UUID
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from app.core.student_identity import TeachingClass, TEACHING_GROUPS, clean_student_id, student_id_filter, clean_school_class
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Literal, Optional

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.models.sql.classroom_material import MaterialReceipt
from app.schemas.base import SuccessResponse
from app.schemas.admin.user_management import UserListResponse, UserSummary
from app.services import student_artifacts

router = APIRouter(tags=["Admin - User Management"])

STUDENT_ROLES = ("learner", "student", "user")


@router.get('/users/{user_id}/artifacts', dependencies=[Depends(verify_admin_key)])
async def student_artifact_list(user_id: UUID, response: Response,
                                page: int = Query(1, ge=1),
                                page_size: int = Query(20, ge=1, le=50),
                                db: AsyncSession = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return SuccessResponse(data=await student_artifacts.list_artifacts(db, user_id, page, page_size))


@router.get('/users/{user_id}/artifacts/{receipt_id}', dependencies=[Depends(verify_admin_key)])
async def student_artifact_detail(user_id: UUID, receipt_id: UUID, response: Response,
                                  db: AsyncSession = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return SuccessResponse(data=await student_artifacts.artifact_detail(db, user_id, receipt_id))


def unassigned_filters():
    return (User.role.in_(STUDENT_ROLES),
            or_(User.experiment_group == "unassigned", User.experiment_group.is_(None)),
            or_(User.class_name.is_(None), User.class_name == ""))


def search_filter(query):
    like = f"%{query}%"
    return or_(User.student_id.ilike(like), User.name.ilike(like), User.email.ilike(like))


@router.get("/users/unassigned-ids", dependencies=[Depends(verify_admin_key)])
async def unassigned_ids(query: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Snapshot selection across pages; later registrations are not silently included."""
    stmt = select(User.id).where(*unassigned_filters()).order_by(User.id).limit(1001)
    if query:
        stmt = stmt.where(search_filter(query))
    ids = list((await db.scalars(stmt)).all())
    if len(ids) > 1000:
        raise HTTPException(422, "超过 1000 人，请先搜索缩小范围")
    return SuccessResponse(data={"ids": [str(uid) for uid in ids]})


class AssignStudentsRequest(BaseModel):
    user_ids: list[UUID] = Field(min_length=1, max_length=1000)
    class_name: TeachingClass


@router.post("/users/batch-assign", dependencies=[Depends(verify_admin_key)])
async def assign_students(body: AssignStudentsRequest, db: AsyncSession = Depends(get_db)):
    """Assign only unassigned students atomically; never rewrite historical evidence."""
    ids = set(body.user_ids)
    students = list((await db.scalars(select(User).where(User.id.in_(ids)).order_by(User.id).with_for_update())).all())
    if len(students) != len(ids):
        raise HTTPException(409, "名单已变化，请刷新后重新选择；本次未修改任何学生")
    if any(student.role not in STUDENT_ROLES or student.class_name or student.experiment_group not in (None, "unassigned") for student in students):
        raise HTTPException(409, "所选账号包含已分组学生或教师，请重新选择未分组学生；本次未修改任何学生")
    for student in students:
        student.class_name = body.class_name
        student.experiment_group = TEACHING_GROUPS[body.class_name]
    await db.commit()
    return SuccessResponse(data={"assigned": len(students), "class_name": body.class_name})


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
    # Separate aggregates avoid multiplying receipts by the student's messages.
    # Count immutable accepted versions, not client retries or download rows;
    # receipt content is deliberately never selected for this metadata page.
    receipt_stats = (
        select(
            MaterialReceipt.user_id.label("user_id"),
            func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == "submission").label("submission_count"),
            func.count(MaterialReceipt.id).filter(MaterialReceipt.kind == "download").label("download_count"),
            func.max(MaterialReceipt.created_at).filter(MaterialReceipt.kind == "submission").label("last_submitted_at"),
        )
        .group_by(MaterialReceipt.user_id)
        .subquery()
    )
    base_stmt = select(
        User,
        func.coalesce(message_stats.c.message_count, 0),
        message_stats.c.last_active_at,
        func.coalesce(receipt_stats.c.submission_count, 0).label("submission_count"),
        func.coalesce(receipt_stats.c.download_count, 0).label("download_count"),
        receipt_stats.c.last_submitted_at,
    ).outerjoin(message_stats, message_stats.c.user_id == User.id).outerjoin(
        receipt_stats, receipt_stats.c.user_id == User.id
    )
    count_stmt = select(func.count(User.id))

    # 支持按 student_id、name、email 搜索
    if query:
        condition = search_filter(query)
        base_stmt = base_stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    if experiment_group == "unassigned":
        base_stmt = base_stmt.where(*unassigned_filters())
        count_stmt = count_stmt.where(*unassigned_filters())
    elif experiment_group:
        base_stmt = base_stmt.where(User.experiment_group == experiment_group)
        count_stmt = count_stmt.where(User.experiment_group == experiment_group)

    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    offset = (page - 1) * page_size
    stmt = base_stmt.offset(offset).limit(page_size).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    rows = result.all()

    user_summaries = []
    for user, msg_count, last_active, submission_count, download_count, last_submitted_at in rows:
        user_summaries.append(UserSummary(
            id=str(user.id),
            student_id=user.student_id,
            email=user.email,
            name=user.name or "",
            gender=user.gender,
            role=getattr(user, "role", "user") or "user",
            is_active=getattr(user, "is_active", True) if hasattr(user, "is_active") else True,
            created_at=user.created_at,
            message_count=msg_count,
            last_active_at=last_active,
            submission_count=submission_count,
            download_count=download_count,
            last_submitted_at=last_submitted_at,
            class_name=user.class_name,
            school_class=user.school_class,
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
    student_id: Optional[str] = None
    gender: Optional[Literal["male", "female"]] = None
    is_active: Optional[bool] = None
    class_name: Optional[str] = None
    school_class: Optional[str] = None
    _valid_school_class = field_validator("school_class")(clean_school_class)
    experiment_group: Optional[Literal["unassigned", "pdt", "ai_pbl", "experience", "lecture"]] = None

    @field_validator("student_id")
    @classmethod
    def valid_student_id(cls, value):
        if value is None:
            raise ValueError("学号不能为空")
        return clean_student_id(value)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if value is None or not value.strip() or len(value.strip()) > 50:
            raise ValueError("请填写姓名（1—50 个字符）")
        return value.strip()

    @field_validator("class_name")
    @classmethod
    def valid_class(cls, value):
        if value is not None and len(value.strip()) > 100:
            raise ValueError("班级名称过长")
        return value.strip() if value is not None else value


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

    result = await db.execute(select(User).where(User.id == uid).with_for_update())
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.experiment_group == "lecture" and user.experiment_group != "lecture":
        raise HTTPException(422, "讲授组仅保留历史记录；体验学生请选择体验组")

    group = TEACHING_GROUPS.get(body.class_name if body.class_name is not None else user.class_name)
    if group and body.experiment_group is not None and body.experiment_group != group:
        raise HTTPException(422, "班级与课堂类型不一致，请重新选择班级")
    if body.student_id is not None and body.student_id != user.student_id:
        if user.role == 'admin':
            raise HTTPException(422, "此入口只修改学生学号，管理员账号保持不变")
        duplicate = await db.scalar(select(User.id).where(student_id_filter(User.student_id, body.student_id), User.id != uid))
        if duplicate:
            raise HTTPException(409, "这个学号已被其他账号使用，请核对后再保存")
        user.student_id = body.student_id
    if 'gender' in body.model_fields_set:
        user.gender = body.gender
    if 'school_class' in body.model_fields_set:
        user.school_class = body.school_class

    if body.name is not None:
        user.name = body.name
    if body.is_active is not None and hasattr(user, "is_active"):
        user.is_active = body.is_active
    if body.class_name is not None:
        user.class_name = body.class_name.strip() or None
    if body.experiment_group is not None:
        user.experiment_group = body.experiment_group
    if group:
        user.experiment_group = group

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "这个学号已被其他账号使用，请核对后再保存")
    await db.refresh(user)

    return SuccessResponse(data={
        "id": str(user.id),
        "student_id": user.student_id,
        "email": user.email,
        "name": user.name or "",
        "gender": user.gender,
        "is_active": getattr(user, "is_active", True),
        "class_name": user.class_name,
        "school_class": user.school_class,
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
