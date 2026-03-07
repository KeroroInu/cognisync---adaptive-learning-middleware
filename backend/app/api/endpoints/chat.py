"""
Chat Endpoint - 对话接口（完整实现）
"""
import logging
from uuid import UUID
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.chat import ChatRequest, ChatResponse, ChatMessage as ChatMessageSchema
from app.services.profile_service import ProfileService
from app.services.graph_service import GraphService
from app.services.text_analyzer import TextAnalyzer
from app.services.llm_config import get_chat_provider
from app.models.sql.message import ChatMessage, MessageRole
from app.models.sql.chat_session import ChatSession
from app.models.sql.user import User
from app.api.endpoints.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


async def get_or_create_active_session(db: AsyncSession, user_id: UUID) -> ChatSession:
    """获取最近 30 分钟内的活跃会话，不存在则创建新会话"""
    from sqlalchemy import select
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
            "zh": "采用「苏格拉底式提问」：不要直接给出答案，而是通过提问引导用户自己思考和发现答案。",
            "en": "Use Socratic questioning: Don't give direct answers, but guide users to think and discover answers themselves through questions."
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
            "zh": f"\n**学生当前代码：**\n```\n{code_snippet}\n```\n请根据以上代码内容理解学生的进度，结合代码给出引导性提问，帮助学生自己发现问题和解决方案。不要直接给出完整代码答案。\n",
            "en": f"\n**Student's current code:**\n```\n{code_snippet}\n```\nUse this code to understand the student's progress. Ask guiding questions based on the code to help them discover problems and solutions themselves. Do not give complete code answers directly.\n",
        }[language]
        system_prompt += code_context

    return system_prompt


async def get_recent_messages(
    db: AsyncSession,
    user_id: UUID,
    limit: int = 5
) -> List[Dict[str, str]]:
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
        {"role": msg.role.value, "text": msg.text}
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
        llm = get_provider()
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

        # 创建/获取活跃会话（供管理后台 Conversations 页面使用）
        profile_service = ProfileService(db)
        await get_or_create_active_session(db, user_id)

        # ========== 2. 保存用户消息 ==========
        user_message = ChatMessage(
            user_id=user_id,
            role=MessageRole.USER,
            text=request.message,
            timestamp=datetime.now(timezone.utc),
            analysis=None  # 用户消息没有分析结果
        )
        db.add(user_message)
        await db.commit()
        await db.refresh(user_message)

        logger.info(f"User message saved: {user_message.id}")

        # ========== 3. 分析消息 ==========
        analyzer = TextAnalyzer()

        # 获取对话历史作为上下文
        recent_messages = await get_recent_messages(db, user_id, limit=5)

        analysis = await analyzer.analyze(
            user_message=request.message,
            recent_messages=recent_messages
        )

        logger.info(
            f"Analysis complete: intent={analysis.intent}, emotion={analysis.emotion}, "
            f"concepts={len(analysis.detectedConcepts)}"
        )

        # ========== 4. 更新画像 ==========
        updated_profile = await profile_service.apply_delta(
            user_id=user_id,
            delta_cognition=analysis.delta.cognition,
            delta_affect=analysis.delta.affect,
            delta_behavior=analysis.delta.behavior
        )

        logger.info(
            f"Profile updated: C={updated_profile.cognition}, "
            f"A={updated_profile.affect}, B={updated_profile.behavior}"
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
            except Exception as graph_error:
                logger.warning(f"Failed to update knowledge graph: {graph_error}")
                # 继续处理，不因为图谱更新失败而中断

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

        # 注入跨会话上下文（让 AI 能自然引用上次讨论内容）
        cross_session_ctx = await get_cross_session_context(db, user_id)
        if cross_session_ctx:
            system_prompt += f"\n上次对话涉及：{cross_session_ctx}，如自然可提及。"

        # 研究模式：注入学生当前代码
        if request.isResearchMode and request.currentCode:
            code_snippet = request.currentCode[:3000]
            lang = request.language or "zh"
            code_context = {
                "zh": f"\n\n**学生当前代码：**\n```\n{code_snippet}\n```\n请根据以上代码内容理解学生进度，给出引导性提问，帮助学生自己发现和解决问题，不要直接给出完整答案。\n",
                "en": f"\n\n**Student's current code:**\n```\n{code_snippet}\n```\nUse this code to understand the student's progress. Ask guiding questions to help them discover and solve problems themselves. Do not provide complete code answers directly.\n",
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
        conversation_context = "\n".join([
            f"{'学生' if msg['role'] == 'user' else '老师'}: {msg['text']}"
            for msg in recent_messages[-3:]  # 只取最近 3 条
        ])

        # 检测学生是否表达了"理解/完成"
        understanding_keywords = ["理解了", "懂了", "明白了", "好的", "知道了", "完成了", "我会了",
                                   "i understand", "got it", "i see", "ok", "done", "makes sense"]
        student_msg_lower = request.message.lower().strip()
        is_understanding_claim = any(kw in student_msg_lower for kw in understanding_keywords) and len(request.message) < 30

        if is_understanding_claim:
            verification_hint = '\n（注意：学生刚说自己理解了，请立即用一个具体问题反问来验证，不要只说"很好"。）'
        else:
            verification_hint = ""

        user_prompt = f"""对话记录：
{conversation_context}

学生说：{request.message}{verification_hint}"""

        # 调用 LLM 生成回复（30 秒超时，失败自动重试一次）
        import asyncio
        llm_provider = get_chat_provider()
        last_llm_error: Exception | None = None
        assistant_reply = ""
        for attempt in range(2):
            try:
                assistant_reply = await asyncio.wait_for(
                    llm_provider.complete(
                        system_prompt=system_prompt,
                        user_prompt=user_prompt,
                        temperature=0.7,
                        max_tokens=300
                    ),
                    timeout=30.0,
                )
                break
            except (asyncio.TimeoutError, Exception) as llm_err:
                last_llm_error = llm_err
                logger.warning(f"LLM attempt {attempt + 1} failed: {llm_err}")
                if attempt == 0:
                    await asyncio.sleep(1)
        if not assistant_reply:
            raise HTTPException(status_code=503, detail="AI service temporarily unavailable, please retry")

        logger.info(f"AI reply generated: {len(assistant_reply)} characters")

        # ========== 7. 保存 AI 回复 ==========
        assistant_message = ChatMessage(
            user_id=user_id,
            role=MessageRole.ASSISTANT,
            text=assistant_reply,
            timestamp=datetime.now(timezone.utc),
            analysis=analysis.model_dump()  # 保存分析结果
        )
        db.add(assistant_message)
        await db.commit()
        await db.refresh(assistant_message)

        logger.info(f"Assistant message saved: {assistant_message.id}")

        # ========== 8. 更新知识图谱（基于对话内容） ==========
        updated_graph = await personalization_service.update_graph_from_conversation(
            user_id=str(user_id),
            message=request.message,
            current_graph=current_graph,
            user_profile=updated_profile
        )

        logger.info(f"Knowledge graph updated: {len(updated_graph)} concepts")

        # ========== 9. 返回响应 ==========
        response = ChatResponse(
            message=assistant_reply,
            analysis=analysis,
            updatedProfile=updated_profile,
            updatedGraph=updated_graph
        )

        return SuccessResponse(data=response)

    except Exception as e:
        logger.error(f"Chat endpoint failed: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process chat request: {str(e)}"
        )
