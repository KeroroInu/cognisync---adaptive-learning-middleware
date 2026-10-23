"""
Auth API Endpoints - 认证相关接口 (PostgreSQL Database Version)
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict
from fastapi import APIRouter, HTTPException, Header, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
from app.core.student_identity import student_id_filter

router = APIRouter()

# JWT配置
SECRET_KEY = settings.JWT_SECRET or "cognisync-dev-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_EXPIRES_IN

# bcrypt is deliberately CPU-expensive. Keep it off the API event loop without
# spawning a thread per student. Cancellation cannot exceed this two-worker cap.
_password_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="password")


class PasswordWorkQueue:
    """Bound password work independently of model calls and database sessions."""

    def __init__(self, workers=2, max_waiters=64, wait_timeout=25):
        self.slots = asyncio.Semaphore(workers)
        self.waiting = 0
        self.max_waiters = max_waiters
        self.wait_timeout = wait_timeout

    async def run(self, function, *args):
        if self.waiting >= self.max_waiters:
            raise HTTPException(503, detail={"code": "AUTH_BUSY", "message": "登录人数较多，请稍后再试。"})
        self.waiting += 1
        try:
            async with asyncio.timeout(self.wait_timeout):
                await self.slots.acquire()
        except TimeoutError as error:
            raise HTTPException(503, detail={"code": "AUTH_QUEUE_TIMEOUT", "message": "等待登录超时，请稍后再试。"}) from error
        finally:
            self.waiting -= 1
        try:
            work = asyncio.get_running_loop().run_in_executor(_password_executor, function, *args)
        except BaseException:
            self.slots.release()
            raise

        def completed(future):
            self.slots.release()
            # A disconnected request may no longer be awaiting this future.
            if not future.cancelled():
                future.exception()

        work.add_done_callback(completed)
        # Cancellation must not free a slot while bcrypt is still using a CPU.
        return await asyncio.shield(work)


_password_queue = None
_password_queue_loop = None


def get_password_queue():
    global _password_queue, _password_queue_loop
    loop = asyncio.get_running_loop()
    if _password_queue is None or _password_queue_loop is not loop:
        _password_queue = PasswordWorkQueue()
        _password_queue_loop = loop
    return _password_queue


def create_access_token(user_id: str, auth_version: int = 0) -> str:
    """创建访问令牌"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": str(user_id), "exp": expire, "ver": auth_version}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def hash_password(password: str) -> str:
    """哈希密码"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码"""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except ValueError:
        return False


async def hash_password_async(password: str) -> str:
    return await get_password_queue().run(hash_password, password)


async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    return await get_password_queue().run(verify_password, plain_password, hashed_password)


def ensure_self_scope(requested_user_id: str, current_user: User) -> None:
    """旧版路由仍携带 userId；只允许当前登录者访问自己的 UUID。"""
    if requested_user_id != str(current_user.id):
        raise HTTPException(status_code=403, detail="Cannot access another user's data")


async def get_current_user(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
) -> User:
    """从 Authorization header 中获取当前用户"""
    import logging
    logger = logging.getLogger(__name__)

    if not authorization or not authorization.startswith("Bearer "):
        logger.warning("[AUTH] No valid Authorization header")
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        logger.debug("[AUTH] Token decoded")

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
    try:
        uid = uuid.UUID(user_id)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=401, detail="Invalid token")
    stmt = select(User).where(User.id == uid)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or payload.get("ver", 0) != user.auth_version:
        logger.warning(f"[AUTH] User not found in database: {user_id}")
        raise HTTPException(status_code=401, detail="User not found")

    # Outgoing review checks run before FastAPI releases request dependencies.
    # Reuse this live READ COMMITTED session to avoid holding one pool slot
    # while waiting for a second. Never cache review decisions or credentials.
    if request is not None:
        request.state.review_guard_session = db
    logger.debug("[AUTH] Authentication successful")
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
    stmt = select(User).where(student_id_filter(User.student_id, data.student_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        logger.warning(f"[LOGIN] User not found: {data.student_id}")
        raise HTTPException(status_code=401, detail="Invalid student ID or password")

    # Password work may queue. Do not retain a SQL connection while waiting;
    # copy scalars before rollback expires the ORM object.
    user_id, password_hash, auth_version = user.id, user.password_hash, user.auth_version
    await db.rollback()
    if not password_hash or not await verify_password_async(data.password, password_hash):
        logger.warning(f"[LOGIN] Invalid password for: {data.student_id}")
        raise HTTPException(status_code=401, detail="Invalid student ID or password")

    user = await db.scalar(select(User).where(User.id == user_id).execution_options(populate_existing=True))
    if (not user or not user.is_active or user.password_hash != password_hash
            or user.auth_version != auth_version):
        # A teacher may reset/disable the account while bcrypt is running.
        raise HTTPException(status_code=401, detail="账号信息已变化，请重新登录。")

    logger.info(f"[LOGIN] Password verified for user: {user.id}")

    # 生成token
    token = create_access_token(str(user.id), auth_version)
    logger.info(f"[LOGIN] Access token generated for user: {user.id}")

    # 检查是否有画像（判断是否完成了onboarding）
    profile_stmt = select(ProfileSnapshot).where(
        ProfileSnapshot.user_id == user.id
    ).order_by(ProfileSnapshot.created_at.desc()).limit(1)
    profile_result = await db.execute(profile_stmt)
    latest_profile = profile_result.scalar_one_or_none()
    # 构造用户信息
    user_info = UserInfo(
        id=str(user.id),
        student_id=user.student_id,
        email=user.email,
        name=user.name,
        gender=user.gender,
        createdAt=user.created_at.isoformat(),
        hasCompletedOnboarding=user.has_completed_onboarding,
        onboardingMode=user.onboarding_mode,
        className=user.class_name,
        schoolClass=user.school_class,
        experimentGroup=user.experiment_group,
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

    from app.core.student_identity import TEACHING_GROUPS
    # Older clients may omit className. The classroom form always supplies it;
    # never silently assign a missing/unknown class to either experiment arm.
    if data.mode == 'classroom' and data.class_name is not None:
        data.class_name = data.class_name.strip()
        if data.class_name not in TEACHING_GROUPS:
            raise HTTPException(422, "请选择解构班、开发班或体验组")

    logger.info(f"[REGISTER] Attempting registration for student_id: {data.student_id}, mode: {data.mode}")

    # No SQL transaction is opened until the bounded password work finishes.
    password_hash = await hash_password_async(data.password)

    # 检查学号是否已存在
    stmt = select(User).where(student_id_filter(User.student_id, data.student_id))
    result = await db.execute(stmt)
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # 不允许通过重复注册改写未完成账号的密码：学号是可猜的，允许覆盖
        # 等于给了账号劫持入口。中断后的正确路径是用原密码登录继续
        # （前端 App.tsx 会依据 has_completed_onboarding 自动跳回未完成的那一步）。
        #
        # 但必须把「注册没做完」和「学号已被占用」区分开。二者以前都返回同一句
        # "Student ID already registered"，学生看到后完全不知道该做什么——
        # 实际测试中就有人卡在这里反复重填。AI 模式尤其容易触发：它为了拿到
        # 后端 session，在选择模式时就建号，中途退出就会留下这样一个账号。
        if not existing_user.has_completed_onboarding:
            logger.info(
                f"[REGISTER] Resuming hint for incomplete account: {data.student_id}"
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REGISTRATION_INCOMPLETE",
                    "message": (
                        "该学号已经建立账号。"
                        "请用当时设置的密码登录继续，不用重新注册。"
                    ),
                    "onboardingMode": existing_user.onboarding_mode,
                },
            )

        logger.warning(f"[REGISTER] Student ID already registered: {data.student_id}")
        raise HTTPException(
            status_code=400,
            detail={
                "code": "STUDENT_ID_TAKEN",
                "message": "该学号已注册完成，请直接登录。",
            },
        )

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
            gender=data.gender,
            email=data.email,  # 可为 None
            password_hash=password_hash,
            role="learner",
            is_active=True,
            created_at=datetime.now(timezone.utc),
            onboarding_mode=data.mode,  # 'scale' or 'ai'
            class_name=data.class_name,
            school_class=data.school_class,
            # 当前两班准实验按所选班级映射教学组；旧客户端省略班级时保留配置默认值。
            # 不接受客户端自行指定实验组，也不修改既有答卷的班组快照。
            experiment_group=('unassigned' if data.school_class and not data.class_name else TEACHING_GROUPS.get(data.class_name, settings.DEFAULT_EXPERIMENT_GROUP)) if data.mode == 'classroom' else settings.DEFAULT_EXPERIMENT_GROUP,
            has_completed_onboarding=False
        )

        db.add(new_user)
        await db.commit()
        logger.info(f"[REGISTER] User created in database: {new_user.id}")

        await db.refresh(new_user)
        logger.info("[REGISTER] User object refreshed successfully")
        if (new_user.password_hash != password_hash or new_user.auth_version != 0
                or not new_user.is_active):
            raise HTTPException(status_code=401, detail="账号信息已变化，请重新登录。")

        # 生成token
        token = create_access_token(str(new_user.id), 0)
        logger.info(f"[REGISTER] Access token generated for user: {new_user.id}")

        # 构造用户信息
        user_info = UserInfo(
            id=str(new_user.id),
            student_id=new_user.student_id,
            email=new_user.email,
            name=new_user.name,
            gender=new_user.gender,
            createdAt=new_user.created_at.isoformat(),
            hasCompletedOnboarding=False,
            onboardingMode=new_user.onboarding_mode,
            className=new_user.class_name,
            schoolClass=new_user.school_class,
            experimentGroup=new_user.experiment_group,
        )

        # 课堂注册只建立身份。没有问卷或学习证据，不伪造 50 分前测/图谱。
        # 保留旧 scale/ai 注册的历史语义，不回写旧账号。
        if data.mode == 'classroom':
            return AuthResponse(token=token, user=user_info)

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
            created_at=datetime.now(timezone.utc)
        )

        db.add(initial_snapshot)
        await db.commit()
        logger.info(f"[REGISTER] Initial profile snapshot created for user {new_user.id}")

        if data.mode == 'ai':
            logger.info("[REGISTER] Generating initial graph for AI mode")

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

    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="账号信息已被使用，请登录或检查后重试。")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[REGISTER] Unexpected error during registration: {str(e)}", exc_info=True)

        try:
            await db.rollback()
            logger.info("[REGISTER] Attempted database rollback")
        except Exception as rollback_error:
            logger.error(f"[REGISTER] Failed to rollback: {str(rollback_error)}")

        raise HTTPException(
            status_code=500,
            detail="Registration failed due to server error"
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
        raise HTTPException(
            status_code=400,
            detail={
                "code": "STUDENT_ID_TAKEN",
                "message": "该学号已注册完成，请直接登录。",
            },
        )

    if existing_user and not existing_user.is_active:
        raise HTTPException(status_code=401, detail="账号已停用，请联系老师。")
    account_before = (
        (existing_user.id, existing_user.password_hash or "", existing_user.auth_version, existing_user.onboarding_mode)
        if existing_user else None
    )
    await db.rollback()

    # 未完成的账号可以改用量表模式继续（这是 AI 模式中断后的自助恢复路径，
    # 后续会复用该行而不是新建）。但**必须先证明是本人**。
    #
    # 复用逻辑会重写 password_hash。若不校验原密码，任何人拿到别人未完成的
    # 学号就能把账号连同密码一起接管——学号在课堂场景里是公开可猜的。
    # 后果不只是越权：接管者之后产生的全部学习数据都会挂在原学号名下，
    # 准实验的个体归属直接失效。
    #
    # /register 早已拒绝覆盖未完成账号的密码，这里却没有，属于两条注册路径
    # 的策略不一致。统一为：原密码正确才允许继续，否则给出与 /register
    # 相同的「请用原密码登录」指引。
    if account_before and not await verify_password_async(data.password, account_before[1]):
        logger.warning(
            f"[REGISTER-WITH-SCALE] Password mismatch on incomplete account: {data.student_id}"
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "REGISTRATION_INCOMPLETE",
                "message": (
                    "该学号之前已经开始注册但没有完成。"
                    "请用当时设置的密码登录，系统会自动带你回到未完成的那一步；"
                    "若要改用量表模式重新开始，请填写当时设置的密码。"
                ),
                "onboardingMode": account_before[3],
            },
        )

    password_hash = await hash_password_async(data.password)
    expected_auth_version = account_before[2] if account_before else 0
    existing_user = await db.scalar(select(User).where(User.student_id == data.student_id)
        .execution_options(populate_existing=True).with_for_update())
    if account_before:
        if (not existing_user or existing_user.id != account_before[0]
                or not existing_user.is_active or existing_user.has_completed_onboarding
                or existing_user.password_hash != account_before[1]
                or existing_user.auth_version != account_before[2]):
            raise HTTPException(status_code=409, detail="账号信息已变化，请重新登录后继续。")
    elif existing_user:
        raise HTTPException(status_code=409, detail="该学号已经建立账号，请登录继续。")

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
            new_user.password_hash   = password_hash
            new_user.class_name = data.class_name or new_user.class_name
            if data.name:
                new_user.name = data.name
        else:
            new_user = User(
                id=uuid.uuid4(),
                student_id=data.student_id,
                name=data.name,
                email=data.email,
                password_hash=password_hash,
                role="learner",
                is_active=True,
                created_at=datetime.now(timezone.utc),
                onboarding_mode='scale',
                class_name=data.class_name,
                # 与 /register 保持一致；两条注册路径的分组策略必须相同，
                # 否则同一批学生会因为选了不同注册方式而落进不同实验条件。
                experiment_group=settings.DEFAULT_EXPERIMENT_GROUP,
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
            created_at=datetime.now(timezone.utc)
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
        if (new_user.password_hash != password_hash or new_user.auth_version != expected_auth_version
                or not new_user.is_active):
            raise HTTPException(status_code=401, detail="账号信息已变化，请重新登录。")
        logger.info(f"[REGISTER-WITH-SCALE] ✅ Success: {new_user.student_id}")

        token     = create_access_token(str(new_user.id), expected_auth_version)
        user_info = UserInfo(
            id=str(new_user.id),
            student_id=new_user.student_id,
            email=new_user.email,
            name=new_user.name,
            createdAt=new_user.created_at.isoformat(),
            hasCompletedOnboarding=True,
            onboardingMode='scale',
            className=new_user.class_name,
            experimentGroup=new_user.experiment_group,
        )
        profile_data = ProfileData(cognition=cognition, affect=affect, behavior=behavior)

        return AuthResponse(token=token, user=user_info, initialProfile=profile_data)

    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="账号信息已被使用，请登录或检查后重试。")
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
        gender=current_user.gender,
        createdAt=current_user.created_at.isoformat(),
        hasCompletedOnboarding=current_user.has_completed_onboarding,
        onboardingMode=current_user.onboarding_mode,
        className=current_user.class_name,
        schoolClass=current_user.school_class,
        experimentGroup=current_user.experiment_group,
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
        created_at=datetime.now(timezone.utc)
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
