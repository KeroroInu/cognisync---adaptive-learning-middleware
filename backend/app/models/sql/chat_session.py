"""
ChatSession Model - 会话表
"""
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class ChatSession(Base, UUIDMixin):
    """
    会话表
    用于组织对话消息
    """
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("ix_chat_sessions_user_created", "user_id", "created_at"),
        {"comment": "会话表"}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="会话创建时间"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="sessions",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<ChatSession(id={self.id}, user_id={self.user_id})>"
