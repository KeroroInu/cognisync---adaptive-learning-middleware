"""
User Model - 用户表
"""
import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class User(Base, UUIDMixin):
    """
    用户表
    存储基本用户信息
    """
    __tablename__ = "users"
    __table_args__ = {"comment": "用户表"}

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
        comment="用户邮箱（唯一）"
    )

    name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="用户姓名"
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

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )

    last_active_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="最后活跃时间"
    )

    # 关系
    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    profile_snapshots: Mapped[list["ProfileSnapshot"]] = relationship(
        "ProfileSnapshot",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    calibration_logs: Mapped[list["CalibrationLog"]] = relationship(
        "CalibrationLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    sessions: Mapped[list["ChatSession"]] = relationship(
        "ChatSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    scale_responses: Mapped[list["ScaleResponse"]] = relationship(
        "ScaleResponse",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    onboarding_sessions: Mapped[list["OnboardingSession"]] = relationship(
        "OnboardingSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email})>"
