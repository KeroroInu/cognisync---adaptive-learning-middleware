"""
Chat Endpoint - 对话接口（完整实现）
"""
import logging
from uuid import UUID
from datetime import datetime, timedelta, timezone
from typing import Any, List, Dict, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.chat import ChatRequest, ChatResponse, ChatScaffoldInfo
from app.schemas.chat import ChatAnalysis
from app.schemas.profile import ProfileDelta
from app.services.profile_service import ProfileService
from app.services.graph_service import GraphService
from app.services.emotion_log_service import record_emotion_log
from app.services.text_analyzer import TextAnalyzer
from app.services.llm_config import get_chat_provider
from app.services.learning_agent_harness import learning_agent_harness
from app.models.sql.message import ChatMessage, MessageRole
from app.models.sql.chat_session import ChatSession
from app.models.sql.research import ProjectBlueprintVersion, ResearchTask, ResearchTaskSubmission
from app.models.sql.research_event import (
    ProjectStage,
    ScaffoldDeliveryStatus,
    StageEventType,
)
from app.schemas.project_blueprint import BlueprintScaffoldPolicy, ProjectBlueprintConfig
from app.models.sql.user import User
from app.api.endpoints.auth import get_current_user
from app.services.scaffold_service import (
    build_controlled_scaffold_response,
    build_scaffold_metadata,
    build_scaffold_prompt,
    summarize_project_workspace,
)
from app.services.research_event_service import (
    freeze_blueprint_version,
    record_scaffold_event,
    record_stage_event,
)
from app.services.research_task_service import get_visible_task, parse_task_uuid

router = APIRouter()
logger = logging.getLogger(__name__)


async def get_or_create_active_session(db: AsyncSession, user_id: UUID) -> ChatSession:
    """获取最近 30 分钟内的活跃会话，不存在则创建新会话"""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user_id, ChatSession.created_at >= cutoff)
        .order_by(ChatSession.created_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        session = ChatSession(user_id=user_id)
        db.add(session)
        await db.commit()
        await db.refresh(session)
        logger.info(f"Created new chat session for user {user_id}: {session.id}")
    return session


async def _resolve_scaffold_task(
    db: AsyncSession,
    user: User,
    scaffold_context,
) -> ResearchTask:
    """校验 ``scaffoldContext.taskId`` 并返回该学生**有权使用**的任务。

    这一步不是普通的越权防护，而是准实验的组间隔离。``taskId`` 完全来自客户端，
    此前的实现只按 UUID 查任务和蓝图，因此对照组学生只要拿到实验组任务的 UUID：

    - 就能让 AI 加载该组的教师蓝图支架策略并按其作答；
    - 还能把 submission / help_request / scaffold_event 写到该任务下。

    这会直接污染组间差异，比一般越权读取更严重，所以携带 scaffoldContext 的请求
    一律显式拒绝而不是静默降级——静默降级会产出 ``task_id=NULL`` 的规范事件行，
    在导出时无法与真实数据区分。
    """
    tid = parse_task_uuid(str(scaffold_context.taskId))
    return await get_visible_task(db, user, tid, require_active=True)


async def _record_help_request_event(
    db: AsyncSession,
    user_id: UUID,
    task: ResearchTask,
    scaffold_metadata: dict,
) -> None:
    """记录「学生发起了一次求助」这一行为本身。

    与 ``scaffold_event`` 的分工：本事件在请求进入时写入，表示求助行为已经发生；
    ``scaffold_event`` 只在建议成功送达后写入。模型超时或失败时，求助行为仍然
    可追踪，但不会产生「已送达支架」的假记录。

    幂等键复用支架的 ``requestId``，因此客户端重试不会把一次求助计成多次。

    任务的可见性与 ACTIVE 状态已由 :func:`_resolve_scaffold_task` 在调用前校验，
    这里不再重复查询，也不再接受未经授权的任务。

    仍然静默跳过的两种情况（均不影响对话主流程）：
    - 缺少 ``requestId``：无法保证幂等，宁可不记录也不产生无法去重的行；
    - ``stage`` 不在枚举内：说明客户端上下文异常，不应写入脏数据。
    """
    request_id = str(scaffold_metadata.get("requestId") or "").strip()
    if not request_id:
        return

    try:
        stage = ProjectStage(str(scaffold_metadata.get("stage") or ""))
    except ValueError:
        return

    blueprint_version_id = await freeze_blueprint_version(db, task, user_id)

    await record_stage_event(
        db=db,
        task_id=task.id,
        user_id=user_id,
        request_id=request_id,
        stage=stage,
        event_type=StageEventType.HELP_REQUEST,
        detail={
            "trigger": scaffold_metadata.get("trigger"),
            "requestedLevel": scaffold_metadata.get("requestedLevel"),
            "appliedLevel": scaffold_metadata.get("level"),
            "policySource": scaffold_metadata.get("policySource"),
            "currentModule": scaffold_metadata.get("currentModule"),
        },
        blueprint_version_id=blueprint_version_id,
    )


async def _load_scaffold_workspace_context(
    db: AsyncSession,
    user_id: UUID,
    task: ResearchTask,
) -> tuple[str, BlueprintScaffoldPolicy | None, str | None]:
    """读取当前学生的任务快照和冻结蓝图支架策略。

    已开始任务的学生继续使用首次绑定的蓝图版本；尚无提交记录时才
    回退到任务当前发布版本。不向客户端返回隐藏规则。

    ``task`` 必须是 :func:`_resolve_scaffold_task` 校验过的对象——此前这里接收
    裸 ``task_id`` 字符串并直接按 UUID 查询，任何学生都能借此读到其他实验组的
    支架策略。
    """

    parsed_task_id = task.id

    submission_result = await db.execute(
        select(
            ResearchTaskSubmission.workspace_data,
            ResearchTaskSubmission.blueprint_version_id,
        ).where(
            ResearchTaskSubmission.task_id == parsed_task_id,
            ResearchTaskSubmission.user_id == user_id,
        )
        .order_by(ResearchTaskSubmission.updated_at.desc())
        .limit(1)
    )
    submission = submission_result.first()
    workspace = submission.workspace_data if submission else None
    blueprint_id = submission.blueprint_version_id if submission else None

    if blueprint_id is None:
        blueprint_id = task.current_blueprint_version_id

    if blueprint_id is None:
        return summarize_project_workspace(workspace), None, None

    raw_config = await db.scalar(
        select(ProjectBlueprintVersion.config).where(
            ProjectBlueprintVersion.id == blueprint_id,
            ProjectBlueprintVersion.task_id == parsed_task_id,
        )
    )
    if not raw_config:
        return summarize_project_workspace(workspace), None, str(blueprint_id)

    try:
        policy = ProjectBlueprintConfig.model_validate(raw_config).scaffoldPolicy
    except Exception as validation_error:
        logger.warning(
            "Failed to validate scaffold policy for blueprint %s: %s",
            blueprint_id,
            validation_error,
        )
        policy = None

    return summarize_project_workspace(workspace), policy, str(blueprint_id)


def _calculate_mastery_delta(analysis) -> float:
    """
    根据对话分析结果计算概念掌握度增量

    Args:
        analysis: ChatAnalysis 对象（包含 emotion, intent, delta 等）

    Returns:
        掌握度增量 [-0.1, 0.1]，0 表示无变化
    """
    # 基础增量为 0
    delta = 0.0

    # 获取情感和意图
    emotion = analysis.emotion.lower()
    intent = analysis.intent.lower()
    cognition_delta = analysis.delta.cognition

    # 正向情感 -> 增加掌握度
    if emotion in {"confident", "excited", "satisfied", "motivated", "thoughtful"}:
        delta += 0.05
    elif emotion in {"curious"}:
        delta += 0.02  # 好奇心驱动，轻微增加

    # 负向情感 -> 降低或保持
    elif emotion in {"confused", "frustrated", "overwhelmed", "discouraged"}:
        delta -= 0.03  # 表示理解出现问题
    elif emotion in {"anxious"}:
        delta += 0.0  # 焦虑不影响掌握度

    # 意图修正
    if intent in {"application", "reflection"}:
        # 应用和反思说明理解深入
        delta += 0.03
    elif intent == "confirmation" and cognition_delta > 0:
        # 确认且认知提升 -> 理解正确
        delta += 0.04
    elif intent == "help-seeking":
        # 寻求帮助 -> 遇到困难
        delta -= 0.02

    # 认知维度变化也影响掌握度
    if cognition_delta >= 5:
        delta += 0.03
    elif cognition_delta <= -5:
        delta -= 0.02

    # 限制范围在 [-0.1, 0.1]
    delta = max(-0.1, min(0.1, delta))

    return delta


def build_assistant_system_prompt(
    emotion: str,
    language: str,
    is_research_mode: bool,
    current_code: Optional[str] = None,
) -> str:
    """
    根据分析结果构建 AI 助手的 system prompt

    Args:
        emotion: 用户情感状态
        language: 界面语言 (zh/en)
        is_research_mode: 是否为研究模式
        current_code: 学生当前代码（研究模式下使用）

    Returns:
        System prompt 字符串
    """
    # 基础角色定义
    base_role = {
        "zh": "你是一个耐心、专业的教育助手，帮助学习者理解和掌握知识。",
        "en": "You are a patient and professional educational assistant helping learners understand and master knowledge."
    }[language]

    # 根据情感调整语气
    tone_map = {
        "confused": {
            "zh": "用户感到困惑，请用简单、清晰的语言解释，多用类比和例子。",
            "en": "The user is confused. Please explain in simple, clear language with analogies and examples."
        },
        "frustrated": {
            "zh": "用户感到沮丧，请保持鼓励和支持的语气，强调学习的过程而非结果。",
            "en": "The user is frustrated. Please be encouraging and supportive, emphasizing the learning process over results."
        },
        "curious": {
            "zh": "用户充满好奇，可以提供更深入的内容和扩展知识。",
            "en": "The user is curious. You can provide deeper content and extended knowledge."
        },
        "confident": {
            "zh": "用户较为自信，可以引导他们进行更深层次的思考和应用。",
            "en": "The user is confident. Guide them to deeper thinking and application."
        },
        "anxious": {
            "zh": "用户有些焦虑，请温和地回应，帮助建立信心。",
            "en": "The user is anxious. Respond gently and help build confidence."
        },
    }

    tone_instruction = tone_map.get(emotion, {
        "zh": "保持友好、耐心的态度。",
        "en": "Maintain a friendly and patient attitude."
    })[language]

    # 研究模式 vs 直接回答模式
    if is_research_mode:
        mode_instruction = {
            "zh": "采用“讲解一点 + 引导一步”的节奏：先给一个关键解释或观察，再问一个具体检查问题。不要连续只提问。",
            "en": "Use an explain-then-guide rhythm: give one key explanation or observation, then ask one targeted check question. Do not respond with questions only."
        }[language]
    else:
        mode_instruction = {
            "zh": "直接、清晰地回答问题，提供具体的解释和例子。",
            "en": "Answer questions directly and clearly, providing specific explanations and examples."
        }[language]

    # 组装完整 prompt
    system_prompt = f"""{base_role}

**当前情境：**
{tone_instruction}

**回答风格：**
{mode_instruction}

**回答要求：**
- 使用 {language.upper()} 语言回答
- 保持回答简洁（200-300 字）
- 如果涉及技术概念，提供通俗易懂的解释
- 如果用户有误解，温和地纠正
"""

    # 研究模式：将学生当前代码注入上下文
    if is_research_mode and current_code:
        code_snippet = current_code[:3000]  # 防止过长
        code_context = {
            "zh": f"\n**学生当前代码：**\n```\n{code_snippet}\n```\n请根据以上代码内容理解学生的进度。先指出一个具体观察或小提示，再问一个检查问题；可以给局部伪代码或小片段，但不要直接给出完整代码答案。\n",
            "en": f"\n**Student's current code:**\n```\n{code_snippet}\n```\nUse this code to understand the student's progress. First point out one concrete observation or small hint, then ask one check question. You may give local pseudocode or a small snippet, but do not provide a complete code answer.\n",
        }[language]
        system_prompt += code_context

    return system_prompt


async def get_recent_messages(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 5
) -> List[Dict[str, Any]]:
    """
    获取最近的对话历史（用于上下文）

    Args:
        db: 数据库会话
        user_id: 用户 ID
        limit: 返回消息数量

    Returns:
        消息列表 [{"role": "user"|"assistant", "text": "..."}]
    """
    from sqlalchemy import select, desc

    query = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(desc(ChatMessage.timestamp))
        .limit(limit)
    )

    result = await db.execute(query)
    messages = result.scalars().all()

    # 反转顺序（最旧的在前）
    return [
        {
            "role": msg.role.value,
            "text": msg.text,
            "scaffoldContext": (
                msg.analysis.get("scaffoldContext")
                if isinstance(msg.analysis, dict)
                and isinstance(msg.analysis.get("scaffoldContext"), dict)
                else None
            ),
        }
        for msg in reversed(messages)
    ]


async def get_cross_session_context(
    db: AsyncSession,
    user_id: UUID,
    session_gap_minutes: int = 30
) -> Optional[str]:
    """
    检测是否为新会话，如果是则返回上次会话的关键上下文

    Args:
        db: 数据库会话
        user_id: 用户 ID
        session_gap_minutes: 超过此分钟数视为新会话

    Returns:
        上次会话的主题摘要字符串，如果是连续会话则返回 None
    """
    from sqlalchemy import select, desc

    # 获取最近的消息
    latest_query = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(desc(ChatMessage.timestamp))
        .limit(1)
    )
    result = await db.execute(latest_query)
    last_message = result.scalar_one_or_none()

    if not last_message:
        return None  # 新用户，无历史

    # 判断是否为新会话
    time_since = datetime.now(timezone.utc) - last_message.timestamp.replace(tzinfo=timezone.utc) if last_message.timestamp.tzinfo is None else datetime.now(timezone.utc) - last_message.timestamp
    if time_since < timedelta(minutes=session_gap_minutes):
        return None  # 当前会话仍在继续

    # 获取上次会话的历史消息（最近 10 条）
    history_query = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(desc(ChatMessage.timestamp))
        .limit(10)
    )
    result = await db.execute(history_query)
    history = result.scalars().all()

    if not history:
        return None

    # 提取对话中检测到的概念
    concepts = set()
    for msg in history:
        if msg.analysis and isinstance(msg.analysis, dict):
            detected = msg.analysis.get("detectedConcepts", [])
            for c in detected:
                if isinstance(c, dict):
                    name = c.get("name", "")
                    if name:
                        concepts.add(name)
                elif isinstance(c, str) and c:
                    concepts.add(c)

    if concepts:
        return f"上次会话涉及的概念：{', '.join(list(concepts)[:5])}"

    # 如果没有提取到概念，用最后一条用户消息摘要
    last_user_msg = next((m for m in history if m.role.value == "user"), None)
    if last_user_msg:
        snippet = last_user_msg.text[:50] + ("..." if len(last_user_msg.text) > 50 else "")
        return f"上次对话内容：\"{snippet}\""

    return None


@router.get("/greeting")
async def get_greeting(
    language: str = Query("zh", description="语言 zh|en"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取个性化开场问候语

    根据用户历史会话生成上下文感知的问候，让 AI 能够引用上次讨论内容
    """
    try:
        user_id = current_user.id
        user_name = (current_user.name or "").strip()
        name_part = f"，{user_name}" if user_name else ""

        context = await get_cross_session_context(db, user_id)

        if not context:
            # 新用户或继续当前会话 - 简洁问候（带用户名）
            msg = (
                f"你好{name_part}！我是你的学习伙伴，有什么我可以帮你的吗？"
                if language == "zh"
                else f"Hello{', ' + user_name if user_name else ''}! I'm your learning companion. How can I help you today?"
            )
            return {"success": True, "data": {"message": msg, "hasContext": False}}

        # 有跨会话上下文 - 让 LLM 生成个性化问候（带用户名）
        llm = get_chat_provider()
        system = (
            f"你是一个温暖的学习伙伴。根据上次会话的内容，用一句简短友好的话问候回来的用户{name_part}，自然地提及上次的话题。不超过50个字。"
            if language == "zh"
            else f"You are a warm learning companion. Greet {user_name or 'the user'} with one short friendly sentence that naturally references their previous topic. Keep it under 30 words."
        )
        import asyncio
        greeting = await asyncio.wait_for(
            llm.complete(
                system_prompt=system,
                user_prompt=context,
                temperature=0.8,
                max_tokens=100
            ),
            timeout=15.0,
        )

        return {"success": True, "data": {"message": greeting.strip(), "hasContext": True}}

    except Exception as e:
        logger.error(f"Failed to generate greeting: {e}")
        fallback = "你好！我是你的学习伙伴，有什么可以帮你的吗？" if language == "zh" else "Hello! I'm your learning companion."
        return {"success": True, "data": {"message": fallback, "hasContext": False}}


@router.get("/sessions")
async def get_chat_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    获取用户的历史对话会话列表

    按 30 分钟间隔将消息分组成会话，返回每个会话的元数据
    """
    user_id = current_user.id

    from sqlalchemy import select, asc

    query = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(asc(ChatMessage.timestamp))
    )
    result = await db.execute(query)
    messages = result.scalars().all()

    if not messages:
        return {"success": True, "data": {"sessions": []}}

    SESSION_GAP = timedelta(minutes=30)
    sessions = []
    current_session_msgs = [messages[0]]

    for msg in messages[1:]:
        prev_ts = current_session_msgs[-1].timestamp
        curr_ts = msg.timestamp
        if prev_ts.tzinfo is None:
            prev_ts = prev_ts.replace(tzinfo=timezone.utc)
        if curr_ts.tzinfo is None:
            curr_ts = curr_ts.replace(tzinfo=timezone.utc)

        if curr_ts - prev_ts > SESSION_GAP:
            sessions.append(current_session_msgs)
            current_session_msgs = [msg]
        else:
            current_session_msgs.append(msg)

    sessions.append(current_session_msgs)

    session_list = []
    for idx, sess_msgs in enumerate(reversed(sessions)):
        first_msg = sess_msgs[0]
        last_msg = sess_msgs[-1]

        title = ""
        for m in sess_msgs:
            if m.role.value == "user":
                title = m.text[:40] + ("..." if len(m.text) > 40 else "")
                break
        if not title:
            title = f"会话 {len(sessions) - idx}"

        preview = last_msg.text[:60] + ("..." if len(last_msg.text) > 60 else "")

        start_ts = first_msg.timestamp
        end_ts = last_msg.timestamp
        if start_ts.tzinfo is None:
            start_ts = start_ts.replace(tzinfo=timezone.utc)
        if end_ts.tzinfo is None:
            end_ts = end_ts.replace(tzinfo=timezone.utc)

        session_list.append({
            "sessionStart": start_ts.isoformat(),
            "sessionEnd": end_ts.isoformat(),
            "title": title,
            "preview": preview,
            "messageCount": len(sess_msgs),
        })

    return {"success": True, "data": {"sessions": session_list}}


@router.get("/sessions/messages")
async def get_session_messages(
    sessionStart: str = Query(..., description="会话开始时间 (ISO)"),
    sessionEnd: str = Query(..., description="会话结束时间 (ISO)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取特定会话的所有消息"""
    user_id = current_user.id

    from sqlalchemy import select, asc
    from datetime import datetime as dt

    try:
        start_dt = dt.fromisoformat(sessionStart.replace("Z", "+00:00"))
        end_dt = dt.fromisoformat(sessionEnd.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format")

    start_dt = start_dt - timedelta(seconds=1)
    end_dt = end_dt + timedelta(seconds=1)

    query = (
        select(ChatMessage)
        .where(
            ChatMessage.user_id == user_id,
            ChatMessage.timestamp >= start_dt,
            ChatMessage.timestamp <= end_dt,
        )
        .order_by(asc(ChatMessage.timestamp))
    )
    result = await db.execute(query)
    messages = result.scalars().all()

    msg_list = [
        {
            "id": str(m.id),
            "role": m.role.value,
            "text": m.text,
            "timestamp": m.timestamp.isoformat(),
        }
        for m in messages
    ]

    return {"success": True, "data": {"messages": msg_list}}


@router.post("", response_model=SuccessResponse[ChatResponse])
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    聊天接口 - 完整实现

    流程：
    1. 获取当前认证用户
    2. 保存用户消息
    3. 分析消息（intent、emotion、concepts、delta）
    4. 更新画像
    5. 更新知识图谱
    6. 生成 AI 回复
    7. 保存 AI 回复
    8. 返回响应
    """
    logger.info(f"Received chat request from user: {current_user.id}")

    try:
        # ========== 1. 获取认证用户 ==========
        user = current_user
        user_id = user.id

        logger.info(f"User identified: {user.email} (id={user_id})")

        if request.userId and request.userId != str(user_id):
            raise HTTPException(
                status_code=403,
                detail="Authenticated user does not match request.userId"
            )

        # 创建/获取活跃会话（供管理后台 Conversations 页面使用）
        profile_service = ProfileService(db)
        active_session = await get_or_create_active_session(db, user_id)

        current_profile = await profile_service.get_profile(user_id)
        scaffold_context = request.scaffoldContext
        scaffold_metadata = None
        scaffold_policy = None
        scaffold_blueprint_version_id = None
        scaffold_task = None
        if scaffold_context:
            # 先授权再加载：不可见任务 404、归档任务 409，绝不静默降级成
            # task_id 为空的研究事件。
            scaffold_task = await _resolve_scaffold_task(db, current_user, scaffold_context)
            (
                database_summary,
                scaffold_policy,
                scaffold_blueprint_version_id,
            ) = await _load_scaffold_workspace_context(
                db,
                user_id,
                scaffold_task,
            )
            live_summary = scaffold_context.artifactSummary or ""
            combined_summary = "\n\n".join(filter(None, [
                f"本轮浏览器实时产物：\n{live_summary}" if live_summary else "",
                database_summary,
            ]))[:6000]
            scaffold_context = scaffold_context.model_copy(
                update={"artifactSummary": combined_summary or None},
            )
            scaffold_metadata = build_scaffold_metadata(
                scaffold_context,
                current_profile,
                request.currentCode,
                scaffold_policy,
                scaffold_blueprint_version_id,
            )
            scaffold_metadata["contextKey"] = learning_agent_harness.context_key(
                scaffold_context
            ).serialize()

        # ========== 2. 保存用户消息 ==========
        user_message = ChatMessage(
            user_id=user_id,
            session_id=active_session.id,
            role=MessageRole.USER,
            text=request.message,
            timestamp=datetime.now(timezone.utc),
            analysis={"scaffoldContext": scaffold_metadata} if scaffold_metadata else None,
        )
        db.add(user_message)
        await db.flush()

        # 求助「行为」在此刻就已经发生，因此与用户消息同事务记录 stage_event。
        # 它与 scaffold_event 语义不同，不可互相替代：
        #   - stage_event(help_request)：学生发起了求助（即使 AI 随后失败也成立）；
        #   - scaffold_event：一条 L0–L3 建议**确实送达**了学生。
        # 若把两者合并在此处写入，模型超时时就会留下「已给出 L3 支架、学生却什么
        # 都没收到」的假记录，使支架依赖分析失真。
        if scaffold_metadata and scaffold_task is not None:
            await _record_help_request_event(
                db=db,
                user_id=user_id,
                task=scaffold_task,
                scaffold_metadata=scaffold_metadata,
            )

        await db.commit()
        await db.refresh(user_message)

        logger.info(f"User message saved: {user_message.id}")

        # Harness 先从较宽的持久化窗口读取，再严格投影到同任务、同环节、
        # 同功能卡。普通聊天保持原来的最近 20 条语义。
        raw_recent_messages = await get_recent_messages(
            db,
            user_id,
            limit=80 if scaffold_context else 20,
        )
        agent_turn = (
            learning_agent_harness.prepare_turn(
                scaffold_context,
                raw_recent_messages,
                request.language or "zh",
            )
            if scaffold_context
            else None
        )
        recent_messages = (
            agent_turn.history
            if agent_turn
            else learning_agent_harness.scope_history(raw_recent_messages, None, 20)
        )
        is_student_authored = not scaffold_context or scaffold_context.trigger == "student_message"

        # 只有学生亲自输入的文本才参与情感/画像分析。按钮生成的固定句子只表示
        # 求助行为，不能被误当成学生情绪或认知证据污染画像。
        if is_student_authored:
            analyzer = TextAnalyzer()
            analysis = await analyzer.analyze(
                user_message=request.message,
                recent_messages=recent_messages,
                current_profile=current_profile,
            )
        else:
            analysis = ChatAnalysis(
                intent="scaffold-request",
                emotion="neutral",
                detectedConcepts=[],
                delta=ProfileDelta(cognition=0, affect=0, behavior=0),
                emotionDetail=None,
            )

        logger.info(
            f"Analysis complete: intent={analysis.intent}, emotion={analysis.emotion}, "
            f"concepts={len(analysis.detectedConcepts)}"
        )

        # ========== 4. 记录情感日志（使用更新前的 profile） ==========
        if is_student_authored:
            emotion_log = await record_emotion_log(
                db=db,
                user_id=user_id,
                session_id=active_session.id,
                message_id=user_message.id,
                analysis=analysis,
                current_profile=current_profile,
            )
            await db.commit()
            await db.refresh(emotion_log)

            logger.info(
                f"Emotion log saved: {emotion_log.id} (code={emotion_log.emotion_code}, session={active_session.id})"
            )

        # ========== 5. 更新知识图谱 ==========
        if analysis.detectedConcepts:
            try:
                graph_service = GraphService()
                await graph_service.upsert_concepts(
                    user_id=str(user_id),
                    concepts=analysis.detectedConcepts
                )
                logger.info(f"Knowledge graph updated with {len(analysis.detectedConcepts)} concepts")

                # ========== 5.1 更新概念掌握度（基于对话质量） ==========
                mastery_delta = _calculate_mastery_delta(analysis)
                if mastery_delta != 0:
                    updated_count = await graph_service.update_mastery_batch(
                        user_id=str(user_id),
                        concepts=analysis.detectedConcepts,
                        mastery_delta=mastery_delta
                    )
                    logger.info(f"Updated mastery for {updated_count} concepts with delta {mastery_delta}")
            except Exception as graph_error:
                logger.warning(f"Failed to update knowledge graph: {graph_error}")
                # 继续处理，不因为图谱更新失败而中断

        # ========== 5.2 更新画像（Cognition 从图谱计算，Affect/Behavior 用 delta） ==========
        updated_profile = (
            await profile_service.apply_delta_with_graph_cognition(
                user_id=user_id,
                delta_affect=analysis.delta.affect,
                delta_behavior=analysis.delta.behavior,
            )
            if is_student_authored
            else current_profile
        )

        logger.info(
            f"Profile updated: C={updated_profile.cognition} (from graph), "
            f"A={updated_profile.affect}, B={updated_profile.behavior}"
        )

        # ========== 6. 生成 AI 回复 ==========
        # 获取用户当前知识图谱
        current_graph = []
        try:
            graph_service = GraphService()
            graph_data = await graph_service.get_graph(str(user_id))
            if graph_data.nodes:
                current_graph = [
                    {
                        "name": n.name,
                        "category": n.category or "通用",
                        "importance": min(1.0, n.frequency / 10.0)
                    }
                    for n in graph_data.nodes
                ]
        except Exception as e:
            logger.warning(f"Failed to fetch knowledge graph: {e}, using empty graph")

        # 构建个性化 system prompt
        from app.services.personalization_service import PersonalizationService

        personalization_service = PersonalizationService()
        system_prompt = personalization_service.build_personalized_prompt(
            user_profile=updated_profile,
            knowledge_graph=current_graph,
            emotion=analysis.emotion,
            language=request.language or "zh"
        )

        if scaffold_context:
            if agent_turn:
                system_prompt += agent_turn.prompt_section
            system_prompt += build_scaffold_prompt(
                scaffold_context,
                current_profile,
                request.language or "zh",
                scaffold_policy,
            )

        # 注入跨会话上下文（让 AI 能自然引用上次讨论内容）
        # 项目智能体使用任务作用域记忆；普通自由对话才允许引用跨会话主题。
        cross_session_ctx = None if scaffold_context else await get_cross_session_context(db, user_id)
        if cross_session_ctx:
            system_prompt += f"\n上次对话涉及：{cross_session_ctx}，如自然可提及。"

        confirmed_build_l3 = bool(
            scaffold_context
            and scaffold_context.stage == "build"
            and scaffold_context.l3Confirmed
            and scaffold_metadata
            and scaffold_metadata["level"] == 3
        )

        # 研究模式：注入学生当前代码
        if request.isResearchMode and request.currentCode:
            code_snippet = request.currentCode[:3000]
            lang = request.language or "zh"
            code_context = {
                "zh": f"\n\n**学生当前代码：**\n```\n{code_snippet}\n```\n" + (
                    "学生已确认建构 L3。此后保持代码协作：直接结合当前代码回答，可以引用、修改、补全和解释完整函数，不要退回只给定位问题；但不得扩展到其他函数。\n"
                    if confirmed_build_l3
                    else "请根据以上代码理解学生进度，严格遵守本轮 L0-L2 边界，不要越级给完整函数。\n"
                ),
                "en": f"\n\n**Student's current code:**\n```\n{code_snippet}\n```\n" + (
                    "The student confirmed build L3. Stay in code collaboration: answer from the current code directly and freely quote, modify, complete, or explain this function, without falling back to diagnostic-only hints. Do not expand to other functions.\n"
                    if confirmed_build_l3
                    else "Use the code to understand progress and stay within the current L0-L2 boundary. Do not give a complete function.\n"
                ),
            }[lang]
            system_prompt += code_context

        # 研究模式：注入教师教学提示（课程上下文与学习目标）
        if request.isResearchMode and request.taskPrompt:
            lang = request.language or "zh"
            teacher_hint = {
                "zh": f"\n\n**本节课教学目标（教师设定）：**\n{request.taskPrompt}\n在辅导过程中，请围绕以上学习目标给予引导，帮助学生达成教师期望的理解和能力。\n",
                "en": f"\n\n**Lesson Learning Objectives (set by teacher):**\n{request.taskPrompt}\nGuide the student in alignment with these objectives to help them achieve the understanding and skills the teacher expects.\n",
            }[lang]
            system_prompt += teacher_hint

        # 构建 user prompt（包含历史对话）
        # 使用最近 12 条消息（约 6 轮对话），在保持上下文和 token 效率间取得平衡
        conversation_context = "\n".join([
            f"{'学生' if msg['role'] == 'user' else '老师'}: {msg['text']}"
            for msg in recent_messages[-12:]  # 使用最近 12 条消息
        ]) or "（当前学习上下文暂无前序对话）"

        # 检测学生是否表达了"理解/完成"
        understanding_keywords = ["理解了", "懂了", "明白了", "好的", "知道了", "完成了", "我会了",
                                   "i understand", "got it", "i see", "ok", "done", "makes sense"]
        student_msg_lower = request.message.lower().strip()
        is_understanding_claim = any(kw in student_msg_lower for kw in understanding_keywords) and len(request.message) < 30

        if is_understanding_claim:
            verification_hint = '\n（注意：学生刚说自己理解了，请立即用一个具体问题反问来验证，不要只说"很好"。）'
        else:
            verification_hint = ""

        history_label = "同一学习上下文对话记录" if scaffold_context else "对话记录"
        user_prompt = f"""{history_label}：
{conversation_context}

学生说：{request.message}{verification_hint}"""

        # 固定七函数的 L0-L3 都由服务端按等级返回受控代码，避免模型越级或改写
        # 已通过本地行为检查的完整函数；其他项目与阶段仍走 LLM。
        import asyncio
        assistant_reply = ""
        if scaffold_context and scaffold_metadata:
            assistant_reply = build_controlled_scaffold_response(
                scaffold_context,
                int(scaffold_metadata["level"]),
                request.language or "zh",
                student_message=request.message,
                current_code=request.currentCode,
            ) or ""
        last_llm_error: Optional[BaseException] = None
        if not assistant_reply:
            llm_provider = get_chat_provider()
            for attempt in range(2):
                try:
                    assistant_reply = await asyncio.wait_for(
                        llm_provider.complete(
                            system_prompt=system_prompt,
                            user_prompt=user_prompt,
                            temperature=0.7,
                            max_tokens=700 if confirmed_build_l3 else 300
                        ),
                        timeout=30.0,
                    )
                    break
                except asyncio.CancelledError:
                    # 客户端断开或服务关闭：不要当作 LLM 故障重试，直接向上传播
                    raise
                except HTTPException:
                    # 不要把上游的业务异常误判为 LLM 故障而重试
                    raise
                except (asyncio.TimeoutError, Exception) as llm_err:
                    last_llm_error = llm_err
                    logger.warning(f"LLM attempt {attempt + 1} failed: {llm_err}")
                    if attempt == 0:
                        await asyncio.sleep(1)
        if not assistant_reply:
            logger.error(f"LLM failed after retries: {last_llm_error}")
            raise HTTPException(status_code=503, detail="AI service temporarily unavailable, please retry")

        logger.info(f"AI reply generated: {len(assistant_reply)} characters")

        # ========== 7. 保存 AI 回复 ==========
        assistant_analysis = analysis.model_dump()
        if scaffold_metadata:
            assistant_analysis["scaffoldContext"] = scaffold_metadata

        assistant_message = ChatMessage(
            user_id=user_id,
            session_id=active_session.id,
            role=MessageRole.ASSISTANT,
            text=assistant_reply,
            timestamp=datetime.now(timezone.utc),
            analysis=assistant_analysis,
        )
        db.add(assistant_message)
        await db.flush()

        # 支架建议此刻才真正送达学生，因此在**助手消息保存成功之后**、与它同一
        # 事务写入 scaffold_event。若在调用模型之前写入，一旦超时或失败就会留下
        # 「已应用 L0–L3 支架」但学生什么也没收到的假记录。
        #
        # 双写说明：这里同时保留 chat_messages.analysis.scaffoldContext（上面的
        # assistant_analysis），因为教师端现有页面与 CSV 导出仍在读它。
        # scaffold_events 表是后续研究分析的规范数据源；等证据链建立完整的
        # 「求助—建议—修改—结果」关联后，再把新版导出切换到事件表，
        # 旧 JSONB 作为历史兼容数据保留。
        if scaffold_metadata:
            await record_scaffold_event(
                db=db,
                user_id=user_id,
                scaffold_metadata=scaffold_metadata,
                student_message_id=user_message.id,
                assistant_message_id=assistant_message.id,
                delivery_status=ScaffoldDeliveryStatus.DELIVERED,
            )

        await db.commit()
        await db.refresh(assistant_message)

        logger.info(f"Assistant message saved: {assistant_message.id}")

        # ========== 8. 组装知识图谱响应视图 ==========
        # 注意：不要在此处重新调用 TextAnalyzer——第 3 步已经分析过同一条消息。
        updated_graph = await personalization_service.update_graph_from_conversation(
            user_id=str(user_id),
            detected_concepts=analysis.detectedConcepts,
            current_graph=current_graph,
            user_profile=updated_profile
        )

        logger.info(f"Knowledge graph response composed: {len(updated_graph)} concepts")

        # ========== 9. 返回响应 ==========
        # 回传本轮真正生效的支架等级。请求 L3 被教师蓝图压到 L2 时，界面必须显示 L2，
        # 否则学生对「自己拿到了多深的帮助」的主观感知与实际收到的内容不一致。
        scaffold_info = None
        if scaffold_metadata:
            scaffold_info = ChatScaffoldInfo(
                requestedLevel=scaffold_metadata["requestedLevel"],
                appliedLevel=scaffold_metadata["level"],
                wasClamped=scaffold_metadata["policyWasClamped"],
                policySource=scaffold_metadata["policySource"],
                coreImplementationMaxLevel=scaffold_metadata["coreImplementationMaxLevel"],
            )

        response = ChatResponse(
            message=assistant_reply,
            analysis=analysis,
            updatedProfile=updated_profile,
            updatedGraph=updated_graph,
            scaffold=scaffold_info,
        )

        return SuccessResponse(data=response)

    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        logger.error(f"Chat endpoint failed: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process chat request: {str(e)}"
        )
