"""
API Dependencies - 依赖注入
"""
from fastapi import HTTPException, Depends
from app.api.endpoints.auth import get_current_user
from app.models.sql.user import User


async def require_completed_onboarding(
    current_user: User = Depends(get_current_user)
) -> User:
    """
    要求用户必须完成onboarding才能访问

    用于保护Dashboard、聊天、画像等需要完成引导的功能

    Args:
        current_user: 当前认证用户

    Returns:
        User: 已完成onboarding的用户

    Raises:
        HTTPException: 403 如果用户未完成onboarding
    """
    if not current_user.has_completed_onboarding:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "ONBOARDING_REQUIRED",
                "message": "Please complete the onboarding process first",
                "onboardingMode": current_user.onboarding_mode,
                "redirectTo": f"/onboarding/{current_user.onboarding_mode}" if current_user.onboarding_mode else "/register"
            }
        )

    return current_user
