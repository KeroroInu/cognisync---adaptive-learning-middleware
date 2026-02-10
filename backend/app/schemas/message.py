"""
Message Schemas - 聊天消息相关 Pydantic 模型（与前端完全对齐）
"""
from datetime import datetime
from uuid import UUID
from typing import Optional, Literal
from pydantic import BaseModel, Field

from app.schemas.chat import ChatAnalysis


class MessageBase(BaseModel):
    """消息基础 Schema"""
    role: Literal["user", "assistant"]
    text: str
    timestamp: datetime


class MessageCreate(MessageBase):
    """创建消息请求"""
    user_id: UUID
    analysis: Optional[ChatAnalysis] = None


class MessageResponse(BaseModel):
    """
    消息响应（与前端 AppState.messages 完全对齐）
    """
    id: str = Field(..., description="消息 ID")
    role: Literal["user", "assistant"]
    text: str
    timestamp: str = Field(..., description="ISO 8601 格式时间戳")
    analysis: Optional[ChatAnalysis] = None

    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "role": "user",
                "text": "我想学习神经网络",
                "timestamp": "2026-02-09T10:00:00.000Z",
                "analysis": {
                    "intent": "exploration",
                    "emotion": "curious",
                    "detectedConcepts": ["神经网络"],
                    "delta": {"cognition": 0, "affect": 5, "behavior": 10}
                }
            }
        }
    }
