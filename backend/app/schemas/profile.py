"""
Profile Schema - 学习者画像相关数据结构（与前端完全对齐）
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class ProfileDelta(BaseModel):
    """画像增量（用于更新）"""
    cognition: int = Field(default=0, description="认知维度增量 [-100, 100]")
    affect: int = Field(default=0, description="情感维度增量 [-100, 100]")
    behavior: int = Field(default=0, description="行为维度增量 [-100, 100]")


class UserProfile(BaseModel):
    """
    学习者画像（与前端 AppState.profile 完全一致）
    所有维度范围：0-100
    """
    cognition: int = Field(ge=0, le=100, description="认知维度 [0-100]")
    affect: int = Field(ge=0, le=100, description="情感维度 [0-100]")
    behavior: int = Field(ge=0, le=100, description="行为维度 [0-100]")
    lastUpdate: Optional[str] = Field(default=None, description="最后更新时间 (ISO 8601)")

    @field_validator("lastUpdate", mode="before")
    def format_timestamp(cls, v):
        """确保时间戳格式为 ISO 8601"""
        if isinstance(v, datetime):
            return v.isoformat() + "Z"
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "cognition": 65,
                "affect": 42,
                "behavior": 78,
                "lastUpdate": "2026-02-09T10:00:00.000Z"
            }
        }


class ProfileUpdateRequest(BaseModel):
    """画像更新请求（用户手动校准）"""
    cognition: Optional[int] = Field(None, ge=0, le=100, description="认知维度")
    affect: Optional[int] = Field(None, ge=0, le=100, description="情感维度")
    behavior: Optional[int] = Field(None, ge=0, le=100, description="行为维度")
    user_comment: Optional[str] = Field(None, description="用户备注")
    likert_trust: Optional[int] = Field(None, ge=1, le=5, description="信任度评分 [1-5]")
