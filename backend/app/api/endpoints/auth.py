"""
Auth API Endpoints - 认证相关接口 (In-Memory MVP Version)
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict
from fastapi import APIRouter, HTTPException, Header, Depends
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

router = APIRouter()

# JWT配置
SECRET_KEY = "cognisync-dev-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours for MVP

# 内存存储（MVP版本）
users_db: Dict[str, Dict] = {}  # key: user_id, value: user data
profiles_db: Dict[str, Dict] = {}  # key: user_id, value: profile data
email_to_user_id: Dict[str, str] = {}  # key: email, value: user_id


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
    authorization: Optional[str] = Header(None)
) -> Dict:
    """从 Authorization header 中获取当前用户"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ")[1]

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = users_db.get(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return user


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest):
    """
    用户登录

    验证邮箱和密码，返回访问令牌和用户信息。
    """
    # 查找用户
    user_id = email_to_user_id.get(data.email)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = users_db.get(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # 验证密码
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # 生成token
    token = create_access_token(user_id)

    # 检查是否有画像（判断是否完成了onboarding）
    has_profile = user_id in profiles_db

    # 构造用户信息
    user_info = UserInfo(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        createdAt=user["created_at"],
        hasCompletedOnboarding=has_profile
    )

    return AuthResponse(token=token, user=user_info)


@router.post("/register", response_model=AuthResponse)
async def register(data: RegisterRequest):
    """
    用户注册

    创建新用户账户，返回访问令牌和用户信息。
    """
    # 检查邮箱是否已存在
    if data.email in email_to_user_id:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 创建新用户
    user_id = str(uuid.uuid4())
    new_user = {
        "id": user_id,
        "email": data.email,
        "name": data.name or data.email.split("@")[0],
        "password_hash": hash_password(data.password),
        "role": "learner",
        "is_active": True,
        "created_at": datetime.utcnow().isoformat(),
        "onboarding_mode": data.mode  # 'scale' or 'ai'
    }

    users_db[user_id] = new_user
    email_to_user_id[data.email] = user_id

    # 生成token
    token = create_access_token(user_id)

    # 构造用户信息
    user_info = UserInfo(
        id=user_id,
        email=new_user["email"],
        name=new_user["name"],
        createdAt=new_user["created_at"],
        hasCompletedOnboarding=False
    )

    return AuthResponse(token=token, user=user_info)


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(
    current_user: Dict = Depends(get_current_user)
):
    """
    获取当前用户信息

    从 Authorization header 中解析 token，返回用户信息和画像。
    """
    user_id = current_user["id"]

    # 获取画像数据
    profile = profiles_db.get(user_id)
    profile_data = None
    if profile:
        profile_data = ProfileData(
            cognition=profile.get("cognition", 0),
            affect=profile.get("affect", 0),
            behavior=profile.get("behavior", 0)
        )

    user_info = UserInfo(
        id=current_user["id"],
        email=current_user["email"],
        name=current_user["name"],
        createdAt=current_user["created_at"],
        hasCompletedOnboarding=profile is not None
    )

    return CurrentUserResponse(user=user_info, profile=profile_data)


# 辅助函数：保存用户画像（供其他模块使用）
def save_user_profile(user_id: str, cognition: float, affect: float, behavior: float):
    """保存用户画像到内存"""
    profiles_db[user_id] = {
        "user_id": user_id,
        "cognition": cognition,
        "affect": affect,
        "behavior": behavior,
        "recorded_at": datetime.utcnow().isoformat()
    }
