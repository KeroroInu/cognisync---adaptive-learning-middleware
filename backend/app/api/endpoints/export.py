"""
Export Endpoint - 导出用户所有数据
"""
import logging
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.profile import UserProfile
from app.schemas.graph import Node, Edge
from app.schemas.chat import ChatMessage as ChatMessageSchema
from app.schemas.calibration import CalibrationLogResponse
from app.models.sql.message import ChatMessage
from app.models.sql.calibration_log import CalibrationLog
from app.services.profile_service import ProfileService
from app.services.graph_service import GraphService

router = APIRouter()
logger = logging.getLogger(__name__)


class ExportResponse(BaseModel):
    """完整导出响应"""
    profile: UserProfile
    nodes: List[Node]
    edges: List[Edge]
    messages: List[ChatMessageSchema]
    calibrationLogs: List[CalibrationLogResponse]


@router.get("/{userId}", response_model=SuccessResponse[ExportResponse])
async def export_user_data(userId: str, db: AsyncSession = Depends(get_db)):
    """
    导出用户所有数据（一次性获取所有内容）

    Returns:
        {
            "profile": {...},
            "nodes": [...],
            "edges": [...],
            "messages": [...],
            "calibrationLogs": [...]
        }
    """
    logger.info(f"Exporting all data for user: {userId}")

    try:
        profile_service = ProfileService(db)
        graph_service = GraphService()

        # 创建/获取用户
        user = await profile_service.get_or_create_user(userId)
        user_id = user.id

        # ========== 1. 获取画像 ==========
        profile = await profile_service.get_profile(user_id)

        # ========== 2. 获取知识图谱 ==========
        graph_data = await graph_service.get_graph(str(user_id))

        # ========== 3. 获取对话消息 ==========
        messages_query = (
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(desc(ChatMessage.timestamp))
        )

        messages_result = await db.execute(messages_query)
        messages = messages_result.scalars().all()

        chat_messages = [
            ChatMessageSchema(
                id=str(msg.id),
                role=msg.role.value,
                text=msg.content,
                timestamp=msg.timestamp.isoformat() + "Z",
                analysis=msg.analysis
            )
            for msg in reversed(messages)
        ]

        # ========== 4. 获取校准日志 ==========
        calibration_query = (
            select(CalibrationLog)
            .where(CalibrationLog.user_id == user_id)
            .order_by(desc(CalibrationLog.timestamp))
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
            for log in reversed(calibrations)
        ]

        logger.info(
            f"Exported data for user {userId}: "
            f"profile={profile.model_dump()}, "
            f"nodes={len(graph_data.nodes)}, "
            f"edges={len(graph_data.edges)}, "
            f"messages={len(chat_messages)}, "
            f"calibrations={len(calibration_logs)}"
        )

        return SuccessResponse(
            data=ExportResponse(
                profile=profile,
                nodes=graph_data.nodes,
                edges=graph_data.edges,
                messages=chat_messages,
                calibrationLogs=calibration_logs
            )
        )

    except Exception as e:
        logger.error(f"Failed to export data for user {userId}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to export data: {str(e)}"
        )
