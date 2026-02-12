"""
Admin 概览 API 端点
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.admin.overview import OverviewStats

router = APIRouter(tags=["Admin - Overview"])


@router.get("/overview", dependencies=[Depends(verify_admin_key)])
async def get_overview(
    db: AsyncSession = Depends(get_db)
) -> SuccessResponse[OverviewStats]:
    """
    获取系统概览统计

    需要 Admin Key 认证（X-ADMIN-KEY Header）

    Returns:
        系统各项统计数据
    """
    # 获取各表行数
    users_count = await db.scalar(text("SELECT COUNT(*) FROM users"))
    sessions_count = await db.scalar(text("SELECT COUNT(*) FROM chat_sessions")) or 0
    messages_count = await db.scalar(text("SELECT COUNT(*) FROM chat_messages"))
    templates_count = await db.scalar(text("SELECT COUNT(*) FROM scale_templates")) or 0
    responses_count = await db.scalar(text("SELECT COUNT(*) FROM scale_responses")) or 0

    stats = OverviewStats(
        users_count=users_count or 0,
        sessions_count=sessions_count,
        messages_count=messages_count or 0,
        templates_count=templates_count,
        responses_count=responses_count
    )

    return SuccessResponse(data=stats)
