"""
Admin 会话管理 Schema
"""
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field


class SessionItem(BaseModel):
    """会话列表项"""
    id: UUID = Field(..., description="会话 ID")
    user_id: UUID = Field(..., description="用户 ID")
    user_email: str = Field(..., description="用户邮箱")
    message_count: int = Field(..., description="消息数量")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: Optional[datetime] = Field(None, description="最后更新时间")

    class Config:
        from_attributes = True


class SessionsListResponse(BaseModel):
    """会话列表响应"""
    sessions: List[SessionItem] = Field(..., description="会话列表")
    total: int = Field(..., description="总数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页大小")


class SessionDetail(BaseModel):
    """会话详情"""
    id: UUID = Field(..., description="会话 ID")
    user_id: UUID = Field(..., description="用户 ID")
    user_email: str = Field(..., description="用户邮箱")
    message_count: int = Field(..., description="消息数量")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: Optional[datetime] = Field(None, description="最后更新时间")

    class Config:
        from_attributes = True


class SessionMessageItem(BaseModel):
    """会话消息项"""
    id: UUID = Field(..., description="消息 ID")
    role: str = Field(..., description="消息角色：user | assistant")
    text: str = Field(..., description="消息内容")
    timestamp: datetime = Field(..., description="消息时间戳")
    analysis: Optional[dict] = Field(None, description="消息分析结果（可选）")

    class Config:
        from_attributes = True


class SessionMessagesResponse(BaseModel):
    """会话消息列表响应"""
    messages: List[SessionMessageItem] = Field(..., description="消息列表")
    total: int = Field(..., description="总数")
    limit: int = Field(..., description="限制数量")
    offset: int = Field(..., description="偏移量")
