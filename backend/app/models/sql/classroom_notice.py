"""Ephemeral class notices. Deliberately excluded from research exports."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin
from app.models.sql.classroom import now


class ClassroomNotice(Base, UUIDMixin):
    __tablename__ = "classroom_notices"
    class_name: Mapped[str] = mapped_column(String(100), index=True)
    target_user_ids: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    content: Mapped[str | None] = mapped_column(String(4000))
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), index=True)
