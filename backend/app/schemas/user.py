"""
User Schemas - 用户相关 Pydantic 模型
"""
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    """用户基础 Schema"""
    email: EmailStr = Field(..., description="用户邮箱")


class UserCreate(UserBase):
    """创建用户请求"""
    pass


class UserResponse(UserBase):
    """用户响应（与前端对齐）"""
    id: UUID = Field(..., description="用户 ID", alias="userId")
    created_at: datetime = Field(..., alias="createdAt")

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "userId": "123e4567-e89b-12d3-a456-426614174000",
                "email": "user@example.com",
                "createdAt": "2026-02-09T10:00:00.000Z"
            }
        }
    }
