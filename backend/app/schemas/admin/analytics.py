"""
分析统计 Schema 定义
"""
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class SystemOverview(BaseModel):
    """系统概览"""
    totalUsers: int = Field(..., description="总用户数")
    totalMessages: int = Field(..., description="总消息数")
    totalConcepts: int = Field(..., description="总概念数")
    avgMessagesPerUser: float = Field(..., description="人均消息数")
    activeUsersLast7Days: int = Field(..., description="7天活跃用户数")


class UserActivity(BaseModel):
    """用户活跃度"""
    date: str = Field(..., description="日期")
    activeUsers: int = Field(..., description="活跃用户数")
    totalMessages: int = Field(..., description="消息总数")


class ConceptMastery(BaseModel):
    """概念掌握度统计"""
    conceptName: str = Field(..., description="概念名称")
    avgMastery: float = Field(..., description="平均掌握度")
    userCount: int = Field(..., description="学习人数")
    totalInteractions: int = Field(..., description="总交互次数")


class AnalyticsOverviewResponse(BaseModel):
    """分析概览响应"""
    overview: SystemOverview
    activityTrend: List[UserActivity]


class AnalyticsConceptsResponse(BaseModel):
    """概念分析响应"""
    concepts: List[ConceptMastery]
