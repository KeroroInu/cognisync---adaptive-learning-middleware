"""
User Model - 用户表
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import TIMESTAMP

from app.models.sql.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.sql.calibration_log import CalibrationLog
    from app.models.sql.chat_session import ChatSession
    from app.models.sql.emotion_log import EmotionLog
    from app.models.sql.message import ChatMessage
    from app.models.sql.onboarding import OnboardingSession
    from app.models.sql.profile import ProfileSnapshot
    from app.models.sql.scale import ScaleResponse


class User(Base, UUIDMixin):
    """
    用户表
    存储基本用户信息
    """
    __tablename__ = "users"
    __table_args__ = {"comment": "用户表"}

    student_id: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="学号（唯一，用于登录）"
    )

    email: Mapped[Optional[str]] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
        comment="邮箱（可选）"
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="用户姓名（必填）"
    )

    role: Mapped[str] = mapped_column(
        String(50),
        default="learner",
        nullable=False,
        comment="用户角色：learner | admin"
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否激活"
    )

    password_hash: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="密码哈希"
    )

    onboarding_mode: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="引导模式：scale | ai"
    )

    has_completed_onboarding: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否完成引导"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="创建时间"
    )

    last_active_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="最后活跃时间"
    )

    # 关系
    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    profile_snapshots: Mapped[list[ProfileSnapshot]] = relationship(
        "ProfileSnapshot",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    calibration_logs: Mapped[list[CalibrationLog]] = relationship(
        "CalibrationLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    sessions: Mapped[list[ChatSession]] = relationship(
        "ChatSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    emotion_logs: Mapped[list[EmotionLog]] = relationship(
        "EmotionLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    scale_responses: Mapped[list[ScaleResponse]] = relationship(
        "ScaleResponse",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    onboarding_sessions: Mapped[list[OnboardingSession]] = relationship(
        "OnboardingSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, student_id={self.student_id}, name={self.name})>"
