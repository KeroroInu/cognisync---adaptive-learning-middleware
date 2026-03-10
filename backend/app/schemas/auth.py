"""
Auth Schemas - 认证相关 Pydantic 模型
"""
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """登录请求（学号 + 密码）"""
    student_id: str = Field(..., description="学号")
    password: str = Field(..., description="密码")


class RegisterRequest(BaseModel):
    """注册请求（学号 + 姓名 + 密码，邮箱可选）"""
    student_id: str = Field(..., min_length=1, description="学号（必填）")
    name: str = Field(..., min_length=1, description="姓名（必填）")
    password: str = Field(..., min_length=6, description="密码（≥6字符）")
    email: Optional[EmailStr] = Field(None, description="邮箱（可选）")
    mode: str = Field(..., description="注册模式：scale | ai")


class UserInfo(BaseModel):
    """用户信息"""
    id: UUID = Field(..., description="用户 ID")
    student_id: str = Field(..., description="学号")
    email: Optional[str] = Field(None, description="邮箱（可选）")
    name: str = Field(..., description="姓名")
    created_at: datetime = Field(..., alias="createdAt")
    has_completed_onboarding: bool = Field(False, alias="hasCompletedOnboarding")
    onboarding_mode: Optional[str] = Field(None, alias="onboardingMode", description="注册模式: scale | ai")

    model_config = {
        "from_attributes": True,
        "populate_by_name": True
    }


class ProfileData(BaseModel):
    """用户画像数据"""
    cognition: float = Field(..., ge=0, le=100, description="认知能力 (0-100)")
    affect: float = Field(..., ge=0, le=100, description="情感状态 (0-100)")
    behavior: float = Field(..., ge=0, le=100, description="行为特征 (0-100)")


class AuthResponse(BaseModel):
    """认证响应"""
    token: str = Field(..., description="访问令牌")
    user: UserInfo = Field(..., description="用户信息")
    initialProfile: Optional[ProfileData] = Field(None, alias="initialProfile", description="初始用户画像")
    initialGraph: Optional[list] = Field(None, alias="initialGraph", description="初始知识图谱（仅AI模式）")


class CurrentUserResponse(BaseModel):
    """当前用户响应"""
    user: UserInfo = Field(..., description="用户信息")
    profile: Optional[ProfileData] = Field(None, description="用户画像")
