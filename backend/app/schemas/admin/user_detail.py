"""
Admin 用户详情 Schema
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class UserDetail(BaseModel):
    """用户详情"""
    id: UUID
    email: str
    name: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    last_active_at: Optional[datetime] = None
    messages_count: int = 0
    sessions_count: int = 0
    responses_count: int = 0


class MessageItem(BaseModel):
    """消息项"""
    id: UUID
    role: str
    text: str
    timestamp: datetime
    analysis: Optional[Dict[str, Any]] = None


class ProfileItem(BaseModel):
    """画像快照项"""
    id: UUID
    cognition: int
    affect: int
    behavior: int
    source: str
    created_at: datetime


class ScaleResponseItem(BaseModel):
    """量表响应项"""
    id: UUID
    template_id: UUID
    template_name: str
    answers_json: Dict[str, Any]
    scores_json: Optional[Dict[str, Any]] = None
    created_at: datetime


class UserMessagesResponse(BaseModel):
    """用户消息列表响应"""
    messages: List[MessageItem]
    total: int
    limit: int
    offset: int


class UserProfilesResponse(BaseModel):
    """用户画像列表响应"""
    profiles: List[ProfileItem]
    total: int


class UserScaleResponsesResponse(BaseModel):
    """用户量表响应列表"""
    responses: List[ScaleResponseItem]
    total: int
