"""
Profile Endpoint - 学习者画像接口（完整实现）
"""
import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.profile import UserProfile, ProfileUpdateRequest, ProfileChangesResponse
from app.services.profile_service import ProfileService
from app.api.endpoints.auth import ensure_self_scope, get_current_user
from app.models.sql.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/{userId}", response_model=SuccessResponse[UserProfile])
async def get_profile(userId: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    获取用户画像

    Returns:
        UserProfile (如果用户不存在，返回默认 50/50/50)
    """
    logger.info(f"Fetching profile for user: {userId}")

    try:
        ensure_self_scope(userId, current_user)
        profile_service = ProfileService(db)

        # 获取画像（如果不存在则返回默认值）
        profile = await profile_service.get_profile(current_user.id)

        return SuccessResponse(data=profile)

    except HTTPException:
        raise
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
        ensure_self_scope(userId, current_user)
        profile_service = ProfileService(db)

        # 应用用户校准
        updated_profile = await profile_service.apply_user_override(
            user_id=current_user.id,
            cognition=update.cognition,
            affect=update.affect,
            behavior=update.behavior,
            user_comment=update.user_comment,
            likert_trust=update.likert_trust
        )

        logger.info(f"Profile updated for user {userId}: {updated_profile.model_dump()}")

        return SuccessResponse(data=updated_profile)

    except HTTPException:
        raise
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
        ensure_self_scope(userId, current_user)
        profile_service = ProfileService(db)

        # 获取最近的变化
        changes = await profile_service.get_recent_changes(current_user.id, limit=min(max(limit, 1), 50))

        return SuccessResponse(data=ProfileChangesResponse(changes=changes))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch recent changes for user {userId}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch recent changes: {str(e)}"
        )
