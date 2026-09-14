"""Published lesson bindings and preparation evidence, separate from learner profiles."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin
from app.models.sql.classroom import now


class LessonPlan(Base, UUIDMixin):
    __tablename__ = "classroom_lesson_plans"
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id", ondelete="RESTRICT"), unique=True)
    # Immutable once started. Each group maps to an explicit task and its publication snapshot.
    configuration: Mapped[dict] = mapped_column(JSONB, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class PreparationRecord(Base, UUIDMixin):
    __tablename__ = "preparation_records"
    __table_args__ = (
        UniqueConstraint("user_id", "request_id", name="uq_preparation_request"),
        Index("ix_preparation_user_created", "user_id", "created_at"),
        Index("ix_preparation_user_kind_created", "user_id", "kind", "created_at"),
    )
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    session_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id", ondelete="RESTRICT"), index=True)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
