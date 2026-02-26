"""
Admin 用户详情 API 端点
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.admin.user_detail import (
    UserDetail,
    MessageItem,
    ProfileItem,
    ScaleResponseItem,
    CalibrationLogItem,
    GraphNodeItem,
    GraphEdgeItem,
    UserMessagesResponse,
    UserProfilesResponse,
    UserScaleResponsesResponse,
    UserCalibrationLogsResponse,
    UserGraphResponse,
)
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.models.sql.profile import ProfileSnapshot
from app.models.sql.scale import ScaleResponse, ScaleTemplate
from app.models.sql.calibration_log import CalibrationLog
from app.services.graph_service import GraphService

router = APIRouter(tags=["Admin - User Detail"])


@router.get("/users/{user_id}", dependencies=[Depends(verify_admin_key)])
async def get_user_detail(
    user_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserDetail]:
    """
    获取用户详情

    Args:
        user_id: 用户 ID

    Returns:
        用户详细信息
    """
    # 查询用户
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 统计各项数量
    messages_count = await db.scalar(
        select(func.count()).select_from(ChatMessage).where(ChatMessage.user_id == user_id)
    ) or 0

    sessions_count = await db.scalar(
        text("SELECT COUNT(*) FROM chat_sessions WHERE user_id = :user_id"),
        {"user_id": user_id}
    ) or 0

    responses_count = await db.scalar(
        select(func.count()).select_from(ScaleResponse).where(ScaleResponse.user_id == user_id)
    ) or 0

    user_detail = UserDetail(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        last_active_at=user.last_active_at,
        messages_count=messages_count,
        sessions_count=sessions_count,
        responses_count=responses_count
    )

    return SuccessResponse(data=user_detail)


@router.get("/users/{user_id}/messages", dependencies=[Depends(verify_admin_key)])
async def get_user_messages(
    user_id: UUID,
    limit: int = Query(50, ge=1, le=500, description="限制数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserMessagesResponse]:
    """
    获取用户消息列表

    Args:
        user_id: 用户 ID
        limit: 限制数量
        offset: 偏移量

    Returns:
        用户消息列表
    """
    # 查询总数
    total = await db.scalar(
        select(func.count()).select_from(ChatMessage).where(ChatMessage.user_id == user_id)
    ) or 0

    # 查询消息
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    messages = result.scalars().all()

    message_items = [
        MessageItem(
            id=msg.id,
            role=msg.role.value,
            text=msg.text,
            timestamp=msg.timestamp,
            analysis=msg.analysis
        )
        for msg in messages
    ]

    response = UserMessagesResponse(
        messages=message_items,
        total=total,
        limit=limit,
        offset=offset
    )

    return SuccessResponse(data=response)


@router.get("/users/{user_id}/profiles", dependencies=[Depends(verify_admin_key)])
async def get_user_profiles(
    user_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserProfilesResponse]:
    """
    获取用户画像快照列表

    Args:
        user_id: 用户 ID

    Returns:
        画像快照列表
    """
    # 查询总数
    total = await db.scalar(
        select(func.count()).select_from(ProfileSnapshot).where(ProfileSnapshot.user_id == user_id)
    ) or 0

    # 查询画像快照
    result = await db.execute(
        select(ProfileSnapshot)
        .where(ProfileSnapshot.user_id == user_id)
        .order_by(ProfileSnapshot.created_at.desc())
    )
    snapshots = result.scalars().all()

    profile_items = [
        ProfileItem(
            id=snap.id,
            cognition=snap.cognition,
            affect=snap.affect,
            behavior=snap.behavior,
            source=snap.source,
            created_at=snap.created_at
        )
        for snap in snapshots
    ]

    response = UserProfilesResponse(
        profiles=profile_items,
        total=total
    )

    return SuccessResponse(data=response)


@router.get("/users/{user_id}/scale-responses", dependencies=[Depends(verify_admin_key)])
async def get_user_scale_responses(
    user_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserScaleResponsesResponse]:
    """
    获取用户量表响应列表

    Args:
        user_id: 用户 ID

    Returns:
        量表响应列表
    """
    # 查询总数
    total = await db.scalar(
        select(func.count()).select_from(ScaleResponse).where(ScaleResponse.user_id == user_id)
    ) or 0

    # 查询量表响应（带模板信息）
    result = await db.execute(
        select(ScaleResponse, ScaleTemplate)
        .join(ScaleTemplate, ScaleResponse.template_id == ScaleTemplate.id)
        .where(ScaleResponse.user_id == user_id)
        .order_by(ScaleResponse.created_at.desc())
    )
    rows = result.all()

    response_items = [
        ScaleResponseItem(
            id=response.id,
            template_id=response.template_id,
            template_name=template.name,
            answers_json=response.answers_json,
            scores_json=response.scores_json,
            created_at=response.created_at
        )
        for response, template in rows
    ]

    response_data = UserScaleResponsesResponse(
        responses=response_items,
        total=total
    )

    return SuccessResponse(data=response_data)


@router.get("/users/{user_id}/calibration-logs", dependencies=[Depends(verify_admin_key)])
async def get_user_calibration_logs(
    user_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserCalibrationLogsResponse]:
    """获取用户校准日志（自评修正记录）"""
    total = await db.scalar(
        select(func.count()).select_from(CalibrationLog).where(CalibrationLog.user_id == user_id)
    ) or 0

    result = await db.execute(
        select(CalibrationLog)
        .where(CalibrationLog.user_id == user_id)
        .order_by(CalibrationLog.timestamp.desc())
    )
    logs = result.scalars().all()

    log_items = [
        CalibrationLogItem(
            id=log.id,
            timestamp=log.timestamp,
            dimension=log.dimension.value,
            system_value=log.system_value,
            user_value=log.user_value,
            conflict_level=log.conflict_level.value,
            user_comment=log.user_comment,
            likert_trust=log.likert_trust,
        )
        for log in logs
    ]

    return SuccessResponse(data=UserCalibrationLogsResponse(logs=log_items, total=total))


@router.get("/users/{user_id}/graph", dependencies=[Depends(verify_admin_key)])
async def get_user_graph(user_id: UUID) -> SuccessResponse[UserGraphResponse]:
    """获取用户知识图谱（来自 Neo4j）"""
    try:
        graph_service = GraphService()
        graph_data = await graph_service.get_graph(str(user_id))

        nodes = [
            GraphNodeItem(
                id=n.id,
                name=n.name,
                category=n.category,
                mastery=n.mastery,
                frequency=n.frequency,
                is_flagged=n.isFlagged,
            )
            for n in graph_data.nodes
        ]
        edges = [
            GraphEdgeItem(
                source=e.source,
                target=e.target,
                rel_type=e.relType,
                weight=e.weight,
            )
            for e in graph_data.edges
        ]
        return SuccessResponse(data=UserGraphResponse(nodes=nodes, edges=edges))
    except Exception:
        # Neo4j 不可用时返回空图谱
        return SuccessResponse(data=UserGraphResponse(nodes=[], edges=[]))
