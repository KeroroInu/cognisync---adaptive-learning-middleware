"""
AI Onboarding API Endpoints - AI引导注册接口
"""
import uuid
from typing import List, Dict, Optional, Any, Generic, TypeVar
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.endpoints.auth import get_current_user, save_user_profile

router = APIRouter()


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
    answer: str


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


# 模拟对话状态（生产环境应使用数据库或Redis）
sessions: Dict[str, Dict] = {}


@router.post("/start")
async def start_ai_onboarding(
    current_user: Dict = Depends(get_current_user)
):
    """
    开始AI引导对话

    创建新会话并返回第一个问题（MVP版本：预设问题）
    """
    session_id = str(uuid.uuid4())

    # 初始化会话
    sessions[session_id] = {
        "user_id": current_user["id"],
        "step": 0,
        "summary": [],
        "answers": []
    }

    response_data = AiStartResponse(
        sessionId=session_id,
        question="您好！我是您的学习助手。首先，能告诉我您想通过这个平台学习什么吗？",
        summary=[]
    )

    # 返回包装格式
    return ApiResponse(success=True, data=response_data)


@router.post("/step")
async def step_ai_onboarding(
    data: AiStepRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    单步对话

    接收用户回答并返回下一个问题（MVP版本：预设流程）
    """
    session_id = data.sessionId

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]
    session["answers"].append(data.answer)
    session["step"] += 1

    # 预设问题流程
    questions = [
        "太好了！您之前有相关的学习经验吗？",
        "您更喜欢通过什么方式学习？例如：视频、文档、实践等",
        "您每天能投入多少时间用于学习？",
        "最后，您在学习过程中通常会遇到什么困难？"
    ]

    step = session["step"]

    # 更新摘要
    if step == 1:
        session["summary"].append(ConfirmedInfo(key="学习目标", value=data.answer, confidence=0.9))
    elif step == 2:
        session["summary"].append(ConfirmedInfo(key="学习经验", value=data.answer, confidence=0.85))
    elif step == 3:
        session["summary"].append(ConfirmedInfo(key="学习方式", value=data.answer, confidence=0.9))
    elif step == 4:
        session["summary"].append(ConfirmedInfo(key="学习时间", value=data.answer, confidence=0.95))

    if step >= len(questions):
        # 对话结束
        response_data = AiStepResponse(
            question=None,
            summary=session["summary"],
            draftProfile=DraftProfile(cognition=75, affect=80, behavior=70),
            isComplete=True
        )
    else:
        # 返回下一个问题
        response_data = AiStepResponse(
            question=questions[step],
            summary=session["summary"],
            draftProfile=DraftProfile(
                cognition=60 + step * 5,
                affect=65 + step * 5,
                behavior=55 + step * 5
            ),
            isComplete=False
        )

    # 返回包装格式
    return ApiResponse(success=True, data=response_data)


@router.post("/finish")
async def finish_ai_onboarding(
    data: AiFinishRequest,
    current_user: Dict = Depends(get_current_user)
):
    """
    完成AI引导

    生成最终画像和用户属性（MVP版本：示例数据）
    """
    session_id = data.sessionId

    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]

    # 生成最终画像（示例算法）
    initial_profile = InitialProfile(
        cognition=75.0,
        affect=80.0,
        behavior=70.0
    )

    # 保存用户画像
    save_user_profile(current_user["id"], initial_profile.cognition, initial_profile.affect, initial_profile.behavior)

    # 提取用户属性（示例数据）
    attributes = UserAttributes(
        learningGoals=["Python编程", "数据分析"],
        strengths=["逻辑思维", "快速学习"],
        weaknesses=["时间管理"],
        interests=["技术", "数据科学"],
        preferredStyle="实践为主",
        background="大学本科"
    )

    # 生成概念种子（示例数据）
    concept_seeds = [
        ConceptSeed(
            concept="Python",
            category="编程语言",
            importance=0.9,
            relatedConcepts=["数据分析", "NumPy", "Pandas"]
        ),
        ConceptSeed(
            concept="数据分析",
            category="技能",
            importance=0.95,
            relatedConcepts=["统计学", "可视化", "机器学习"]
        )
    ]

    # 清理会话
    del sessions[session_id]

    response_data = AiFinishResponse(
        sessionId=session_id,
        initialProfile=initial_profile,
        attributes=attributes,
        conceptSeeds=concept_seeds
    )

    # 返回包装格式
    return ApiResponse(success=True, data=response_data)
