"""
ChatMessage Model - 聊天消息表
"""
import uuid
import enum
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import String, Text, ForeignKey, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB

from app.models.sql.base import Base, UUIDMixin


class MessageRole(str, enum.Enum):
    """消息角色枚举"""
    USER = "user"
    ASSISTANT = "assistant"


class ChatMessage(Base, UUIDMixin):
    """
    聊天消息表
    存储用户和 AI 的对话记录
    """
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_user_timestamp", "user_id", "timestamp"),
        {"comment": "聊天消息表"}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole, name="message_role", native_enum=False),
        nullable=False,
        comment="消息角色：user | assistant"
    )

    text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="消息文本内容"
    )

    timestamp: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="消息时间戳"
    )

    analysis: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="消息分析结果（JSON）：intent, emotion, detectedConcepts, delta"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="messages",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<ChatMessage(id={self.id}, role={self.role}, user_id={self.user_id})>"
