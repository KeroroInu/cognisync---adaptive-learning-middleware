"""
Chat Schema - 对话相关数据结构（与前端完全对齐）
"""
from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from app.schemas.profile import UserProfile, ProfileDelta


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

    class Config:
        json_schema_extra = {
            "example": {
                "intent": "help-seeking",
                "emotion": "confused",
                "detectedConcepts": ["反向传播", "梯度下降"],
                "delta": {"cognition": -5, "affect": -10, "behavior": 5}
            }
        }


class ChatRequest(BaseModel):
    """聊天请求"""
    userId: str = Field(..., description="用户 ID")
    message: str = Field(..., min_length=1, description="用户消息内容")
    language: Optional[Literal["zh", "en"]] = Field(
        default="zh",
        description="界面语言"
    )
    isResearchMode: Optional[bool] = Field(
        default=False,
        description="研究模式（true: 提问式引导；false: 直接回答）"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "userId": "user123",
                "message": "我对反向传播还是不太理解",
                "language": "zh",
                "isResearchMode": False
            }
        }


class ChatResponse(BaseModel):
    """
    聊天响应（与前端契约完全一致）
    必须包含 message, analysis, updatedProfile 三个字段
    """
    message: str = Field(..., description="AI 助手回复")
    analysis: ChatAnalysis = Field(..., description="对话分析结果")
    updatedProfile: UserProfile = Field(..., description="更新后的学习者画像")

    class Config:
        json_schema_extra = {
            "example": {
                "message": "让我用更简单的方式解释反向传播...",
                "analysis": {
                    "intent": "help-seeking",
                    "emotion": "confused",
                    "detectedConcepts": ["反向传播"],
                    "delta": {"cognition": -5, "affect": -10, "behavior": 5}
                },
                "updatedProfile": {
                    "cognition": 60,
                    "affect": 32,
                    "behavior": 83,
                    "lastUpdate": "2026-02-09T10:30:00.000Z"
                }
            }
        }


class ChatMessage(BaseModel):
    """
    聊天消息（与前端 AppState.messages 完全一致）
    """
    id: str
    role: Literal["user", "assistant"]
    text: str
    timestamp: str
    analysis: Optional[ChatAnalysis] = None
