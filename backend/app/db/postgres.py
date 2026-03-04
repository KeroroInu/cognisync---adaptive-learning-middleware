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

        # 迁移：添加 student_id 列（幂等，安全重复执行）
        await _migrate_student_id()

        # 迁移：为 scale_responses 添加 started_at 列
        await _migrate_scale_started_at()

        # 迁移：为 research_tasks 添加 ai_prompt 列
        await _migrate_research_ai_prompt()

        # 迁移：为 research_task_submissions 添加 started_at 列
        await _migrate_research_started_at()

        # 迁移：为 scale_templates 添加 activated_at 列
        await _migrate_scale_activated_at()

        # 打印已创建的表
        async with engine.begin() as conn:
            def get_table_names(sync_conn):
                from sqlalchemy import inspect
                return inspect(sync_conn).get_table_names()

            tables = await conn.run_sync(get_table_names)
            logger.info(f"📊 Created tables: {', '.join(tables)}")

    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")
        raise


async def _migrate_student_id():
    """
    幂等迁移：为 users 表添加 student_id 列，email 改为可空。
    每条 DDL 独立事务执行，避免单步失败导致整体回滚。
    """
    from sqlalchemy import text

    async def run_sql(sql: str, label: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
            logger.info(f"  ✅ {label}")
        except Exception as e:
            logger.warning(f"  ⚠️ {label} (skipped): {e}")

    # 1. 添加 student_id 列
    await run_sql(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(50);",
        "ADD COLUMN student_id"
    )

    # 2. 用 email 前缀填充（已有用户）
    await run_sql(
        "UPDATE users SET student_id = split_part(email, '@', 1) WHERE student_id IS NULL AND email IS NOT NULL;",
        "Fill student_id from email prefix"
    )

    # 3. 剩余用 UUID 填充（保证唯一，无截断冲突）
    await run_sql(
        "UPDATE users SET student_id = replace(id::text, '-', '') WHERE student_id IS NULL;",
        "Fill student_id from UUID"
    )

    # 4. 消除邮箱前缀重复（同前缀的后续行追加 UUID 后缀）
    await run_sql(
        """
        DO $$
        DECLARE r RECORD; cnt INT := 1;
        BEGIN
            FOR r IN (
                SELECT id FROM users u
                WHERE (SELECT COUNT(*) FROM users u2 WHERE u2.student_id = u.student_id AND u2.id < u.id) > 0
            ) LOOP
                UPDATE users SET student_id = replace(id::text, '-', '') WHERE id = r.id;
            END LOOP;
        END $$;
        """,
        "Deduplicate student_ids"
    )

    # 5. 创建唯一索引
    await run_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_student_id ON users (student_id);",
        "CREATE UNIQUE INDEX student_id"
    )

    # 6. email 唯一索引（允许多个 NULL）
    await run_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_unique ON users (email) WHERE email IS NOT NULL;",
        "CREATE UNIQUE INDEX email"
    )

    # 7. name 空值补全
    await run_sql(
        "UPDATE users SET name = student_id WHERE name IS NULL;",
        "Fill name from student_id"
    )

    # 8. email 改为可空
    await run_sql(
        "ALTER TABLE users ALTER COLUMN email DROP NOT NULL;",
        "ALTER email DROP NOT NULL"
    )


async def _migrate_scale_started_at():
    """幂等迁移：为 scale_responses 添加 started_at 列"""
    from sqlalchemy import text

    async def run_sql(sql: str, label: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
            logger.info(f"  ✅ {label}")
        except Exception as e:
            logger.warning(f"  ⚠️ {label} (skipped): {e}")

    await run_sql(
        "ALTER TABLE scale_responses ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN started_at to scale_responses"
    )

    # 9. name 设为非空
    await run_sql(
        "ALTER TABLE users ALTER COLUMN name SET NOT NULL;",
        "ALTER name SET NOT NULL"
    )

    logger.info("✅ student_id migration completed")


async def _migrate_research_ai_prompt():
    """幂等迁移：为 research_tasks 添加 ai_prompt 列"""
    from sqlalchemy import text

    async def run_sql(sql: str, label: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
            logger.info(f"  ✅ {label}")
        except Exception as e:
            logger.warning(f"  ⚠️ {label} (skipped): {e}")

    await run_sql(
        "ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS ai_prompt TEXT;",
        "ADD COLUMN ai_prompt to research_tasks"
    )


async def _migrate_research_started_at():
    """幂等迁移：为 research_task_submissions 添加 started_at 列"""
    from sqlalchemy import text

    async def run_sql(sql: str, label: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
            logger.info(f"  ✅ {label}")
        except Exception as e:
            logger.warning(f"  ⚠️ {label} (skipped): {e}")

    await run_sql(
        "ALTER TABLE research_task_submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN started_at to research_task_submissions"
    )


async def _migrate_scale_activated_at():
    """幂等迁移：为 scale_templates 添加 activated_at 列（支持前测/后测轮次判断）"""
    from sqlalchemy import text

    async def run_sql(sql: str, label: str):
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
            logger.info(f"  ✅ {label}")
        except Exception as e:
            logger.warning(f"  ⚠️ {label} (skipped): {e}")

    await run_sql(
        "ALTER TABLE scale_templates ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN activated_at to scale_templates"
    )


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
