"""
数据库初始化脚本
用于创建所有表结构
"""
import asyncio
from app.db.postgres import engine
from app.models.sql.base import Base

# 导入所有模型以确保它们被注册
from app.models.sql.user import User
from app.models.sql.message import ChatMessage
from app.models.sql.profile import ProfileSnapshot
from app.models.sql.calibration_log import CalibrationLog
from app.models.sql.chat_session import ChatSession
from app.models.sql.scale import ScaleTemplate, ScaleResponse
from app.models.sql.onboarding import OnboardingSession


async def init_db():
    """创建所有表"""
    async with engine.begin() as conn:
        # 创建所有表
        await conn.run_sync(Base.metadata.create_all)
        print("✅ All tables created successfully!")


async def drop_all():
    """删除所有表（谨慎使用！）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        print("⚠️  All tables dropped!")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "drop":
        print("⚠️  WARNING: This will drop all tables!")
        confirm = input("Type 'yes' to confirm: ")
        if confirm.lower() == "yes":
            asyncio.run(drop_all())
        else:
            print("Cancelled.")
    else:
        asyncio.run(init_db())
