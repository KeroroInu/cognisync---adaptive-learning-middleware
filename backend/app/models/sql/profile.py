"""
ProfileSnapshot Model - 画像快照表
用于记录系统评估和用户自评的画像数据（用于冲突分析）
"""
import uuid
import enum
from datetime import datetime
from sqlalchemy import Integer, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class ProfileSource(str, enum.Enum):
    """画像来源枚举"""
    SYSTEM = "system"  # 系统 AI 评估
    USER = "user"      # 用户自评


class ProfileSnapshot(Base, UUIDMixin):
    """
    画像快照表
    记录某一时刻的学习者画像数据
    """
    __tablename__ = "profile_snapshots"
    __table_args__ = {"comment": "学习者画像快照表"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    cognition: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="认知维度 [0-100]"
    )

    affect: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="情感维度 [0-100]"
    )

    behavior: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="行为维度 [0-100]"
    )

    source: Mapped[ProfileSource] = mapped_column(
        Enum(ProfileSource, name="profile_source", native_enum=False),
        nullable=False,
        comment="来源：system（AI评估）| user（用户自评）"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="创建时间"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="profile_snapshots",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return (
            f"<ProfileSnapshot(id={self.id}, user_id={self.user_id}, "
            f"source={self.source}, cognition={self.cognition})>"
        )
