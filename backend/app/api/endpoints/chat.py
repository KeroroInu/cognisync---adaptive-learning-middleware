"""
Chat Endpoint - 对话接口（完整实现）
"""
import logging
from uuid import UUID
from datetime import datetime
from typing import List, Dict
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.postgres import get_db
from app.schemas.base import SuccessResponse
from app.schemas.chat import ChatRequest, ChatResponse, ChatMessage as ChatMessageSchema
from app.services.profile_service import ProfileService
from app.services.graph_service import GraphService
from app.services.text_analyzer import TextAnalyzer
from app.services.llm_provider import get_provider
from app.models.sql.message import ChatMessage, MessageRole

router = APIRouter()
logger = logging.getLogger(__name__)


def build_assistant_system_prompt(
    emotion: str,
    language: str,
    is_research_mode: bool
) -> str:
    """
    根据分析结果构建 AI 助手的 system prompt

    Args:
        emotion: 用户情感状态
        language: 界面语言 (zh/en)
        is_research_mode: 是否为研究模式

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


@router.post("", response_model=SuccessResponse[ChatResponse])
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    """
    聊天接口 - 完整实现

    流程：
    1. 创建/获取用户
    2. 保存用户消息
    3. 分析消息（intent、emotion、concepts、delta）
    4. 更新画像
    5. 更新知识图谱
    6. 生成 AI 回复
    7. 保存 AI 回复
    8. 返回响应
    """
    logger.info(f"Received chat request from user: {request.userId}")

    try:
        # ========== 1. 创建/获取用户 ==========
        profile_service = ProfileService(db)
        user = await profile_service.get_or_create_user(request.userId)
        user_id = user.id

        logger.info(f"User identified: {user.email} (id={user_id})")

        # ========== 2. 保存用户消息 ==========
        user_message = ChatMessage(
            user_id=user_id,
            role=MessageRole.USER,
            text=request.message,
            timestamp=datetime.utcnow(),
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
            graph_data = await graph_service.get_user_graph(str(user_id))
            if graph_data and "concepts" in graph_data:
                current_graph = graph_data["concepts"]
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

        # 构建 user prompt（包含历史对话）
        conversation_context = "\n".join([
            f"{'用户' if msg['role'] == 'user' else '助手'}: {msg['text']}"
            for msg in recent_messages[-3:]  # 只取最近 3 条
        ])

        user_prompt = f"""**对话历史：**
{conversation_context}

**当前用户消息：**
{request.message}

**请根据上述情境生成回复。**"""

        # 调用 LLM 生成回复
        llm_provider = get_provider()
        assistant_reply = await llm_provider.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.7,
            max_tokens=500
        )

        logger.info(f"AI reply generated: {len(assistant_reply)} characters")

        # ========== 7. 保存 AI 回复 ==========
        assistant_message = ChatMessage(
            user_id=user_id,
            role=MessageRole.ASSISTANT,
            text=assistant_reply,
            timestamp=datetime.utcnow(),
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
