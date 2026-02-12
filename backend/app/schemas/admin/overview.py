"""
Admin 概览 Schema
"""
from pydantic import BaseModel, Field


class OverviewStats(BaseModel):
    """系统概览统计"""
    users_count: int = Field(..., description="用户总数")
    sessions_count: int = Field(..., description="会话总数")
    messages_count: int = Field(..., description="消息总数")
    templates_count: int = Field(..., description="量表模板总数")
    responses_count: int = Field(..., description="量表响应总数")

    class Config:
        json_schema_extra = {
            "example": {
                "users_count": 150,
                "sessions_count": 450,
                "messages_count": 3200,
                "templates_count": 5,
                "responses_count": 280
            }
        }
