"""Class-scoped controls and immutable question publications, independent of profiles."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin


def now():
    return datetime.now(timezone.utc)


class ClassroomSession(Base, UUIDMixin):
    __tablename__ = "classroom_sessions"
    __table_args__ = (Index("uq_current_classroom", "class_name", unique=True, postgresql_where=text("is_current = true")),)
    class_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    state: Mapped[str] = mapped_column(String(10), default="open", nullable=False)
    closes_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class ClassroomPublication(Base, UUIDMixin):
    __tablename__ = "classroom_publications"
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id", ondelete="RESTRICT"), index=True)
    question: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    published_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
    closed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))


class ClassroomResponse(Base, UUIDMixin):
    __tablename__ = "classroom_responses"
    __table_args__ = (UniqueConstraint("user_id", "publication_id", name="uq_classroom_answer"),)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    publication_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_publications.id", ondelete="RESTRICT"), index=True)
    answer: Mapped[str | None] = mapped_column(String(4000))
    answers: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    class_snapshot: Mapped[str] = mapped_column(String(100), nullable=False)
    group_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class ClassroomControlEvent(Base, UUIDMixin):
    __tablename__ = "classroom_control_events"
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id", ondelete="RESTRICT"), index=True)
    teacher_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class ClassroomQuestionSet(Base, UUIDMixin):
    """Saved, immutable question sets, reusable across classes without mixing answers."""
    __tablename__ = "classroom_question_sets"
    title: Mapped[str] = mapped_column(String(120))
    questions: Mapped[list] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(2000), default="")
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
