"""
Logs Endpoint - 日志查询接口（完整实现）
"""
import logging
from uuid import UUID
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.chat import ChatMessage as ChatMessageSchema
from app.schemas.calibration import CalibrationLogResponse
from app.models.sql.message import ChatMessage
from app.models.sql.calibration_log import CalibrationLog, Dimension
from app.services.profile_service import ProfileService

router = APIRouter()
logger = logging.getLogger(__name__)


class LogsResponse(BaseModel):
    """日志响应结构"""
    messages: List[ChatMessageSchema]
    calibrationLogs: List[CalibrationLogResponse]


@router.get("/{userId}", response_model=SuccessResponse[LogsResponse])
async def get_logs(userId: str, db: AsyncSession = Depends(get_db)):
    """
    获取用户的所有日志（消息 + 校准日志）
    用于 Evidence 页面展示

    Returns:
        {
            "messages": [...],       # 对话消息（带分析）
            "calibrationLogs": [...]  # 校准日志
        }
    """
    logger.info(f"Fetching logs for user: {userId}")

    try:
        profile_service = ProfileService(db)

        # 创建/获取用户
        user = await profile_service.get_or_create_user(userId)
        user_id = user.id

        # ========== 获取对话消息 ==========
        messages_query = (
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(desc(ChatMessage.timestamp))
            .limit(100)  # 最近 100 条
        )

        messages_result = await db.execute(messages_query)
        messages = messages_result.scalars().all()

        chat_messages = [
            ChatMessageSchema(
                id=str(msg.id),
                role=msg.role.value,
                text=msg.content,
                timestamp=msg.timestamp.isoformat() + "Z",
                analysis=msg.analysis  # JSONB 字段，直接返回
            )
            for msg in reversed(messages)  # 按时间正序
        ]

        # ========== 获取校准日志 ==========
        calibration_query = (
            select(CalibrationLog)
            .where(CalibrationLog.user_id == user_id)
            .order_by(desc(CalibrationLog.timestamp))
            .limit(100)  # 最近 100 条
        )

        calibration_result = await db.execute(calibration_query)
        calibrations = calibration_result.scalars().all()

        calibration_logs = [
            CalibrationLogResponse(
                id=str(log.id),
                timestamp=log.timestamp.isoformat() + "Z",
                dimension=log.dimension.value,
                systemValue=log.system_value,
                userValue=log.user_value,
                conflictLevel=log.conflict_level.value,
                userComment=log.user_comment,
                likertTrust=log.likert_trust
            )
            for log in reversed(calibrations)  # 按时间正序
        ]

        logger.info(
            f"Retrieved logs for user {userId}: "
            f"{len(chat_messages)} messages, {len(calibration_logs)} calibrations"
        )

        return SuccessResponse(
            data=LogsResponse(
                messages=chat_messages,
                calibrationLogs=calibration_logs
            )
        )

    except Exception as e:
        logger.error(f"Failed to fetch logs for user {userId}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch logs: {str(e)}"
        )
