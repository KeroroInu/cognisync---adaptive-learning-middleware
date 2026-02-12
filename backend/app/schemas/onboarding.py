"""
Onboarding Schemas - 入职流程相关的数据模型
"""
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class OnboardingSessionCreate(BaseModel):
    """创建入职会话请求"""
    user_id: UUID = Field(..., description="用户 ID")
    mode: str = Field(..., description="模式：guided | free")
    raw_transcript: Optional[str] = Field(None, description="原始对话记录")
    extracted_json: Optional[Dict[str, Any]] = Field(None, description="提取的信息")


class OnboardingSessionUpdate(BaseModel):
    """更新入职会话请求"""
    raw_transcript: Optional[str] = Field(None, description="原始对话记录")
    extracted_json: Optional[Dict[str, Any]] = Field(None, description="提取的信息")


class OnboardingSessionResponse(BaseModel):
    """入职会话响应"""
    id: UUID
    user_id: UUID
    mode: str
    raw_transcript: Optional[str]
    extracted_json: Optional[Dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


class OnboardingListResponse(BaseModel):
    """入职会话列表响应"""
    sessions: list[OnboardingSessionResponse]
    total: int
    page: int
    page_size: int
