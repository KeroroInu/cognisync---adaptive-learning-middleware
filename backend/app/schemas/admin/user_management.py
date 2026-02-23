"""
用户管理 Schema 定义
"""
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class UserSummary(BaseModel):
    """用户概要信息"""
    id: str = Field(..., description="用户 ID")
    email: str = Field(..., description="用户邮箱")
    name: str = Field("", description="用户名称")
    role: str = Field("user", description="用户角色")
    is_active: bool = Field(True, description="是否激活")
    created_at: datetime = Field(..., description="创建时间")
    message_count: int = Field(0, description="消息数量")
    last_active_at: Optional[datetime] = Field(None, description="最后活跃时间")


class UserListResponse(BaseModel):
    """用户列表响应"""
    users: List[UserSummary] = Field(..., description="用户列表")
    total: int = Field(..., description="总用户数")
    page: int = Field(..., description="当前页码")
    pageSize: int = Field(..., description="每页数量")


class UserDetailResponse(BaseModel):
    """用户详情响应"""
    id: str
    email: str
    created_at: datetime
    profile: dict = Field(..., description="用户画像")
    stats: dict = Field(..., description="用户统计数据")
