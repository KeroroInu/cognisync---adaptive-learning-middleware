"""
分析统计 Schema 定义
"""
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


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


class EmotionDistributionItem(BaseModel):
    legacyEmotion: str = Field(..., description="兼容旧字段的情感值")
    emotionCode: str = Field(..., description="情感编码")
    emotionName: str = Field(..., description="情感名称")
    intensity: str = Field(..., description="情感强度")
    count: int = Field(..., description="出现次数")
    percentage: float = Field(..., description="占比")
    avgConfidence: float = Field(..., description="平均置信度")


class EmotionDistributionResponse(BaseModel):
    totalLogs: int = Field(..., description="统计窗口内的情感日志数")
    items: List[EmotionDistributionItem] = Field(default_factory=list, description="情感分布")


class EmotionTrendPoint(BaseModel):
    date: str = Field(..., description="日期")
    totalCount: int = Field(..., description="当天日志数")
    averageConfidence: float = Field(..., description="当天平均置信度")
    averageValence: float = Field(..., description="当天平均效价")
    averageArousal: float = Field(..., description="当天平均唤醒度")
    emotionCounts: Dict[str, int] = Field(default_factory=dict, description="按情感编码计数")


class EmotionTrendResponse(BaseModel):
    days: int = Field(..., description="统计天数")
    points: List[EmotionTrendPoint] = Field(default_factory=list, description="时间序列")


class EmotionUserSummary(BaseModel):
    userId: str = Field(..., description="用户 ID")
    studentId: str = Field(..., description="学号")
    name: str = Field(..., description="用户名")
    totalLogs: int = Field(..., description="情感日志总数")
    lastAnalyzedAt: Optional[str] = Field(default=None, description="最近分析时间")
    latestEmotionCode: Optional[str] = Field(default=None, description="最近一次情感编码")
    latestEmotionName: Optional[str] = Field(default=None, description="最近一次情感名称")
    currentCognition: Optional[int] = Field(default=None, description="最近画像认知值")
    currentAffect: Optional[int] = Field(default=None, description="最近画像情感值")
    currentBehavior: Optional[int] = Field(default=None, description="最近画像行为值")


class EmotionUserLogItem(BaseModel):
    id: str = Field(..., description="情感日志 ID")
    createdAt: str = Field(..., description="创建时间")
    sessionId: Optional[str] = Field(default=None, description="会话 ID")
    messageId: str = Field(..., description="消息 ID")
    intent: str = Field(..., description="意图")
    emotion: str = Field(..., description="兼容旧情感值")
    emotionCode: str = Field(..., description="情感编码")
    emotionName: str = Field(..., description="情感名称")
    intensity: str = Field(..., description="情感强度")
    confidence: float = Field(..., description="置信度")
    arousal: float = Field(..., description="唤醒度")
    valence: float = Field(..., description="效价")
    detectedConcepts: List[str] = Field(default_factory=list, description="概念列表")
    evidence: List[str] = Field(default_factory=list, description="证据列表")
    deltaCognition: int = Field(..., description="认知增量")
    deltaAffect: int = Field(..., description="情感增量")
    deltaBehavior: int = Field(..., description="行为增量")
    profileCognition: Optional[int] = Field(default=None, description="画像认知值")
    profileAffect: Optional[int] = Field(default=None, description="画像情感值")
    profileBehavior: Optional[int] = Field(default=None, description="画像行为值")


class EmotionUserDetailResponse(BaseModel):
    summary: EmotionUserSummary
    logs: List[EmotionUserLogItem] = Field(default_factory=list, description="情感日志明细")
