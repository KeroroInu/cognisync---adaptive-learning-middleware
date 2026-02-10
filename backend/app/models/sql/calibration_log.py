"""
CalibrationLog Model - 校准日志表
记录用户手动校准画像时的冲突数据
"""
import uuid
import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import Integer, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class Dimension(str, enum.Enum):
    """画像维度枚举"""
    COGNITION = "cognition"
    AFFECT = "affect"
    BEHAVIOR = "behavior"


class ConflictLevel(str, enum.Enum):
    """冲突等级枚举"""
    LOW = "low"        # 差值 < 15
    MEDIUM = "medium"  # 差值 15-30
    HIGH = "high"      # 差值 > 30


class CalibrationLog(Base, UUIDMixin):
    """
    校准日志表
    记录用户纠正 AI 评估的冲突数据
    """
    __tablename__ = "calibration_logs"
    __table_args__ = {"comment": "画像校准日志表"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    timestamp: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="校准时间"
    )

    dimension: Mapped[Dimension] = mapped_column(
        Enum(Dimension, name="dimension", native_enum=False),
        nullable=False,
        comment="校准的维度：cognition | affect | behavior"
    )

    system_value: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="系统 AI 评估值 [0-100]"
    )

    user_value: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="用户自评值 [0-100]"
    )

    conflict_level: Mapped[ConflictLevel] = mapped_column(
        Enum(ConflictLevel, name="conflict_level", native_enum=False),
        nullable=False,
        comment="冲突等级：low | medium | high"
    )

    user_comment: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="用户备注（为什么纠正）"
    )

    likert_trust: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Likert 信任度评分 [1-5]"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="calibration_logs",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return (
            f"<CalibrationLog(id={self.id}, dimension={self.dimension}, "
            f"system={self.system_value}, user={self.user_value}, conflict={self.conflict_level})>"
        )
