"""
Research Task Models - 教学研究任务和学生提交记录
"""
import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class ResearchTaskStatus(str, enum.Enum):
    """研究任务状态"""
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ResearchTask(Base, UUIDMixin):
    """
    研究任务表
    教师上传的代码填空练习
    """
    __tablename__ = "research_tasks"
    __table_args__ = (
        Index("ix_research_tasks_status", "status"),
        {"comment": "教学研究任务表"},
    )

    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="任务标题",
    )

    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="任务描述",
    )

    instructions: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="给学生的操作说明",
    )

    ai_prompt: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="教师给 AI 的教学提示（本节课上下文、学习目标等）",
    )

    code_content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="代码文件内容（教师上传）",
    )

    language: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="python",
        comment="编程语言：python / javascript / java / cpp / go",
    )

    status: Mapped[ResearchTaskStatus] = mapped_column(
        Enum(ResearchTaskStatus, name="research_task_status", native_enum=False),
        default=ResearchTaskStatus.DRAFT,
        nullable=False,
        comment="状态：draft | active | archived",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="创建时间",
    )

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="更新时间",
    )

    # 关系
    submissions: Mapped[list["ResearchTaskSubmission"]] = relationship(
        "ResearchTaskSubmission",
        back_populates="task",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<ResearchTask(id={self.id}, title={self.title}, status={self.status})>"


class ResearchTaskSubmission(Base, UUIDMixin):
    """
    研究任务提交记录表
    记录学生的代码进度和完成状态
    """
    __tablename__ = "research_task_submissions"
    __table_args__ = (
        Index("ix_research_submissions_user_task", "user_id", "task_id"),
        {"comment": "教学研究任务提交记录表"},
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("research_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="任务 ID（外键）",
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户 ID（外键）",
    )

    code_submitted: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
        comment="学生最后提交/保存的代码",
    )

    is_completed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        comment="是否已完成任务",
    )

    started_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="学生开始任务的时间（前端计时起点）",
    )

    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="完成时间",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="首次保存时间",
    )

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="最后更新时间",
    )

    # 关系
    task: Mapped["ResearchTask"] = relationship(
        "ResearchTask",
        back_populates="submissions",
    )

    def __repr__(self) -> str:
        return (
            f"<ResearchTaskSubmission(id={self.id}, "
            f"user_id={self.user_id}, task_id={self.task_id}, "
            f"is_completed={self.is_completed})>"
        )
