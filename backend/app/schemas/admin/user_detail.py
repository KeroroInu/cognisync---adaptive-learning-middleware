"""
Admin 用户详情 Schema
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class UserDetail(BaseModel):
    """用户详情"""
    id: UUID
    email: str
    name: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    last_active_at: Optional[datetime] = None
    messages_count: int = 0
    sessions_count: int = 0
    responses_count: int = 0


class MessageItem(BaseModel):
    """消息项"""
    id: UUID
    role: str
    text: str
    timestamp: datetime
    analysis: Optional[Dict[str, Any]] = None


class ProfileItem(BaseModel):
    """画像快照项"""
    id: UUID
    cognition: int
    affect: int
    behavior: int
    source: str
    created_at: datetime


class ScaleResponseItem(BaseModel):
    """量表响应项"""
    id: UUID
    template_id: UUID
    template_name: str
    answers_json: Dict[str, Any]
    scores_json: Optional[Dict[str, Any]] = None
    created_at: datetime


class UserMessagesResponse(BaseModel):
    """用户消息列表响应"""
    messages: List[MessageItem]
    total: int
    limit: int
    offset: int


class UserProfilesResponse(BaseModel):
    """用户画像列表响应"""
    profiles: List[ProfileItem]
    total: int


class UserScaleResponsesResponse(BaseModel):
    """用户量表响应列表"""
    responses: List[ScaleResponseItem]
    total: int


class CalibrationLogItem(BaseModel):
    """校准日志项"""
    id: UUID
    timestamp: datetime
    dimension: str          # cognition | affect | behavior
    system_value: int
    user_value: int
    conflict_level: str     # low | medium | high
    user_comment: Optional[str] = None
    likert_trust: Optional[int] = None


class UserCalibrationLogsResponse(BaseModel):
    """用户校准日志列表"""
    logs: List[CalibrationLogItem]
    total: int


class GraphNodeItem(BaseModel):
    """知识图谱节点（面向管理端）"""
    id: str
    name: str
    category: str
    mastery: float
    frequency: int
    is_flagged: bool = False


class GraphEdgeItem(BaseModel):
    """知识图谱边"""
    source: str
    target: str
    rel_type: str
    weight: int


class UserGraphResponse(BaseModel):
    """用户知识图谱"""
    nodes: List[GraphNodeItem]
    edges: List[GraphEdgeItem]
