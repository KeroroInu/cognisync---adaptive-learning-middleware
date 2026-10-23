"""Student-authored feedback; separate from learning/ability evidence."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.sql.base import Base, UUIDMixin
from app.models.sql.classroom import now


class StudentAdvice(Base, UUIDMixin):
    __tablename__ = "student_advice"
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, comment="服务器认证的学生 UUID")
    content: Mapped[str] = mapped_column(String(2000), comment="学生建议原文；实名反馈，不是能力测验")
    client_context: Mapped[dict] = mapped_column(JSONB, comment="客户端自报任务、项目和版本信息；未验证课次绑定")
    client_created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), comment="客户端自报填写时间；未校验时钟")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=now, index=True, comment="服务器首次收件时间；重试不覆盖")
