"""Teacher-opened, AI-free classroom checks. Never updates mastery."""
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.sql.base import Base, UUIDMixin


def now():
    return datetime.now(timezone.utc)


class ProjectReviewRound(Base, UUIDMixin):
    __tablename__ = 'project_review_rounds'
    created_by: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('users.id', ondelete='RESTRICT'))
    title: Mapped[str] = mapped_column(String(120), default='项目回顾')
    template: Mapped[dict] = mapped_column(JSONB)
    template_hash: Mapped[str] = mapped_column(String(64))
    session_ids: Mapped[list] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default='draft')
    results_published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
    reviewed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class ProjectReviewResponse(Base, UUIDMixin):
    __tablename__ = 'project_review_responses'
    __table_args__ = (UniqueConstraint('round_id', 'user_id'),)
    round_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('project_review_rounds.id', ondelete='RESTRICT'), index=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('users.id', ondelete='RESTRICT'), index=True)
    session_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('classroom_sessions.id', ondelete='RESTRICT'))
    task_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('research_tasks.id', ondelete='RESTRICT'))
    group_snapshot: Mapped[str] = mapped_column(String(20))
    class_snapshot: Mapped[str] = mapped_column(String(100))
    ai_hold: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    answers: Mapped[dict] = mapped_column(JSONB, default=dict)
    first_prediction: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    test_plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    grade: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class ProjectReviewEvent(Base, UUIDMixin):
    __tablename__ = 'project_review_events'
    __table_args__ = (UniqueConstraint('response_id', 'request_id'),)
    response_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('project_review_responses.id', ondelete='RESTRICT'), index=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('users.id', ondelete='RESTRICT'), index=True)
    request_id: Mapped[UUID] = mapped_column(PGUUID)
    actor_id: Mapped[UUID] = mapped_column(PGUUID, ForeignKey('users.id', ondelete='RESTRICT'))
    kind: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
