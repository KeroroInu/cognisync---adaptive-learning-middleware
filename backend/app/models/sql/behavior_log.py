"""
BehaviorLog Model - 用户行为日志表
记录真实的学习行为数据，用于计算 Behavior 维度
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
from sqlalchemy import ForeignKey, Index, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.sql.user import User
    from app.models.sql.chat_session import ChatSession


class BehaviorLog(Base, UUIDMixin):
    """
    用户行为日志表
    记录学习会话的真实行为数据

    核心指标：
    - 学习时长（session_duration）
    - 消息参与度（message_count）
    - 概念参与度（concept_engagement）
    - 响应及时性（response_time_avg）
    - 完成率（task_completion_rate）
    """
    __tablename__ = "behavior_logs"
    __table_args__ = (
        Index("ix_behavior_logs_user_timestamp", "user_id", "timestamp"),
        Index("ix_behavior_logs_session", "session_id"),
        {"comment": "用户行为日志表"}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        comment="会话 ID（外键）"
    )

    timestamp: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="记录时间"
    )

    # 学习时长（秒）
    session_duration: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
        comment="会话持续时长（秒）"
    )

    # 消息参与度
    message_count: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
        comment="该会话内的消息数量"
    )

    # 概念参与度
    concept_engagement: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
        comment="该会话涉及的不同概念数量"
    )

    # 平均响应时间（秒）
    response_time_avg: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="用户平均响应时间（秒）"
    )

    # 任务完成率（0.0-1.0）
    task_completion_rate: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="任务完成率 [0.0-1.0]（研究模式适用）"
    )

    # 连续学习天数（用于衡量坚持度）
    consecutive_days: Mapped[int] = mapped_column(
        nullable=False,
        default=1,
        comment="连续学习天数"
    )

    # 关系
    user: Mapped[User] = relationship(
        "User",
        back_populates="behavior_logs",
        lazy="raise"
    )

    session: Mapped[ChatSession] = relationship(
        "ChatSession",
        lazy="raise"
    )

    def __repr__(self) -> str:
        return (
            f"<BehaviorLog(id={self.id}, user_id={self.user_id}, "
            f"duration={self.session_duration}s, messages={self.message_count})>"
        )
