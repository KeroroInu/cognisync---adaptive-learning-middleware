"""
EmotionLog Model - 情感分析日志表
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.sql.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.sql.chat_session import ChatSession
    from app.models.sql.message import ChatMessage
    from app.models.sql.user import User


class EmotionLog(Base, UUIDMixin):
    """
    情感分析日志表
    """

    __tablename__ = "emotion_logs"
    __table_args__ = (
        Index("ix_emotion_logs_created_at", "created_at"),
        Index("ix_emotion_logs_user_created", "user_id", "created_at"),
        Index("ix_emotion_logs_session_created", "session_id", "created_at"),
        Index("ix_emotion_logs_code_intensity_created", "emotion_code", "intensity", "created_at"),
        {"comment": "情感分析日志表"},
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）",
    )

    session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="会话 ID（外键）",
    )

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="对应用户消息 ID（外键）",
    )

    intent: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="意图类型",
    )

    legacy_emotion: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="兼容旧字段的情感值",
    )

    emotion_code: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="详细情感编码 E01-E13",
    )

    emotion_name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="详细情感名称",
    )

    intensity: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        comment="情感强度 low|medium|high",
    )

    confidence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="情感识别置信度",
    )

    arousal: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="唤醒度 [-1, 1]",
    )

    valence: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="效价 [-1, 1]",
    )

    detected_concepts: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="检测到的概念列表",
    )

    evidence: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="支持情感判断的证据列表",
    )

    delta_cognition: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="认知维度增量",
    )

    delta_affect: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="情感维度增量",
    )

    delta_behavior: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="行为维度增量",
    )

    profile_cognition: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="分析时的认知画像值",
    )

    profile_affect: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="分析时的情感画像值",
    )

    profile_behavior: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="分析时的行为画像值",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="创建时间",
    )

    user: Mapped[User] = relationship(
        "User",
        back_populates="emotion_logs",
        lazy="selectin",
    )

    session: Mapped[Optional[ChatSession]] = relationship(
        "ChatSession",
        back_populates="emotion_logs",
        lazy="selectin",
    )

    message: Mapped[ChatMessage] = relationship(
        "ChatMessage",
        back_populates="emotion_logs",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<EmotionLog(id={self.id}, user_id={self.user_id}, "
            f"message_id={self.message_id}, emotion_code={self.emotion_code})>"
        )
