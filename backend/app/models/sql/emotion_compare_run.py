"""
EmotionCompareRun Model - 情感对比实验运行记录
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin


class EmotionCompareRun(Base, UUIDMixin):
    __tablename__ = "emotion_compare_runs"
    __table_args__ = (
        Index("ix_emotion_compare_runs_created_at", "created_at"),
        Index("ix_emotion_compare_runs_original_filename", "original_filename"),
        Index(
            "ix_emotion_compare_runs_dataset_template_created_at",
            "dataset_template",
            "created_at",
        ),
        Index(
            "ix_emotion_compare_runs_task_type_created_at",
            "task_type",
            "created_at",
        ),
        {"comment": "情感对比实验运行记录"},
    )

    original_filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="上传的原始文件名",
    )

    dataset_template: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="数据集模板标识，如 weibo_single / goemotions_multi",
    )

    label_mode: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="标签模式 single_label | multi_binary",
    )

    source_format: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="源文件格式 csv | xlsx | json",
    )

    task_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="任务类型 single_label | multi_label",
    )

    text_column: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="文本列名",
    )

    expected_label_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="单标签数据集的标签列名",
    )

    expected_label_columns: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="多标签 one-hot 列名列表",
    )

    positive_label_value: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="多标签 one-hot 正样本取值",
    )

    sample_id_column: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        comment="样本 ID 列名",
    )

    label_mapping: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="标签映射配置快照",
    )

    rows_processed: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="处理样本数",
    )

    rows_skipped: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="跳过样本数",
    )

    label_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="标签总数",
    )

    dataset_info: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="数据集解释信息快照",
    )

    base_result: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        comment="基础对比结果快照",
    )

    v2_result: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="论文指标扩展结果快照",
    )

    ablation_result: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        default=None,
        comment="消融实验结果快照",
    )

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        comment="创建时间",
    )

    def __repr__(self) -> str:
        return f"<EmotionCompareRun(id={self.id}, original_filename={self.original_filename})>"
