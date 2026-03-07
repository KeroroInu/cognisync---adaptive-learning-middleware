"""
管理员认证端点
"""
from datetime import datetime, timedelta
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import jwt
import bcrypt

from app.core.config import settings
from app.db.postgres import get_db
from app.models.sql.user import User
from app.schemas.base import SuccessResponse

router = APIRouter()

# JWT 配置（与 auth.py 共用同一套配置）
_SECRET_KEY = settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production"
_ALGORITHM = "HS256"
_EXPIRE_MINUTES = settings.JWT_EXPIRES_IN


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _create_admin_token(user_id: str) -> str:
    """创建包含 role='admin' 声明的 JWT"""
    expire = datetime.utcnow() + timedelta(minutes=_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": "admin", "exp": expire}
    return jwt.encode(payload, _SECRET_KEY, algorithm=_ALGORITHM)


async def get_current_admin(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """从 Bearer JWT 中提取当前管理员用户"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录，请先登录管理员账号")

    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, _SECRET_KEY, algorithms=[_ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id or payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="非管理员账号")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token 无效")

    import uuid as _uuid
    user = await db.get(User, _uuid.UUID(user_id))
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="管理员账号不存在或已被降权")

    return user


# ──────────────────────────────────────────
# Request / Response 模型
# ──────────────────────────────────────────

class AdminLoginRequest(BaseModel):
    student_id: str
    password: str


class AdminUserInfo(BaseModel):
    id: str
    student_id: str
    name: str
    role: str
    email: Optional[str] = None
    createdAt: str
    hasCompletedOnboarding: bool


class AdminLoginData(BaseModel):
    token: str
    user: AdminUserInfo


class MeResponse(BaseModel):
    user: AdminUserInfo
    profile: Optional[Any] = None


class CreateAdminRequest(BaseModel):
    student_id: str
    password: str
    name: Optional[str] = None


# ──────────────────────────────────────────
# 端点
# ──────────────────────────────────────────

@router.post("/login")
async def admin_login(
    data: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """管理员登录 - 验证学号密码并检查 admin 角色"""
    result = await db.execute(select(User).where(User.student_id == data.student_id))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not _verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="学号或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    if user.role != "admin":
        raise HTTPException(status_code=403, detail="该账号没有管理员权限，请联系管理员")

    token = _create_admin_token(str(user.id))

    return SuccessResponse(data=AdminLoginData(
        token=token,
        user=AdminUserInfo(
            id=str(user.id),
            student_id=user.student_id,
            name=user.name,
            role=user.role,
            email=user.email,
            createdAt=user.created_at.isoformat(),
            hasCompletedOnboarding=user.has_completed_onboarding,
        ),
    ))


@router.get("/me")
async def get_admin_me(current_admin: User = Depends(get_current_admin)):
    """
    获取当前管理员信息。
    返回 { user, profile } 格式，与 authStore.ts 的 bootstrap() 兼容。
    """
    return SuccessResponse(data=MeResponse(
        user=AdminUserInfo(
            id=str(current_admin.id),
            student_id=current_admin.student_id,
            name=current_admin.name,
            role=current_admin.role,
            email=current_admin.email,
            createdAt=current_admin.created_at.isoformat(),
            hasCompletedOnboarding=current_admin.has_completed_onboarding,
        ),
        profile=None,
    ))


@router.post("/create-admin")
async def create_admin(
    data: CreateAdminRequest,
    x_admin_key: Optional[str] = Header(None, alias="X-ADMIN-KEY"),
    db: AsyncSession = Depends(get_db),
):
    """
    将用户提升为管理员角色（仅限 X-ADMIN-KEY 授权）。
    - 若用户不存在则创建新用户
    - 若用户已存在则将其 role 设为 admin 并更新密码
    部署时调用一次即可。
    """
    if not settings.ADMIN_KEY:
        raise HTTPException(status_code=500, detail="服务器未配置 ADMIN_KEY")
    if not x_admin_key or x_admin_key != settings.ADMIN_KEY:
        raise HTTPException(status_code=403, detail="X-ADMIN-KEY 无效")

    result = await db.execute(select(User).where(User.student_id == data.student_id))
    user = result.scalar_one_or_none()

    new_hash = bcrypt.hashpw(data.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    if user:
        user.password_hash = new_hash
        user.role = "admin"
        if data.name:
            user.name = data.name
        await db.commit()
        return SuccessResponse(data={
            "message": f"用户 {data.student_id} 已提升为管理员",
            "student_id": user.student_id,
            "name": user.name,
        })
    else:
        import uuid as _uuid
        new_user = User(
            id=_uuid.uuid4(),
            student_id=data.student_id,
            name=data.name or data.student_id,
            role="admin",
            is_active=True,
            has_completed_onboarding=True,
            password_hash=new_hash,
        )
        db.add(new_user)
        await db.commit()
        return SuccessResponse(data={
            "message": f"管理员账号 {data.student_id} 创建成功",
            "student_id": new_user.student_id,
            "name": new_user.name,
        })
