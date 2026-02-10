"""
PostgreSQL 数据库连接管理 - 使用 SQLAlchemy 异步引擎
"""
import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
    AsyncEngine,
)

from app.core.config import settings

logger = logging.getLogger(__name__)

# 创建异步引擎
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    future=True,
)

# 创建会话工厂
async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def init_db():
    """
    初始化数据库（创建所有表）
    MVP 版本：直接使用 create_all，不使用 Alembic
    """
    try:
        # 导入所有模型（确保 metadata 包含所有表定义）
        from app.models.sql import Base

        logger.info("Creating database tables...")

        async with engine.begin() as conn:
            # 创建所有表
            await conn.run_sync(Base.metadata.create_all)

        logger.info("✅ Database tables created successfully")

        # 打印已创建的表
        async with engine.begin() as conn:
            def get_table_names(sync_conn):
                inspector = sync_conn.dialect.get_inspector(sync_conn)
                return inspector.get_table_names()

            tables = await conn.run_sync(get_table_names)
            logger.info(f"📊 Created tables: {', '.join(tables)}")

    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")
        raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    依赖注入：获取数据库会话
    用法：
        @app.get("/")
        async def handler(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
