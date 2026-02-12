"""
Scale Models - 量表模板和响应
"""
import uuid
import enum
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import String, Text, Integer, ForeignKey, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP, JSONB

from app.models.sql.base import Base, UUIDMixin


class ScaleStatus(str, enum.Enum):
    """量表状态枚举"""
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ScaleTemplate(Base, UUIDMixin):
    """
    量表模板表
    存储心理量表的结构定义
    """
    __tablename__ = "scale_templates"
    __table_args__ = (
        Index("ix_scale_templates_status", "status"),
        {"comment": "量表模板表"}
    )

    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        index=True,
        comment="量表名称"
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
        comment="版本号"
    )

    status: Mapped[ScaleStatus] = mapped_column(
        Enum(ScaleStatus, name="scale_status", native_enum=False),
        default=ScaleStatus.DRAFT,
        nullable=False,
        comment="状态：draft | active | archived"
    )

    schema_json: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        comment="量表题目结构（JSON）"
    )

    scoring_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="计分规则（JSON）"
    )

    mapping_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="维度映射到画像（JSON）"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间"
    )

    # 关系
    responses: Mapped[list["ScaleResponse"]] = relationship(
        "ScaleResponse",
        back_populates="template",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ScaleTemplate(id={self.id}, name={self.name}, status={self.status})>"


class ScaleResponse(Base, UUIDMixin):
    """
    量表响应表
    存储用户填写的量表答案
    """
    __tablename__ = "scale_responses"
    __table_args__ = (
        Index("ix_scale_responses_user_template", "user_id", "template_id"),
        Index("ix_scale_responses_created", "created_at"),
        {"comment": "量表响应表"}
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）"
    )

    template_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scale_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="量表模板 ID（外键）"
    )

    answers_json: Mapped[Dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        comment="用户答案（JSON）"
    )

    scores_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=True,
        comment="计算得分（JSON）"
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        nullable=False,
        comment="填写时间"
    )

    # 关系
    user: Mapped["User"] = relationship(
        "User",
        back_populates="scale_responses",
        lazy="selectin"
    )

    template: Mapped["ScaleTemplate"] = relationship(
        "ScaleTemplate",
        back_populates="responses",
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<ScaleResponse(id={self.id}, user_id={self.user_id}, template_id={self.template_id})>"
