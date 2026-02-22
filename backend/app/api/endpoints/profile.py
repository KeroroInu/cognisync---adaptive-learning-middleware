"""
Profile Endpoint - 学习者画像接口（完整实现）
"""
import logging
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.profile import UserProfile, ProfileUpdateRequest, ProfileChangesResponse
from app.services.profile_service import ProfileService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{userId}", response_model=SuccessResponse[UserProfile])
async def get_profile(userId: str, db: AsyncSession = Depends(get_db)):
    """
    获取用户画像

    Returns:
        UserProfile (如果用户不存在，返回默认 50/50/50)
    """
    logger.info(f"Fetching profile for user: {userId}")

    try:
        profile_service = ProfileService(db)

        # 创建/获取用户
        user = await profile_service.get_or_create_user(userId)

        # 获取画像（如果不存在则返回默认值）
        profile = await profile_service.get_profile(user.id)

        return SuccessResponse(data=profile)

    except Exception as e:
        logger.error(f"Failed to fetch profile for user {userId}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch profile: {str(e)}"
        )


@router.put("/{userId}", response_model=SuccessResponse[UserProfile])
async def update_profile(
    userId: str,
    update: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    更新用户画像（手动校准）

    用户可以修改自己的画像值，系统会记录 CalibrationLog
    用于后续的模型优化和冲突分析

    Args:
        userId: 用户 ID
        update: 更新请求（cognition/affect/behavior/user_comment/likert_trust）

    Returns:
        更新后的 UserProfile
    """
    logger.info(f"Updating profile for user: {userId}")

    try:
        profile_service = ProfileService(db)

        # 创建/获取用户
        user = await profile_service.get_or_create_user(userId)

        # 应用用户校准
        updated_profile = await profile_service.apply_user_override(
            user_id=user.id,
            cognition=update.cognition,
            affect=update.affect,
            behavior=update.behavior,
            user_comment=update.user_comment,
            likert_trust=update.likert_trust
        )

        logger.info(f"Profile updated for user {userId}: {updated_profile.model_dump()}")

        return SuccessResponse(data=updated_profile)

    except Exception as e:
        logger.error(f"Failed to update profile for user {userId}: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update profile: {str(e)}"
        )


@router.get("/{userId}/recent-changes", response_model=SuccessResponse[ProfileChangesResponse])
async def get_recent_changes(
    userId: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db)
):
    """
    获取用户画像的最近变化

    返回最近几次对话导致的画像变化

    Args:
        userId: 用户 ID
        limit: 返回的最大变化数量（默认 5）

    Returns:
        ProfileChangesResponse（包含 ProfileChange 列表）
    """
    logger.info(f"Fetching recent changes for user: {userId}, limit={limit}")

    try:
        profile_service = ProfileService(db)

        # 创建/获取用户
        user = await profile_service.get_or_create_user(userId)

        # 获取最近的变化
        changes = await profile_service.get_recent_changes(user.id, limit=limit)

        return SuccessResponse(data=ProfileChangesResponse(changes=changes))

    except Exception as e:
        logger.error(f"Failed to fetch recent changes for user {userId}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch recent changes: {str(e)}"
        )

