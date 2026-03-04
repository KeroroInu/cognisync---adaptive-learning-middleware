"""
安全和鉴权 - Admin API 认证
"""
from typing import Optional
from fastapi import HTTPException, Security, Header
from fastapi.security import APIKeyHeader
from app.core.config import settings

# Admin API Key Header
admin_key_header = APIKeyHeader(name="X-ADMIN-KEY", auto_error=False)


async def verify_admin_key(
    api_key: str = Security(admin_key_header),
    authorization: Optional[str] = Header(None),
) -> bool:
    """
    验证 Admin 请求。优先接受管理员 JWT（Bearer token），
    回退支持 X-ADMIN-KEY（向后兼容 / 开发环境）。

    JWT 验证：解码 token，检查 payload["role"] == "admin"，无需查数据库。
    X-ADMIN-KEY 验证：与服务端配置的 ADMIN_KEY 比对。
    """
    # ── 1. 优先检查 Bearer JWT（含 role="admin" 声明）──
    if authorization and authorization.startswith("Bearer "):
        import jwt
        token = authorization.split(" ")[1]
        secret = settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production"
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
            if payload.get("role") == "admin":
                return True
        except Exception:
            # token 无效/过期时继续尝试 X-ADMIN-KEY
            pass

    # ── 2. 回退到 X-ADMIN-KEY ──
    if not settings.ADMIN_KEY:
        raise HTTPException(
            status_code=500,
            detail="Admin API is disabled. ADMIN_KEY must be configured in server."
        )

    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="未认证，请登录管理员账号或提供 X-ADMIN-KEY。"
        )

    if api_key != settings.ADMIN_KEY:
        raise HTTPException(
            status_code=403,
            detail="Invalid admin API key. Access denied."
        )

    return True
