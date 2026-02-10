"""
User Model - 用户表
"""
import uuid
from datetime import datetime
from sqlalchemy import String
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

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )

    # 关系（可选，用于查询优化）
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

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email})>"
