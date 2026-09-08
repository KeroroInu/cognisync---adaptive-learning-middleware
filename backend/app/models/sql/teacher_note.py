"""Append-only classroom observations; not student ability scores or agent instructions."""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin


class TeacherNote(Base, UUIDMixin):
    __tablename__ = "teacher_notes"
    __table_args__ = (Index("ix_teacher_notes_student_lesson", "student_id", "lesson_date", "created_at"),)

    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    teacher_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    teacher_name: Mapped[str] = mapped_column(String(200), nullable=False)
    group_snapshot: Mapped[str] = mapped_column(String(40), nullable=False)
    class_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    lesson_date: Mapped[date] = mapped_column(Date, nullable=False)
    lesson_label: Mapped[str] = mapped_column(String(120), nullable=False)
    observation: Mapped[str] = mapped_column(Text, nullable=False)
    interpretation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    next_step: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    assessment: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="教师按指定评分规准记录的单项评分；空值表示未评分，非零分")
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("teacher_notes.id", ondelete="RESTRICT"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
