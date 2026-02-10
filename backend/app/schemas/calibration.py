"""
Calibration Schemas - 校准日志相关 Pydantic 模型（与前端完全对齐）
"""
from datetime import datetime
from uuid import UUID
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator


class CalibrationLogBase(BaseModel):
    """校准日志基础 Schema"""
    dimension: Literal["cognition", "affect", "behavior"]
    system_value: int = Field(..., ge=0, le=100, alias="systemValue")
    user_value: int = Field(..., ge=0, le=100, alias="userValue")
    user_comment: Optional[str] = Field(None, alias="userComment")
    likert_trust: Optional[int] = Field(None, ge=1, le=5, alias="likertTrust")


class CalibrationLogCreate(CalibrationLogBase):
    """创建校准日志请求"""
    user_id: UUID = Field(..., alias="userId")

    model_config = {
        "populate_by_name": True
    }


class CalibrationLogResponse(BaseModel):
    """
    校准日志响应（与前端 AppState.calibrationLogs 完全对齐）
    """
    id: str
    timestamp: str = Field(..., description="ISO 8601 格式时间戳")
    dimension: Literal["cognition", "affect", "behavior"]
    systemValue: int = Field(..., ge=0, le=100)
    userValue: int = Field(..., ge=0, le=100)
    conflictLevel: Literal["low", "medium", "high"]
    userComment: Optional[str] = None
    likertTrust: Optional[int] = Field(None, ge=1, le=5)

    @field_validator("timestamp", mode="before")
    def format_timestamp(cls, v):
        """确保时间戳格式为 ISO 8601"""
        if isinstance(v, datetime):
            return v.isoformat() + "Z"
        return v

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "id": "123e4567-e89b-12d3-a456-426614174000",
                "timestamp": "2026-02-09T10:30:00.000Z",
                "dimension": "cognition",
                "systemValue": 60,
                "userValue": 75,
                "conflictLevel": "medium",
                "userComment": "我觉得我的认知能力被低估了",
                "likertTrust": 3
            }
        }
    }


def calculate_conflict_level(system_value: int, user_value: int) -> Literal["low", "medium", "high"]:
    """
    计算冲突等级
    差值 < 15: low
    差值 15-30: medium
    差值 > 30: high
    """
    diff = abs(system_value - user_value)
    if diff < 15:
        return "low"
    elif diff <= 30:
        return "medium"
    else:
        return "high"
