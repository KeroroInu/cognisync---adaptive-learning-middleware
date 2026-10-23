"""
Research Task Models - 教学研究任务和学生提交记录
"""
import uuid
import enum
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Text, Boolean, ForeignKey, Enum, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB, UUID, TIMESTAMP

from app.models.sql.base import Base, UUIDMixin


class ResearchTaskStatus(str, enum.Enum):
    """研究任务状态"""
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ResearchTaskKind(str, enum.Enum):
    """教学任务用途。

    ``learning`` 是当前项目学习主任务；``transfer_test`` 仅为读取
    2026-09-04 前产生的网页迁移任务与研究证据而保留。
    """

    LEARNING = "learning"
    TRANSFER_TEST = "transfer_test"


class ProjectBlueprintStatus(str, enum.Enum):
    """教师项目蓝图版本状态。"""

    DRAFT = "draft"
    PUBLISHED = "published"


class ResearchTask(Base, UUIDMixin):
    """
    研究任务表
    教师上传的代码填空练习
    """
    __tablename__ = "research_tasks"
    __table_args__ = (
        Index("ix_research_tasks_status", "status"),
        Index("ix_research_tasks_target_group_status", "target_group", "status"),
        Index(
            "ix_research_tasks_kind_group_status",
            "task_kind",
            "target_group",
            "status",
        ),
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

    target_group: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="all",
        comment="投放组别：all | pdt | ai_pbl | experience | lecture（历史）| unassigned",
    )

    task_kind: Mapped[ResearchTaskKind] = mapped_column(
        Enum(
            ResearchTaskKind,
            name="research_task_kind",
            native_enum=False,
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
            validate_strings=True,
        ),
        nullable=False,
        default=ResearchTaskKind.LEARNING,
        comment="任务用途：当前使用 learning；transfer_test 仅历史兼容",
    )

    test_template: Mapped[Optional[str]] = mapped_column(
        String(80),
        nullable=True,
        comment="历史网页迁移模板标识；当前不再创建",
    )

    ai_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="当前任务是否允许学生请求 AI 支架",
    )

    status: Mapped[ResearchTaskStatus] = mapped_column(
        Enum(ResearchTaskStatus, name="research_task_status", native_enum=False),
        default=ResearchTaskStatus.DRAFT,
        nullable=False,
        comment="状态：draft | active | archived",
    )

    current_blueprint_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_blueprint_versions.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
        index=True,
        comment="当前发布的教师项目蓝图版本",
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
        # 一名学生在一个任务中只应有一条提交记录：所有读取路径都使用
        # scalar_one_or_none()，出现重复行会直接抛 MultipleResultsFound 并返回 500。
        # 该约束同时使「首次关键事件时原子冻结教师蓝图版本」成为可能
        # （见 research_event_service.freeze_blueprint_version 的 ON CONFLICT）。
        UniqueConstraint("task_id", "user_id", name="uq_research_submission_task_user"),
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

    workspace_data: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="项目解构工作台过程数据：观察卡、功能卡、关系、路径与模块进度",
    )

    blueprint_version_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_blueprint_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="学生首次进入/保存任务时冻结的教师蓝图版本",
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


class ProjectBlueprintVersion(Base, UUIDMixin):
    """教师项目蓝图的版本化快照；发布后不可原地修改。"""

    __tablename__ = "project_blueprint_versions"
    __table_args__ = (
        UniqueConstraint("task_id", "version", name="uq_project_blueprint_task_version"),
        Index("ix_project_blueprint_task_status", "task_id", "status"),
        {"comment": "教师项目蓝图版本表"},
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("research_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="所属研究任务",
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, comment="任务内递增版本号")
    schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        comment="蓝图 JSON 结构版本",
    )
    status: Mapped[ProjectBlueprintStatus] = mapped_column(
        Enum(ProjectBlueprintStatus, name="project_blueprint_status", native_enum=False),
        nullable=False,
        default=ProjectBlueprintStatus.DRAFT,
        comment="draft | published",
    )
    config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment="模块、契约、映射、测试与支架策略的完整版本快照",
    )
    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="规范化 JSON 的 SHA-256，用于实验材料复现",
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=True,
        comment="发布时间",
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<ProjectBlueprintVersion(task_id={self.task_id}, "
            f"version={self.version}, status={self.status})>"
        )
