"""Append-only common support evidence; legacy profile scores are not inputs."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin
from app.models.sql.classroom import now


class LearningSupportTurn(Base, UUIDMixin):
    __tablename__ = "learning_support_turns"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_support_request"),
        Index("ix_support_scope_time", "user_id", "scope", "created_at"),
    )
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    session_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id", ondelete="RESTRICT"), index=True)
    task_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("research_tasks.id", ondelete="RESTRICT"))
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    scope: Mapped[str] = mapped_column(String(600))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class LearningPracticeReview(Base, UUIDMixin):
    __tablename__ = "learning_practice_reviews"
    template_id: Mapped[str] = mapped_column(String(80), unique=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    reviewed_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    approved: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
