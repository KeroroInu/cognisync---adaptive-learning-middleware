"""管理员接口的数据库校验鉴权。"""
from typing import Optional
from uuid import UUID
from fastapi import Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from app.core.config import settings
from app.db.postgres import get_db
from app.models.sql.user import User


async def verify_admin_key(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> bool:
    """只接受管理员登录产生的 Bearer JWT，并实时核对账号状态。"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未认证，请先登录管理员账号")
    try:
        payload = jwt.decode(
            authorization.removeprefix("Bearer "),
            settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production",
            algorithms=["HS256"],
        )
        if payload.get("role") != "admin" or not payload.get("sub"):
            raise HTTPException(status_code=403, detail="非管理员账号")
        user = await db.get(User, UUID(payload["sub"]))
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status_code=401, detail="Token 无效")
    if not user or user.role != "admin" or not user.is_active:
        raise HTTPException(status_code=403, detail="管理员账号不存在、已禁用或已被降权")
    if payload.get("ver", 0) != user.auth_version:
        raise HTTPException(status_code=401, detail="密码已更新，请重新登录")
    return True
