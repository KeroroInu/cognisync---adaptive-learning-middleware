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

    logger.info(f"[AUTH] ✅ Authentication successful for user: {user.student_id}")
    return user


@router.post("/login", response_model=AuthResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    用户登录

    验证学号和密码，返回访问令牌和用户信息。
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"[LOGIN] Attempting login for student_id: {data.student_id}")

    # 从数据库查找用户（用学号）
    stmt = select(User).where(User.student_id == data.student_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"[LOGIN] User not found: {data.student_id}")
        raise HTTPException(status_code=401, detail="Invalid student ID or password")

    # 验证密码
    if not user.password_hash or not verify_password(data.password, user.password_hash):
        logger.warning(f"[LOGIN] Invalid password for: {data.student_id}")
        raise HTTPException(status_code=401, detail="Invalid student ID or password")

    logger.info(f"[LOGIN] Password verified for user: {user.id}")

    # 生成token
    token = create_access_token(str(user.id))
    logger.info(f"[LOGIN] Access token generated for user: {user.id}")

    # 检查是否有画像（判断是否完成了onboarding）
    profile_stmt = select(ProfileSnapshot).where(
        ProfileSnapshot.user_id == user.id
    ).order_by(ProfileSnapshot.created_at.desc()).limit(1)
    profile_result = await db.execute(profile_stmt)
    latest_profile = profile_result.scalar_one_or_none()
    has_profile = latest_profile is not None

    # 构造用户信息
    user_info = UserInfo(
        id=str(user.id),
        student_id=user.student_id,
        email=user.email,
        name=user.name,
        createdAt=user.created_at.isoformat(),
        hasCompletedOnboarding=user.has_completed_onboarding,
        onboardingMode=user.onboarding_mode
    )

    # 包含最新画像（如果有），避免前端首次渲染时显示默认值
    profile_data = None
    if latest_profile:
        profile_data = ProfileData(
            cognition=float(latest_profile.cognition),
            affect=float(latest_profile.affect),
            behavior=float(latest_profile.behavior)
        )

    logger.info(f"[LOGIN] ✅ Login successful: {user.student_id}")
    return AuthResponse(token=token, user=user_info, initialProfile=profile_data)


@router.post("/register", response_model=AuthResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    用户注册

    创建新用户账户（学号+姓名+密码，邮箱可选），返回访问令牌和用户信息。
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"[REGISTER] Attempting registration for student_id: {data.student_id}, mode: {data.mode}")

    # 检查学号是否已存在
    stmt = select(User).where(User.student_id == data.student_id)
    result = await db.execute(stmt)
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # 已完成 onboarding → 正常冲突报错
        if existing_user.has_completed_onboarding:
            logger.warning(f"[REGISTER] Student ID already registered: {data.student_id}")
            raise HTTPException(status_code=400, detail="Student ID already registered")

        # 未完成 onboarding（注册中途退出）→ 允许续接，更新信息后返回新 token
        logger.info(f"[REGISTER] Resuming incomplete registration for: {data.student_id}")
        existing_user.onboarding_mode = data.mode
        existing_user.password_hash = hash_password(data.password)
        if data.name:
            existing_user.name = data.name
        # 邮箱变更时检查唯一性
        if data.email and data.email != existing_user.email:
            email_stmt = select(User).where(User.email == data.email)
            email_result = await db.execute(email_stmt)
            if email_result.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already registered")
            existing_user.email = data.email
        await db.commit()
        await db.refresh(existing_user)

        token = create_access_token(str(existing_user.id))
        user_info = UserInfo(
            id=str(existing_user.id),
            student_id=existing_user.student_id,
            email=existing_user.email,
            name=existing_user.name,
            createdAt=existing_user.created_at.isoformat(),
            hasCompletedOnboarding=False,
            onboardingMode=existing_user.onboarding_mode
        )

        # AI 模式需要重新生成初始图谱
        initial_profile = None
        initial_graph = None
        if data.mode == 'ai':
            try:
                from app.services.personalization_service import PersonalizationService
                personalization_service = PersonalizationService()
                initial_profile = ProfileData(cognition=50.0, affect=50.0, behavior=50.0)
                initial_graph = await personalization_service.generate_initial_graph(
                    cognition=50.0, affect=50.0, behavior=50.0, num_concepts=10
                )
            except Exception as e:
                logger.warning(f"[REGISTER] Failed to generate initial graph on resume: {e}")
                initial_graph = []

        logger.info(f"[REGISTER] ✅ Resumed registration: {existing_user.student_id}")
        return AuthResponse(token=token, user=user_info, initialProfile=initial_profile, initialGraph=initial_graph)

    # 如果提供了邮箱，检查邮箱唯一性
    if data.email:
        email_stmt = select(User).where(User.email == data.email)
        email_result = await db.execute(email_stmt)
        existing_email = email_result.scalar_one_or_none()
        if existing_email:
            logger.warning(f"[REGISTER] Email already registered: {data.email}")
            raise HTTPException(status_code=400, detail="Email already registered")

    # 创建新用户
    try:
        new_user = User(
            id=uuid.uuid4(),
            student_id=data.student_id,
            name=data.name,
            email=data.email,  # 可为 None
            password_hash=hash_password(data.password),
            role="learner",
            is_active=True,
            created_at=datetime.utcnow(),
            onboarding_mode=data.mode,  # 'scale' or 'ai'
            has_completed_onboarding=False
        )

        db.add(new_user)
        await db.commit()
        logger.info(f"[REGISTER] User created in database: {new_user.id}")

        await db.refresh(new_user)
        logger.info(f"[REGISTER] User object refreshed successfully")

        # 生成token
        token = create_access_token(str(new_user.id))
        logger.info(f"[REGISTER] Access token generated for user: {new_user.id}")

        # 构造用户信息
        user_info = UserInfo(
            id=str(new_user.id),
            student_id=new_user.student_id,
            email=new_user.email,
            name=new_user.name,
            createdAt=new_user.created_at.isoformat(),
            hasCompletedOnboarding=False,
            onboardingMode=new_user.onboarding_mode
        )

        # 生成初始画像和知识图谱（仅 AI 模式）
        initial_profile = None
        initial_graph = None

        # 保存初始画像快照到数据库（system 类型）
        from app.models.sql.profile import ProfileSnapshot, ProfileSource

        initial_snapshot = ProfileSnapshot(
            user_id=new_user.id,
            cognition=50,  # 默认值
            affect=50,    # 默认值
            behavior=50,   # 默认值
            source=ProfileSource.SYSTEM,
            created_at=datetime.utcnow()
        )

        db.add(initial_snapshot)
        await db.commit()
        logger.info(f"[REGISTER] Initial profile snapshot created for user {new_user.id}")

        if data.mode == 'ai':
            logger.info(f"[REGISTER] Generating initial graph for AI mode")

            try:
                from app.services.personalization_service import PersonalizationService

                personalization_service = PersonalizationService()

                initial_profile = ProfileData(
                    cognition=50.0,
                    affect=50.0,
                    behavior=50.0
                )

                initial_graph = await personalization_service.generate_initial_graph(
                    cognition=50.0,
                    affect=50.0,
                    behavior=50.0,
                    num_concepts=10
                )

                logger.info(f"[REGISTER] Generated {len(initial_graph)} initial concepts for user {new_user.id}")

            except Exception as e:
                logger.warning(f"[REGISTER] Failed to generate initial graph: {e}, continuing without it")
                initial_graph = []

        logger.info(f"[REGISTER] ✅ Registration successful: {new_user.student_id}")
        return AuthResponse(token=token, user=user_info, initialProfile=initial_profile, initialGraph=initial_graph)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[REGISTER] Unexpected error during registration: {str(e)}", exc_info=True)

        try:
            await db.rollback()
            logger.info(f"[REGISTER] Attempted database rollback")
        except Exception as rollback_error:
            logger.error(f"[REGISTER] Failed to rollback: {str(rollback_error)}")

        raise HTTPException(
            status_code=500,
            detail=f"Registration failed due to server error"
        )


class RegisterWithScaleRequest(RegisterRequest):
    """量表模式注册：同时携带量表答案，原子性完成注册+量表提交"""
    template_id: str
    answers: Dict[str, int]
    started_at: Optional[str] = None


@router.post("/register-with-scale", response_model=AuthResponse)
async def register_with_scale(data: RegisterWithScaleRequest, db: AsyncSession = Depends(get_db)):
    """
    量表模式专用组合注册接口

    原子性地完成：创建用户账号 + 量表计分 + 画像初始化 + has_completed_onboarding=True
    用户只有在成功提交量表后才真正入库，避免注册中途退出产生孤儿账号。
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[REGISTER-WITH-SCALE] Attempting for student_id: {data.student_id}")

    # ── 学号唯一性检查 ────────────────────────────────────────────────────────
    stmt = select(User).where(User.student_id == data.student_id)
    result = await db.execute(stmt)
    existing_user = result.scalar_one_or_none()

    if existing_user and existing_user.has_completed_onboarding:
        raise HTTPException(status_code=400, detail="Student ID already registered")

    # ── 邮箱唯一性检查 ────────────────────────────────────────────────────────
    if data.email:
        email_stmt = select(User).where(User.email == data.email)
        email_result = await db.execute(email_stmt)
        if email_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email already registered")

    # ── 加载量表模板 ─────────────────────────────────────────────────────────
    from app.models.sql.scale import ScaleTemplate as ScaleTemplateModel, ScaleResponse as ScaleResponseModel
    from app.api.endpoints.forms import _compute_dim_scores, _compute_cab
    try:
        tid = uuid.UUID(data.template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template_id")

    template_result = await db.execute(
        select(ScaleTemplateModel).where(ScaleTemplateModel.id == tid)
    )
    template_model = template_result.scalar_one_or_none()
    if not template_model:
        raise HTTPException(status_code=404, detail="Scale template not found")

    # ── 计算 CAB 分数 ─────────────────────────────────────────────────────────
    scoring_json = template_model.scoring_json or {}
    mapping_json = template_model.mapping_json or {}
    schema_json  = template_model.schema_json  or {}
    dim_scores = _compute_dim_scores(data.answers, scoring_json, schema_json)
    cognition, affect, behavior = _compute_cab(dim_scores, mapping_json)
    logger.info(f"[REGISTER-WITH-SCALE] CAB=({cognition},{affect},{behavior})")

    try:
        # ── 创建或复用账号（续接未完成的注册） ───────────────────────────────
        if existing_user:
            new_user = existing_user
            new_user.onboarding_mode = data.mode
            new_user.password_hash   = hash_password(data.password)
            if data.name:
                new_user.name = data.name
        else:
            new_user = User(
                id=uuid.uuid4(),
                student_id=data.student_id,
                name=data.name,
                email=data.email,
                password_hash=hash_password(data.password),
                role="learner",
                is_active=True,
                created_at=datetime.utcnow(),
                onboarding_mode='scale',
                has_completed_onboarding=False,
            )
            db.add(new_user)
            await db.flush()  # 获取 new_user.id，但还未 commit

        # ── 画像快照 ─────────────────────────────────────────────────────────
        from app.models.sql.profile import ProfileSnapshot, ProfileSource
        initial_snapshot = ProfileSnapshot(
            user_id=new_user.id,
            cognition=cognition,
            affect=affect,
            behavior=behavior,
            source=ProfileSource.SYSTEM,
            created_at=datetime.utcnow()
        )
        db.add(initial_snapshot)

        # ── 量表响应记录 ──────────────────────────────────────────────────────
        total_score = sum(data.answers.values())
        max_score   = len(data.answers) * int(schema_json.get("likert_scale", {}).get("max", 5))
        scale_resp  = ScaleResponseModel(
            user_id=new_user.id,
            template_id=tid,
            answers_json=data.answers,
            started_at=datetime.fromisoformat(data.started_at.replace('Z', '+00:00')) if data.started_at else None,
            scores_json={
                "dimensions":  dim_scores,
                "cognition":   cognition,
                "affect":      affect,
                "behavior":    behavior,
                "total_score": total_score,
                "max_score":   max_score,
            }
        )
        db.add(scale_resp)

        # ── 标记 onboarding 完成，一次性 commit ──────────────────────────────
        new_user.has_completed_onboarding = True
        await db.commit()
        await db.refresh(new_user)
        logger.info(f"[REGISTER-WITH-SCALE] ✅ Success: {new_user.student_id}")

        token     = create_access_token(str(new_user.id))
        user_info = UserInfo(
            id=str(new_user.id),
            student_id=new_user.student_id,
            email=new_user.email,
            name=new_user.name,
            createdAt=new_user.created_at.isoformat(),
            hasCompletedOnboarding=True,
            onboardingMode='scale',
        )
        current_time = datetime.utcnow().isoformat()
        profile_data = ProfileData(cognition=cognition, affect=affect, behavior=behavior)

        return AuthResponse(token=token, user=user_info, initialProfile=profile_data)

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"[REGISTER-WITH-SCALE] Failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Registration failed due to server error")

@router.get("/me")
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取当前用户信息

    从 Authorization header 中解析 token，返回用户信息和画像。
    """
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"[ME] Fetching user info for: {current_user.student_id}")

    # 获取最新的画像数据
    profile_stmt = select(ProfileSnapshot).where(
        ProfileSnapshot.user_id == current_user.id
    ).order_by(ProfileSnapshot.created_at.desc()).limit(1)
    profile_result = await db.execute(profile_stmt)
    latest_profile = profile_result.scalar_one_or_none()

    if latest_profile:
        logger.info(f"[ME] Found profile for user: {current_user.id}")

    profile_data = None
    if latest_profile:
        profile_data = ProfileData(
            cognition=latest_profile.cognition,
            affect=latest_profile.affect,
            behavior=latest_profile.behavior
        )

    user_info = UserInfo(
        id=str(current_user.id),
        student_id=current_user.student_id,
        email=current_user.email,
        name=current_user.name,
        createdAt=current_user.created_at.isoformat(),
        hasCompletedOnboarding=current_user.has_completed_onboarding,
        onboardingMode=current_user.onboarding_mode
    )

    response_data = CurrentUserResponse(user=user_info, profile=profile_data)

    logger.info(f"[ME] ✅ User info retrieved: {current_user.student_id}")

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
