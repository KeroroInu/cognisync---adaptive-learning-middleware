"""
数据分析统计 API 端点
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.schemas.base import SuccessResponse
from app.schemas.admin.analytics import (
    AnalyticsOverviewResponse,
    SystemOverview,
    UserActivity
)

router = APIRouter(tags=["Admin - Analytics"])


@router.get("/analytics/overview", dependencies=[Depends(verify_admin_key)])
async def get_analytics_overview(
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[AnalyticsOverviewResponse]:
    """
    获取系统概览统计

    Returns:
        系统统计数据和活跃度趋势
    """
    # 总用户数
    total_users_result = await db.execute(select(func.count(User.id)))
    total_users = total_users_result.scalar()

    # 总消息数
    total_messages_result = await db.execute(select(func.count(ChatMessage.id)))
    total_messages = total_messages_result.scalar()

    # 人均消息数
    avg_messages = total_messages / total_users if total_users > 0 else 0

    # 7天活跃用户数（简化：有消息的用户）
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    active_users_result = await db.execute(
        select(func.count(func.distinct(ChatMessage.user_id)))
        .where(ChatMessage.timestamp >= seven_days_ago)
    )
    active_users = active_users_result.scalar()

    overview = SystemOverview(
        totalUsers=total_users,
        totalMessages=total_messages,
        totalConcepts=0,  # Neo4j 数据，暂时为 0
        avgMessagesPerUser=round(avg_messages, 2),
        activeUsersLast7Days=active_users
    )

    # 活跃度趋势（简化：最近7天的消息数）
    activity_trend = []
    for i in range(7):
        date = datetime.utcnow() - timedelta(days=6-i)
        date_start = date.replace(hour=0, minute=0, second=0, microsecond=0)
        date_end = date_start + timedelta(days=1)

        msg_count_result = await db.execute(
            select(func.count(ChatMessage.id))
            .where(ChatMessage.timestamp >= date_start)
            .where(ChatMessage.timestamp < date_end)
        )
        msg_count = msg_count_result.scalar()

        active_user_count_result = await db.execute(
            select(func.count(func.distinct(ChatMessage.user_id)))
            .where(ChatMessage.timestamp >= date_start)
            .where(ChatMessage.timestamp < date_end)
        )
        active_user_count = active_user_count_result.scalar()

        activity_trend.append(UserActivity(
            date=date.strftime("%Y-%m-%d"),
            activeUsers=active_user_count,
            totalMessages=msg_count
        ))

    return SuccessResponse(data=AnalyticsOverviewResponse(
        overview=overview,
        activityTrend=activity_trend
    ))
