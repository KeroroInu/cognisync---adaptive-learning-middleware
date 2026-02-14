"""
Admin 会话管理 API 端点
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.admin.sessions import (
    SessionsListResponse,
    SessionItem,
    SessionDetail,
    SessionMessagesResponse,
    SessionMessageItem
)
from app.models.sql.chat_session import ChatSession
from app.models.sql.message import ChatMessage
from app.models.sql.user import User

router = APIRouter(tags=["Admin - Sessions"])


@router.get("/sessions", dependencies=[Depends(verify_admin_key)])
async def get_sessions(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页大小"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[SessionsListResponse]:
    """
    获取所有会话列表

    Args:
        page: 页码
        page_size: 每页大小

    Returns:
        会话列表
    """
    # 计算偏移量
    offset = (page - 1) * page_size

    # 查询总数
    total = await db.scalar(select(func.count()).select_from(ChatSession)) or 0

    # 查询会话（关联用户信息）
    result = await db.execute(
        select(ChatSession, User)
        .join(User, ChatSession.user_id == User.id)
        .order_by(ChatSession.created_at.desc())
        .limit(page_size)
        .offset(offset)
    )
    rows = result.all()

    # 构造会话列表
    sessions = []
    for session, user in rows:
        # 统计消息数量（这里需要检查 chat_messages 表是否有 session_id 字段）
        # 暂时通过时间范围来估算（这不精确，后续需要数据库迁移添加 session_id）
        message_count_result = await db.execute(
            text("""
                SELECT COUNT(*)
                FROM chat_messages
                WHERE user_id = :user_id
            """),
            {"user_id": session.user_id}
        )
        message_count = message_count_result.scalar() or 0

        # 获取最后一条消息的时间作为 updated_at
        last_message_result = await db.execute(
            text("""
                SELECT MAX(timestamp)
                FROM chat_messages
                WHERE user_id = :user_id
            """),
            {"user_id": session.user_id}
        )
        updated_at = last_message_result.scalar()

        sessions.append(SessionItem(
            id=session.id,
            user_id=session.user_id,
            user_email=user.email,
            message_count=message_count,
            created_at=session.created_at,
            updated_at=updated_at
        ))

    response = SessionsListResponse(
        sessions=sessions,
        total=total,
        page=page,
        page_size=page_size
    )

    return SuccessResponse(data=response)


@router.get("/sessions/{session_id}", dependencies=[Depends(verify_admin_key)])
async def get_session_detail(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[SessionDetail]:
    """
    获取会话详情

    Args:
        session_id: 会话 ID

    Returns:
        会话详细信息
    """
    # 查询会话
    result = await db.execute(
        select(ChatSession, User)
        .join(User, ChatSession.user_id == User.id)
        .where(ChatSession.id == session_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    session, user = row

    # 统计消息数量
    message_count_result = await db.execute(
        text("""
            SELECT COUNT(*)
            FROM chat_messages
            WHERE user_id = :user_id
        """),
        {"user_id": session.user_id}
    )
    message_count = message_count_result.scalar() or 0

    # 获取最后一条消息的时间
    last_message_result = await db.execute(
        text("""
            SELECT MAX(timestamp)
            FROM chat_messages
            WHERE user_id = :user_id
        """),
        {"user_id": session.user_id}
    )
    updated_at = last_message_result.scalar()

    session_detail = SessionDetail(
        id=session.id,
        user_id=session.user_id,
        user_email=user.email,
        message_count=message_count,
        created_at=session.created_at,
        updated_at=updated_at
    )

    return SuccessResponse(data=session_detail)


@router.get("/sessions/{session_id}/messages", dependencies=[Depends(verify_admin_key)])
async def get_session_messages(
    session_id: UUID,
    limit: int = Query(100, ge=1, le=500, description="限制数量"),
    offset: int = Query(0, ge=0, description="偏移量"),
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[SessionMessagesResponse]:
    """
    获取会话消息列表

    注意：当前实现返回该用户的所有消息（因为 chat_messages 表暂无 session_id 字段）
    后续需要数据库迁移添加 session_id 外键

    Args:
        session_id: 会话 ID
        limit: 限制数量
        offset: 偏移量

    Returns:
        会话消息列表
    """
    # 查询会话
    session = await db.scalar(select(ChatSession).where(ChatSession.id == session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # 查询该用户的所有消息（暂时无法按 session_id 过滤）
    total = await db.scalar(
        select(func.count()).select_from(ChatMessage).where(ChatMessage.user_id == session.user_id)
    ) or 0

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == session.user_id)
        .order_by(ChatMessage.timestamp.asc())
        .limit(limit)
        .offset(offset)
    )
    messages = result.scalars().all()

    message_items = [
        SessionMessageItem(
            id=msg.id,
            role=msg.role.value,
            text=msg.text,
            timestamp=msg.timestamp,
            analysis=msg.analysis
        )
        for msg in messages
    ]

    response = SessionMessagesResponse(
        messages=message_items,
        total=total,
        limit=limit,
        offset=offset
    )

    return SuccessResponse(data=response)
