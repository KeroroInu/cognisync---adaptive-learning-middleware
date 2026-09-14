"""Immutable publications and bounded private file receipts; never execute uploaded code."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, String, Integer, LargeBinary, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin
from app.models.sql.classroom import now


class ClassroomMaterial(Base, UUIDMixin):
    __tablename__ = "classroom_materials"
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_sessions.id"), index=True)
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))
    configuration: Mapped[dict] = mapped_column(JSONB, default=dict)
    filename: Mapped[str] = mapped_column(String(180), default="")
    sha256: Mapped[str] = mapped_column(String(64), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    closed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)


class MaterialReceipt(Base, UUIDMixin):
    __tablename__ = "classroom_material_receipts"
    __table_args__ = (UniqueConstraint("user_id", "request_id", name="uq_material_receipt_request"),)
    material_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("classroom_materials.id"), index=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"), index=True)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(20))
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now)
