"""
Calibration Endpoint - 校准日志接口
"""
import uuid
import logging
from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.endpoints.auth import get_current_user
from app.db.postgres import get_db
from app.models.sql.calibration_log import CalibrationLog, Dimension, ConflictLevel
from app.models.sql.user import User
from app.schemas.calibration import CalibrationLogCreate, CalibrationLogResponse, calculate_conflict_level
from app.schemas.base import SuccessResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("", response_model=SuccessResponse)
async def record_calibration(
    data: CalibrationLogCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    记录用户对系统画像的校准

    接收用户对某个维度的自评值，与系统值对比，计算冲突等级并保存到数据库
    """
    logger.info(f"Recording calibration for user {current_user.id}: {data.model_dump()}")

    # 计算冲突等级
    conflict_level_str = calculate_conflict_level(data.system_value, data.user_value)

    # 创建校准日志
    calibration_log = CalibrationLog(
        id=uuid.uuid4(),
        user_id=current_user.id,
        timestamp=datetime.utcnow(),
        dimension=Dimension(data.dimension),
        system_value=data.system_value,
        user_value=data.user_value,
        conflict_level=ConflictLevel(conflict_level_str),
        user_comment=data.user_comment,
        likert_trust=data.likert_trust
    )

    # 保存到数据库
    db.add(calibration_log)
    await db.commit()
    await db.refresh(calibration_log)

    # 构造响应
    response_data = CalibrationLogResponse(
        id=str(calibration_log.id),
        timestamp=calibration_log.timestamp.isoformat() + "Z",
        dimension=calibration_log.dimension.value,
        systemValue=calibration_log.system_value,
        userValue=calibration_log.user_value,
        conflictLevel=calibration_log.conflict_level.value,
        userComment=calibration_log.user_comment,
        likertTrust=calibration_log.likert_trust
    )

    logger.info(f"Calibration recorded successfully: {calibration_log.id}")

    return SuccessResponse(data=response_data.model_dump(by_alias=True))


@router.get("", response_model=SuccessResponse)
async def get_calibration_history(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户的校准历史

    返回用户最近的校准记录，用于分析用户对系统的信任度和冲突模式
    """
    logger.info(f"Fetching calibration history for user {current_user.id}, limit={limit}")

    # 查询校准历史
    stmt = select(CalibrationLog).where(
        CalibrationLog.user_id == current_user.id
    ).order_by(desc(CalibrationLog.timestamp)).limit(limit)

    result = await db.execute(stmt)
    logs = result.scalars().all()

    # 转换为响应格式
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
        for log in logs
    ]

    logger.info(f"Retrieved {len(calibration_logs)} calibration logs for user {current_user.id}")

    return SuccessResponse(data={"calibrationLogs": [log.model_dump(by_alias=True) for log in calibration_logs]})
