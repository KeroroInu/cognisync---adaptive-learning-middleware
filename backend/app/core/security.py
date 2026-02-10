"""
安全和鉴权 - Admin API 认证
"""
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from app.core.config import settings

# Admin API Key Header
admin_key_header = APIKeyHeader(name="X-ADMIN-KEY", auto_error=False)


async def verify_admin_key(api_key: str = Security(admin_key_header)) -> bool:
    """
    验证 Admin API Key

    Args:
        api_key: 从 HTTP Header "X-ADMIN-KEY" 提取的 API Key

    Returns:
        True 如果验证通过

    Raises:
        HTTPException: 403 Forbidden 如果 API Key 无效或缺失
    """
    if not api_key:
        raise HTTPException(
            status_code=403,
            detail="Missing admin API key. Please provide X-ADMIN-KEY header."
        )

    if api_key != settings.ADMIN_KEY:
        raise HTTPException(
            status_code=403,
            detail="Invalid admin API key. Access denied."
        )

    return True
