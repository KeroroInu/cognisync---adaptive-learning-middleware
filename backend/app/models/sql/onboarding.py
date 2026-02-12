"""
OnboardingSession Model - 入职会话
"""
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import String, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB

from app.models.sql.base import Base, UUIDMixin


class OnboardingSession(Base, UUIDMixin):
    """
    入职会话表
    存储用户初次上手时的对话记录
    """
    __tablename__ = "onboarding_sessions"
    __table_args__ = (
        Index("ix_onboarding_sessions_user", "user_id"),
        Index("ix_onboarding_sessions_created", "created_at"),
        {"comment": "入职会话表"}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    mode: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="模式：guided | free"
    )

    raw_transcript: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="原始对话记录"
    )

    extracted_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="提取的信息（JSON）"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="onboarding_sessions",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<OnboardingSession(id={self.id}, user_id={self.user_id}, mode={self.mode})>"
