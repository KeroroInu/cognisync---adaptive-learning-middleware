"""Explicit pre/post rounds, independent of the historical profile scales."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin


class AssessmentRound(Base, UUIDMixin):
    __tablename__ = "assessment_rounds"
    __table_args__ = (
        Index("uq_assessment_open_scope", "phase", "class_name", unique=True, postgresql_where=text("enabled = true")),
        {"comment": "前后测题本；首次开放后内容冻结，修改必须新建版本"},
    )
    phase: Mapped[str] = mapped_column(String(10), nullable=False)
    class_name: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    questions: Mapped[list] = mapped_column(JSONB, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))


class AssessmentResponse(Base, UUIDMixin):
    __tablename__ = "assessment_responses"
    __table_args__ = (UniqueConstraint("user_id", "round_id", name="uq_assessment_answer"), {"comment": "前后测原始答卷；不回写画像、不自动计算能力分"})
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    round_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("assessment_rounds.id", ondelete="RESTRICT"), index=True)
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False)
    group_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    class_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)
    started_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
