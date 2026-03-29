"""
EmotionExperimentRun Model - 情感实验运行记录
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin

if TYPE_CHECKING:
    pass


class EmotionExperimentRun(Base, UUIDMixin):
    """
    公开对话数据集情感实验运行记录
    """

    __tablename__ = "emotion_experiment_runs"
    __table_args__ = (
        Index("ix_emotion_experiment_runs_created_at", "created_at"),
        Index("ix_emotion_experiment_runs_original_filename", "original_filename"),
        {"comment": "公开数据集情感实验运行记录"},
    )

    original_filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="上传的原始文件名",
    )

    output_filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="导出的分析结果文件名",
    )

    text_column: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="文本列名",
    )

    conversation_id_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="会话列名",
    )

    speaker_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="说话人列名",
    )

    expected_label_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="原始标签列名",
    )

    profile_key_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="画像分组列名",
    )

    detected_columns: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="检测到的 CSV 列",
    )

    label_mapping: Mapped[dict[str, list[str]]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="标签映射配置",
    )

    rows_processed: Mapped[int] = mapped_column(Integer, nullable=False, comment="总行数")
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, comment="跳过行数")
    analyzed_rows: Mapped[int] = mapped_column(Integer, nullable=False, comment="分析行数")
    compared_rows: Mapped[int] = mapped_column(Integer, nullable=False, comment="可对比行数")
    matched_rows: Mapped[int] = mapped_column(Integer, nullable=False, comment="命中标签行数")
    unique_profiles: Mapped[int] = mapped_column(Integer, nullable=False, comment="画像实体数")
    unique_conversations: Mapped[int] = mapped_column(Integer, nullable=False, comment="会话数")

    preview_rows: Mapped[list[dict]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="预览结果行",
    )

    csv_content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="完整导出 CSV 内容",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="创建时间",
    )

    def __repr__(self) -> str:
        return f"<EmotionExperimentRun(id={self.id}, original_filename={self.original_filename})>"
