"""
Auth API Endpoints - 认证相关接口 (PostgreSQL Database Version)
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import jwt
import bcrypt

from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    AuthResponse,
    UserInfo,
    CurrentUserResponse,
    ProfileData
)
from app.models.sql.user import User
from app.models.sql.profile import ProfileSnapshot
from app.db.postgres import get_db
from app.core.config import settings

router = APIRouter()

# JWT配置
SECRET_KEY = settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_EXPIRES_IN


def create_access_token(user_id: str) -> str:
    """创建访问令牌"""
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": str(user_id), "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def hash_password(password: str) -> str:
    """哈希密码"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
) -> User:
    """从 Authorization header 中获取当前用户"""
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"[AUTH] Authorization header: {authorization[:50] if authorization else 'None'}...")

    if not authorization or not authorization.startswith("Bearer "):
        logger.warning("[AUTH] No valid Authorization header")
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ")[1]
    logger.info(f"[AUTH] Extracted token: {token[:20]}...")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        logger.info(f"[AUTH] Decoded user_id: {user_id}")

        if user_id is None:
            logger.warning("[AUTH] No user_id in token payload")
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        logger.warning("[AUTH] Token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"[AUTH] Invalid token: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

    # 从数据库查询用户
    stmt = select(User).where(User.id == uuid.UUID(user_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        logger.warning(f"[AUTH] User not found in database: {user_id}")
        raise HTTPException(status_code=401, detail="User not found")

    logger.info(f"[AUTH] ✅ Authentication successful for user: {user.email}")
    return user


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    用户登录

    验证邮箱和密码,返回访问令牌和用户信息。
    """
    # 从数据库查找用户
    stmt = select(User).where(User.email == data.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # 验证密码
    if not user.password_hash or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # 生成token
    token = create_access_token(str(user.id))

    # 检查是否有画像（判断是否完成了onboarding）
    profile_stmt = select(ProfileSnapshot).where(
        ProfileSnapshot.user_id == user.id
    ).order_by(ProfileSnapshot.created_at.desc())
    profile_result = await db.execute(profile_stmt)
    latest_profile = profile_result.scalar_one_or_none()

    has_profile = latest_profile is not None

    # 构造用户信息
    user_info = UserInfo(
        id=str(user.id),
        email=user.email,
        name=user.name or user.email.split("@")[0],
        createdAt=user.created_at.isoformat(),
        hasCompletedOnboarding=has_profile or user.has_completed_onboarding,
        onboardingMode=user.onboarding_mode
    )

    return AuthResponse(token=token, user=user_info)


@router.post("/register", response_model=AuthResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    用户注册

    创建新用户账户，返回访问令牌和用户信息。
    """
    # 检查邮箱是否已存在
    stmt = select(User).where(User.email == data.email)
    result = await db.execute(stmt)
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 创建新用户
    new_user = User(
        id=uuid.uuid4(),
        email=data.email,
        name=data.name or data.email.split("@")[0],
        password_hash=hash_password(data.password),
        role="learner",
        is_active=True,
        created_at=datetime.utcnow(),
        onboarding_mode=data.mode,  # 'scale' or 'ai'
        has_completed_onboarding=False
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    # 生成token
    token = create_access_token(str(new_user.id))

    # 构造用户信息
    user_info = UserInfo(
        id=str(new_user.id),
        email=new_user.email,
        name=new_user.name,
        createdAt=new_user.created_at.isoformat(),
        hasCompletedOnboarding=False,
        onboardingMode=new_user.onboarding_mode
    )

    return AuthResponse(token=token, user=user_info)


@router.get("/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户信息

    从 Authorization header 中解析 token，返回用户信息和画像。
    """
    # 获取最新的画像数据
    profile_stmt = select(ProfileSnapshot).where(
        ProfileSnapshot.user_id == current_user.id
    ).order_by(ProfileSnapshot.created_at.desc())
    profile_result = await db.execute(profile_stmt)
    latest_profile = profile_result.scalar_one_or_none()

    profile_data = None
    if latest_profile:
        profile_data = ProfileData(
            cognition=latest_profile.cognition,
            affect=latest_profile.affect,
            behavior=latest_profile.behavior
        )

    user_info = UserInfo(
        id=str(current_user.id),
        email=current_user.email,
        name=current_user.name or current_user.email.split("@")[0],
        createdAt=current_user.created_at.isoformat(),
        hasCompletedOnboarding=latest_profile is not None or current_user.has_completed_onboarding,
        onboardingMode=current_user.onboarding_mode
    )

    response_data = CurrentUserResponse(user=user_info, profile=profile_data)

    # 返回包装格式以保持一致性
    return {
        "success": True,
        "data": response_data.model_dump(by_alias=True)
    }


# 辅助函数：保存用户画像（供其他模块使用）
async def save_user_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
    cognition: float,
    affect: float,
    behavior: float
):
    """保存用户画像到数据库"""
    from app.models.sql.profile import ProfileSource

    # 创建新的画像快照
    new_profile = ProfileSnapshot(
        id=uuid.uuid4(),
        user_id=user_id,
        cognition=int(cognition),
        affect=int(affect),
        behavior=int(behavior),
        source=ProfileSource.SYSTEM,
        created_at=datetime.utcnow()
    )

    db.add(new_profile)
    await db.commit()
    await db.refresh(new_profile)

    # 同时更新用户的 has_completed_onboarding 标记
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user and not user.has_completed_onboarding:
        user.has_completed_onboarding = True
        await db.commit()

    return new_profile
