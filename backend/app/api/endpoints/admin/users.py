"""
用户管理 API 端点
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

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
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[UserListResponse]:
    """
    获取用户列表（分页）

    Args:
        page: 页码
        page_size: 每页数量

    Returns:
        用户列表和统计信息
    """
    # 获取总用户数
    total_result = await db.execute(select(func.count(User.id)))
    total = total_result.scalar()

    # 获取用户列表
    offset = (page - 1) * page_size
    stmt = select(User).offset(offset).limit(page_size).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()

    # 获取每个用户的消息数
    user_summaries = []
    for user in users:
        msg_count_result = await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.user_id == user.id)
        )
        msg_count = msg_count_result.scalar()

        # 获取最后活跃时间
        last_msg_result = await db.execute(
            select(ChatMessage.timestamp)
            .where(ChatMessage.user_id == user.id)
            .order_by(ChatMessage.timestamp.desc())
            .limit(1)
        )
        last_active = last_msg_result.scalar()

        user_summaries.append(UserSummary(
            id=str(user.id),
            email=user.email,
            created_at=user.created_at,
            message_count=msg_count,
            last_active=last_active
        ))

    return SuccessResponse(data=UserListResponse(
        users=user_summaries,
        total=total,
        page=page,
        pageSize=page_size
    ))
