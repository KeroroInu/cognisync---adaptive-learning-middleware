"""
User Model - 用户表
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
from sqlalchemy import String, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import TIMESTAMP

from app.models.sql.base import Base, UUIDMixin

if TYPE_CHECKING:
    from app.models.sql.behavior_log import BehaviorLog
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

    gender: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

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

    school_class: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    class_name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
        comment="实验班级名称/代码（由管理员核对）"
    )

    experiment_group: Mapped[str] = mapped_column(
        String(20),
        default="unassigned",
        nullable=False,
        index=True,
        comment="实验条件：unassigned | pdt | ai_pbl | lecture"
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
    #
    # ⚠️ 加载策略说明：
    # User 位于 get_current_user() 依赖链上，几乎每个受保护接口都会加载一次。
    # 若这些集合使用 lazy="selectin"，每次鉴权都会把该用户的全部历史消息、
    # 情感日志、画像快照等拉进内存（并因下游模型同样使用 selectin 产生二级扇出）。
    #
    # 因此统一改为 lazy="raise"：关系默认不加载，且任何隐式访问会立即抛出
    # InvalidRequestError，而不是静默产生 N+1 查询。确实需要关联数据的地方，
    # 请在查询处显式声明 selectinload(User.xxx)。
    # 注意：cascade 删除不受影响，由数据库侧 ON DELETE CASCADE 保证。
    messages: Mapped[list[ChatMessage]] = relationship(
        "ChatMessage",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    profile_snapshots: Mapped[list[ProfileSnapshot]] = relationship(
        "ProfileSnapshot",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    calibration_logs: Mapped[list[CalibrationLog]] = relationship(
        "CalibrationLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    sessions: Mapped[list[ChatSession]] = relationship(
        "ChatSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    emotion_logs: Mapped[list[EmotionLog]] = relationship(
        "EmotionLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    scale_responses: Mapped[list[ScaleResponse]] = relationship(
        "ScaleResponse",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    onboarding_sessions: Mapped[list[OnboardingSession]] = relationship(
        "OnboardingSession",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    behavior_logs: Mapped[list[BehaviorLog]] = relationship(
        "BehaviorLog",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, student_id={self.student_id}, name={self.name})>"
