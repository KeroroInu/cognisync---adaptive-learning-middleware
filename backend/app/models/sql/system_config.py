"""
SystemConfig Model - 系统配置表
用于持久化存储可在运行时修改的系统配置（如 LLM 模型配置）
"""
from datetime import datetime
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import TIMESTAMP

from app.models.sql.base import Base


class SystemConfig(Base):
    """
    系统配置键值表
    key 为主键，value 为 JSON 字符串
    """
    __tablename__ = "system_configs"
    __table_args__ = {"comment": "系统运行时配置表"}

    key: Mapped[str] = mapped_column(
        String(100),
        primary_key=True,
        comment="配置键"
    )

    value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="配置值（JSON 字符串）"
    )

    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="最后更新时间"
    )

    def __repr__(self) -> str:
        return f"<SystemConfig(key={self.key})>"
