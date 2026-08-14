"""
Chat Schema - 对话相关数据结构（与前端完全对齐）
"""
from typing import Optional, List, Literal
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.profile import UserProfile, ProfileDelta


class EmotionDetail(BaseModel):
    """
    详细情感结果（13 种情感 × 3 级强度）
    """
    code: str = Field(..., description="情感编码: E01-E13")
    name: str = Field(..., description="情感名称")
    intensity: Literal["low", "medium", "high"] = Field(..., description="强度等级")
    legacyEmotion: str = Field(..., description="兼容旧前端的简化情感值")
    confidence: float = Field(default=0.5, ge=0.0, le=1.0, description="情感识别置信度")
    arousal: float = Field(default=0.0, ge=-1.0, le=1.0, description="唤醒度 [-1, 1]")
    valence: float = Field(default=0.0, ge=-1.0, le=1.0, description="效价 [-1, 1]")
    evidence: List[str] = Field(default_factory=list, description="支持情感判断的文本证据")


class ChatAnalysis(BaseModel):
    """
    对话分析结果（与前端 ChatMessage.analysis 完全一致）
    """
    intent: str = Field(
        ...,
        description="意图类型: help-seeking | goal-setting | reflection | chat | exploration | ..."
    )
    emotion: str = Field(
        ...,
        description="情感状态: confused | neutral | frustrated | curious | excited | ..."
    )
    detectedConcepts: List[str] = Field(
        default_factory=list,
        description="检测到的概念列表"
    )
    delta: ProfileDelta = Field(
        ...,
        description="对画像的增量影响"
    )
    emotionDetail: Optional[EmotionDetail] = Field(
        default=None,
        description="详细情感结果（13 种情感 × 3 级强度）"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "intent": "help-seeking",
                "emotion": "confused",
                "detectedConcepts": ["反向传播", "梯度下降"],
                "delta": {"cognition": -5, "affect": -10, "behavior": 1},
                "emotionDetail": {
                    "code": "E01",
                    "name": "confused",
                    "intensity": "high",
                    "legacyEmotion": "confused",
                    "confidence": 0.86,
                    "arousal": 0.35,
                    "valence": -0.55,
                    "evidence": ["还是不太理解", "能再解释一下吗"]
                }
            }
        }
    )


class ProjectScaffoldContext(BaseModel):
    """项目工坊 AI 支架所需的最小阶段上下文。"""

    requestId: str = Field(..., min_length=1, max_length=100, description="一次支架交互的客户端请求 ID")
    taskId: str = Field(..., min_length=1, max_length=100, description="研究任务 ID")
    taskTitle: Optional[str] = Field(default=None, max_length=200, description="项目名称")
    stage: Literal["observe", "decompose", "model", "plan", "build"] = Field(
        ...,
        description="学生当前所在项目阶段",
    )
    level: int = Field(..., ge=0, le=3, description="本轮请求的支架等级 L0-L3")
    trigger: Literal["hint_button", "student_message", "level_up", "minimum_completion"] = Field(
        ...,
        description="支架触发方式",
    )
    artifactSummary: Optional[str] = Field(
        default=None,
        max_length=6000,
        description="当前阶段产物的压缩摘要，不包含无关工作区数据",
    )
    currentModule: Optional[str] = Field(default=None, max_length=300, description="建构阶段正在实现的模块")
    testFeedback: Optional[str] = Field(default=None, max_length=2000, description="最近一次模块测试反馈")


class ChatRequest(BaseModel):
    """聊天请求"""
    userId: Optional[str] = Field(
        default=None,
        description="用户 ID（兼容旧请求体；服务端以 JWT 当前用户为准）"
    )
    message: str = Field(..., min_length=1, description="用户消息内容")
    language: Optional[Literal["zh", "en"]] = Field(
        default="zh",
        description="界面语言"
    )
    isResearchMode: Optional[bool] = Field(
        default=False,
        description="研究模式（true: 讲解一点再引导一步；false: 直接回答）"
    )
    currentCode: Optional[str] = Field(
        default=None,
        max_length=12000,
        description="学生当前代码内容（研究模式下使用）"
    )
    taskPrompt: Optional[str] = Field(
        default=None,
        description="教师给 AI 的教学提示（本节课上下文与学习目标）"
    )
    scaffoldContext: Optional[ProjectScaffoldContext] = Field(
        default=None,
        description="项目工坊阶段感知支架上下文",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "message": "我对反向传播还是不太理解",
                "language": "zh",
                "isResearchMode": False
            }
        }
    )


class ChatResponse(BaseModel):
    """
    聊天响应（与前端契约完全一致）
    必须包含 message, analysis, updatedProfile 三个字段
    """
    message: str = Field(..., description="AI 助手回复")
    analysis: ChatAnalysis = Field(..., description="对话分析结果")
    updatedProfile: UserProfile = Field(..., description="更新后的学习者画像")
    updatedGraph: Optional[List[dict]] = Field(None, alias="updatedGraph", description="更新后的知识图谱")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "message": "让我用更简单的方式解释反向传播...",
                "analysis": {
                    "intent": "help-seeking",
                    "emotion": "confused",
                    "detectedConcepts": ["反向传播"],
                    "delta": {"cognition": -5, "affect": -10, "behavior": 1},
                    "emotionDetail": {
                        "code": "E01",
                        "name": "confused",
                        "intensity": "high",
                        "legacyEmotion": "confused",
                        "confidence": 0.86,
                        "arousal": 0.35,
                        "valence": -0.55,
                        "evidence": ["还是不太理解"]
                    }
                },
                "updatedProfile": {
                    "cognition": 60,
                    "affect": 32,
                    "behavior": 83,
                    "lastUpdate": "2026-02-09T10:30:00.000Z"
                },
                "updatedGraph": [
                    {
                        "name": "反向传播",
                        "category": "算法",
                        "importance": 0.8,
                        "relatedConcepts": ["神经网络", "梯度下降"]
                    }
                ]
            }
        }
    )


class ChatMessage(BaseModel):
    """
    聊天消息（与前端 AppState.messages 完全一致）
    """
    id: str
    role: Literal["user", "assistant"]
    text: str
    timestamp: str
    analysis: Optional[ChatAnalysis] = None
