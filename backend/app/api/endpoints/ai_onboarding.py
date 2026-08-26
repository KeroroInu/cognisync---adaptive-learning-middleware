"""
AI Onboarding API Endpoints - AI引导注册接口（集成真实LLM）
"""
import uuid
import json
from typing import List, Dict, Optional, Any, Generic, TypeVar
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from app.api.endpoints.auth import get_current_user, save_user_profile
from app.services.llm_provider import get_provider
from app.db.postgres import get_db
from app.models.sql.onboarding import OnboardingSession

router = APIRouter()

# LLM Provider 实例（全局单例）
llm_provider = get_provider()


# 通用响应包装
T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    """统一API响应格式"""
    success: bool
    data: T | None = None
    error: Dict[str, Any] | None = None


class ConfirmedInfo(BaseModel):
    """已确认信息"""
    key: str
    value: str
    confidence: Optional[float] = None


class DraftProfile(BaseModel):
    """草稿画像"""
    cognition: Optional[float] = None
    affect: Optional[float] = None
    behavior: Optional[float] = None


class AiStartResponse(BaseModel):
    """开始响应"""
    sessionId: str
    question: str
    summary: List[ConfirmedInfo]


class AiStepRequest(BaseModel):
    """单步请求"""
    sessionId: str
    answer: str = Field(..., min_length=1, max_length=4000)


class AiStepResponse(BaseModel):
    """单步响应"""
    question: Optional[str]
    summary: List[ConfirmedInfo]
    draftProfile: Optional[DraftProfile] = None
    isComplete: bool = False


class AiFinishRequest(BaseModel):
    """完成请求"""
    sessionId: str


class InitialProfile(BaseModel):
    """初始画像"""
    cognition: float = Field(..., ge=0, le=100)
    affect: float = Field(..., ge=0, le=100)
    behavior: float = Field(..., ge=0, le=100)


class UserAttributes(BaseModel):
    """用户属性"""
    learningGoals: Optional[List[str]] = None
    strengths: Optional[List[str]] = None
    weaknesses: Optional[List[str]] = None
    interests: Optional[List[str]] = None
    preferredStyle: Optional[str] = None
    background: Optional[str] = None


class ConceptSeed(BaseModel):
    """概念种子"""
    concept: str
    category: str
    importance: float
    relatedConcepts: Optional[List[str]] = None


class AiFinishResponse(BaseModel):
    """完成响应"""
    sessionId: str
    initialProfile: InitialProfile
    attributes: UserAttributes
    conceptSeeds: List[ConceptSeed]


def _initial_profile_from_analysis(analysis: Dict[str, Any]) -> InitialProfile:
    """将 AI 分析结果转换为唯一的正式初始画像。"""
    profile_data = analysis.get("profile", {})
    return InitialProfile(
        cognition=profile_data.get("cognition", 75.0),
        affect=profile_data.get("affect", 80.0),
        behavior=profile_data.get("behavior", 70.0),
    )


async def _load_session(
    db: AsyncSession,
    session_id: str,
    user_id: uuid.UUID,
    *,
    lock: bool = False,
) -> OnboardingSession:
    """按会话和所有者读取；行锁避免双击导致同一步被提交两次。"""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    stmt = select(OnboardingSession).where(
        OnboardingSession.id == sid,
        OnboardingSession.user_id == user_id,
        OnboardingSession.mode == "ai",
    )
    if lock:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return model


def _summary_models(session: Dict[str, Any]) -> List[ConfirmedInfo]:
    return [item if isinstance(item, ConfirmedInfo) else ConfirmedInfo(**item) for item in session.get("summary", [])]


def _finish_response(session_id: str, analysis: Dict[str, Any]) -> AiFinishResponse:
    initial_profile = _initial_profile_from_analysis(analysis)
    attr_data = analysis.get("attributes", {})
    attributes = UserAttributes(
        learningGoals=attr_data.get("learningGoals", []),
        strengths=attr_data.get("strengths", []),
        weaknesses=attr_data.get("weaknesses", []),
        interests=attr_data.get("interests", []),
        preferredStyle=attr_data.get("preferredStyle", "未知"),
        background=attr_data.get("background", "未知"),
    )
    concept_seeds = [
        ConceptSeed(
            concept=item.get("concept", ""),
            category=item.get("category", ""),
            importance=item.get("importance", 0.5),
            relatedConcepts=item.get("relatedConcepts", []),
        )
        for item in analysis.get("conceptSeeds", [])
    ]
    return AiFinishResponse(
        sessionId=session_id,
        initialProfile=initial_profile,
        attributes=attributes,
        conceptSeeds=concept_seeds,
    )


# AI 对话系统提示词
SYSTEM_PROMPT = """你是CogniSync学习平台的AI引导助手，负责通过对话了解新用户的学习背景和需求。

你的任务：
1. 通过4个有针对性的问题了解用户的学习情况
2. 每个问题都要基于用户之前的回答来设计，让对话自然流畅
3. 关注以下维度：
   - 学习目标和兴趣领域
   - 学习经验和背景
   - 学习方式偏好
   - 学习挑战和困难

响应格式（严格JSON）：
{
  "next_question": "下一个问题（如果还需要继续）",
  "extracted_info": {
    "key": "提取的信息类别（如：学习目标、学习经验等）",
    "value": "用户回答的核心内容（简洁总结）",
    "confidence": 0.9
  },
  "is_complete": false,
  "reasoning": "你为什么这样提问的简短解释"
}

注意：
- 问题要简洁、友好、中文
- 每次只问一个问题
- 第4个问题后设置 is_complete: true
- extracted_info 要精准提取用户回答的核心内容
"""


async def call_llm_for_next_question(session: Dict, user_answer: str) -> Dict:
    """调用LLM生成下一个问题"""

    # 构建对话历史上下文
    conversation_history = ""
    for i, ans in enumerate(session.get("answers", []), 1):
        conversation_history += f"\n问题{i}回答: {ans}"

    user_prompt = f"""当前是第 {session['step'] + 1} 个问题。

之前的对话历史：{conversation_history}

用户最新回答：{user_answer}

请根据上述信息生成下一个问题（如果还需要），并提取本次回答的关键信息。
记住：总共只问4个问题，当前已问 {session['step']} 个。
"""

    # 调用LLM
    response_text = await llm_provider.complete(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        temperature=0.7,
        max_tokens=500
    )

    # 解析JSON响应
    try:
        # 移除可能的markdown代码块标记
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        llm_response = json.loads(response_text.strip())
        return llm_response

    except json.JSONDecodeError:
        # 如果LLM返回格式错误，使用后备问题
        fallback_questions = [
            "太好了！您之前有相关的学习经验吗？",
            "您更喜欢通过什么方式学习？例如：视频、文档、实践等",
            "您每天能投入多少时间用于学习？",
            "最后，您在学习过程中通常会遇到什么困难？"
        ]

        step = session['step']
        return {
            "next_question": fallback_questions[min(step, len(fallback_questions) - 1)],
            "extracted_info": {
                "key": f"回答{step + 1}",
                "value": user_answer[:100],  # 截断
                "confidence": 0.5
            },
            "is_complete": step >= 3,
            "reasoning": "使用后备问题（LLM响应解析失败）"
        }


async def analyze_all_answers_for_profile(session: Dict) -> Dict:
    """分析所有回答生成初始画像"""

    # 构建完整对话历史
    conversation_summary = "\n".join(
        f"- {info.key}: {info.value}" for info in _summary_models(session)
    )

    analysis_prompt = f"""基于以下用户的完整回答，生成初始学习画像和用户属性。

对话摘要：
{conversation_summary}

请分析并返回JSON格式（严格遵守）：
{{
  "profile": {{
    "cognition": 75.0,  // 认知能力 (0-100)
    "affect": 80.0,     // 情感态度 (0-100)
    "behavior": 70.0    // 行为习惯 (0-100)
  }},
  "attributes": {{
    "learningGoals": ["Python编程", "数据分析"],
    "strengths": ["逻辑思维", "快速学习"],
    "weaknesses": ["时间管理"],
    "interests": ["技术", "数据科学"],
    "preferredStyle": "实践为主",
    "background": "大学本科"
  }},
  "conceptSeeds": [
    {{
      "concept": "Python",
      "category": "编程语言",
      "importance": 0.9,
      "relatedConcepts": ["数据分析", "NumPy"]
    }}
  ]
}}

评分标准：
- cognition: 理解力、学习能力、逻辑思维
- affect: 学习动机、情绪状态、态度
- behavior: 学习习惯、时间管理、自律性
"""

    response_text = await llm_provider.complete(
        system_prompt="你是学习画像分析专家，基于用户对话生成精准的CAB三维画像。",
        user_prompt=analysis_prompt,
        temperature=0.3,  # 降低随机性
        max_tokens=1000
    )

    try:
        # 解析响应
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        analysis = json.loads(response_text.strip())
        return analysis

    except json.JSONDecodeError:
        # 后备默认画像
        return {
            "profile": {"cognition": 75.0, "affect": 80.0, "behavior": 70.0},
            "attributes": {
                "learningGoals": [],
                "strengths": [],
                "weaknesses": [],
                "interests": [],
                "preferredStyle": "未知",
                "background": "未知"
            },
            "conceptSeeds": []
        }


@router.post("/start")
async def start_ai_onboarding(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    开始AI引导对话

    创建新会话并返回第一个问题

    如果用户已经完成了 onboarding，将返回错误
    """
    # 检查用户是否已经完成 onboarding
    if current_user.has_completed_onboarding:
        raise HTTPException(
            status_code=400,
            detail="User has already completed onboarding. Please go to dashboard."
        )

    session_id = uuid.uuid4()
    session_state = {
        "user_id": str(current_user.id),
        "step": 0,
        "summary": [],
        "answers": [],
        "completed": False,
    }
    db.add(OnboardingSession(
        id=session_id,
        user_id=current_user.id,
        mode="ai",
        raw_transcript="[]",
        extracted_json=session_state,
    ))
    await db.flush()

    # 第一个问题（固定）
    first_question = "您好！我是您的学习助手。首先，能告诉我您想通过这个平台学习什么吗？"

    response_data = AiStartResponse(
        sessionId=str(session_id),
        question=first_question,
        summary=[]
    )

    return ApiResponse(success=True, data=response_data)


@router.post("/step")
async def step_ai_onboarding(
    data: AiStepRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """
    单步对话

    接收用户回答，调用LLM生成下一个问题
    """
    session_model = await _load_session(db, data.sessionId, current_user.id, lock=True)
    session = dict(session_model.extracted_json or {})
    if session.get("completed"):
        raise HTTPException(status_code=409, detail="Session already completed")
    session["answers"].append(data.answer)

    # 调用LLM生成下一个问题
    try:
        llm_response = await call_llm_for_next_question(session, data.answer)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="AI service is temporarily unavailable") from exc

    # 更新摘要
    if "extracted_info" in llm_response:
        info = llm_response["extracted_info"]
        session["summary"].append(ConfirmedInfo(
            key=info.get("key", "信息"),
            value=info.get("value", data.answer[:100]),
            confidence=info.get("confidence", 0.8)
        ).model_dump())

    session["step"] += 1

    # 构造响应
    is_complete = llm_response.get("is_complete", False) or session["step"] >= 4

    if is_complete:
        # 对话结束时生成一次正式画像并缓存。注册预览与最终入库必须使用同一份结果。
        try:
            final_analysis = await analyze_all_answers_for_profile(session)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="AI service is temporarily unavailable") from exc
        session["final_analysis"] = final_analysis
        initial_profile = _initial_profile_from_analysis(final_analysis)
        response_data = AiStepResponse(
            question=None,
            summary=_summary_models(session),
            draftProfile=DraftProfile(**initial_profile.model_dump()),
            isComplete=True
        )
    else:
        # 返回下一个问题
        next_question = llm_response.get("next_question", "谢谢您的分享！")

        response_data = AiStepResponse(
            question=next_question,
            summary=_summary_models(session),
            draftProfile=DraftProfile(
                cognition=60 + session["step"] * 5,
                affect=65 + session["step"] * 5,
                behavior=55 + session["step"] * 5
            ),
            isComplete=False
        )

    session_model.extracted_json = session
    session_model.raw_transcript = json.dumps(session.get("answers", []), ensure_ascii=False)
    await db.flush()
    return ApiResponse(success=True, data=response_data)


@router.post("/finish")
async def finish_ai_onboarding(
    data: AiFinishRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    完成AI引导

    分析所有回答生成最终画像和用户属性
    """
    session_model = await _load_session(db, data.sessionId, current_user.id, lock=True)
    session = dict(session_model.extracted_json or {})

    # 复用问答结束时已向用户展示的正式分析，避免二次 AI 计算导致分数跳变。
    analysis = session.get("final_analysis")
    if analysis is None:
        # 兼容修复部署前已经进入最后一步的内存会话。
        try:
            analysis = await analyze_all_answers_for_profile(session)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="AI service is temporarily unavailable") from exc
        session["final_analysis"] = analysis

    response_data = _finish_response(data.sessionId, analysis)

    if session.get("completed"):
        return ApiResponse(success=True, data=response_data)

    initial_profile = response_data.initialProfile

    # 保存用户画像到数据库
    await save_user_profile(
        db,
        current_user.id,
        initial_profile.cognition,
        initial_profile.affect,
        initial_profile.behavior
    )

    # 保留完整过程证据并使 finish 幂等，支持多 worker/容器部署。
    session["completed"] = True
    session_model.extracted_json = session
    await db.flush()

    return ApiResponse(success=True, data=response_data)
