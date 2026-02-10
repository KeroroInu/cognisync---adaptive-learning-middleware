"""
基础 Schema - 定义通用响应格式和基础模型
"""
from typing import Generic, TypeVar, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field

T = TypeVar("T")


class SuccessResponse(BaseModel, Generic[T]):
    """成功响应（与前端契约一致）"""
    success: bool = True
    data: T


class ErrorDetail(BaseModel):
    """错误详情"""
    code: str
    message: str
    details: Optional[Any] = None


class ErrorResponse(BaseModel):
    """错误响应"""
    success: bool = False
    error: ErrorDetail


class TimestampMixin(BaseModel):
    """时间戳 Mixin"""
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat() + "Z"
        }
