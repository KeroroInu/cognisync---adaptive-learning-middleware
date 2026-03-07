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

        # 种子：首次启动自动创建默认管理员（幂等，已存在则跳过）
        await _seed_default_admin()
        # 种子：测试学生账号 kero/kero（幂等）
        await _seed_test_student()
        # 种子：默认量表 v1.0（幂等，已存在则跳过）
        await _seed_default_scale()

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


async def _seed_default_admin():
    """
    幂等种子：若不存在任何管理员账号，则按配置创建默认管理员。
    每次启动时执行，已存在则静默跳过。
    """
    from app.core.config import settings
    from app.models.sql.user import User
    from sqlalchemy import select
    import uuid as _uuid
    import bcrypt

    if not settings.ADMIN_DEFAULT_STUDENT_ID or not settings.ADMIN_DEFAULT_PASSWORD:
        return

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.student_id == settings.ADMIN_DEFAULT_STUDENT_ID)
        )
        existing = result.scalar_one_or_none()

        if existing:
            if existing.role != "admin":
                existing.role = "admin"
                await session.commit()
                logger.info(f"✅ Promoted existing user '{settings.ADMIN_DEFAULT_STUDENT_ID}' to admin")
            else:
                logger.info(f"✅ Default admin '{settings.ADMIN_DEFAULT_STUDENT_ID}' already exists, skipping")
            return

        pw_hash = bcrypt.hashpw(
            settings.ADMIN_DEFAULT_PASSWORD.encode("utf-8"),
            bcrypt.gensalt()
        ).decode("utf-8")

        admin_user = User(
            id=_uuid.uuid4(),
            student_id=settings.ADMIN_DEFAULT_STUDENT_ID,
            name=settings.ADMIN_DEFAULT_NAME,
            role="admin",
            is_active=True,
            has_completed_onboarding=True,
            password_hash=pw_hash,
        )
        session.add(admin_user)
        await session.commit()
        logger.info(
            f"✅ Default admin created: student_id='{settings.ADMIN_DEFAULT_STUDENT_ID}' "
            f"password='{settings.ADMIN_DEFAULT_PASSWORD}'"
        )


async def _seed_test_student():
    """
    幂等种子：创建测试学生账号 student_id='kero' password='kero'。
    用于部署后快速验证用户端功能，生产环境可手动删除。
    """
    from app.models.sql.user import User
    from sqlalchemy import select
    import uuid as _uuid
    import bcrypt

    TEST_STUDENT_ID = "kero"
    TEST_PASSWORD = "kero"
    TEST_NAME = "测试学生"

    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.student_id == TEST_STUDENT_ID)
        )
        if result.scalar_one_or_none():
            logger.info(f"✅ Test student '{TEST_STUDENT_ID}' already exists, skipping")
            return

        pw_hash = bcrypt.hashpw(
            TEST_PASSWORD.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

        student = User(
            id=_uuid.uuid4(),
            student_id=TEST_STUDENT_ID,
            name=TEST_NAME,
            role="student",
            is_active=True,
            has_completed_onboarding=False,
            password_hash=pw_hash,
        )
        session.add(student)
        await session.commit()
        logger.info(f"✅ Test student created: student_id='{TEST_STUDENT_ID}' password='{TEST_PASSWORD}'")


async def _seed_default_scale():
    """
    幂等种子：若不存在名为 'AI 教育研究量表 v1.0' 的模板，则创建并激活它。
    每次启动时执行，已存在则静默跳过。
    """
    import uuid as _uuid
    import json
    from datetime import datetime, UTC
    from sqlalchemy import text

    TEMPLATE_NAME = "AI 教育研究量表 v1.0"

    schema_json = {
        "description": "AI 教育研究前/后测问卷（计算思维 · 自我效能感 · 学习动机 · 复杂问题解决 · 编程能力 · AI 素养）",
        "questions": [
            {"id": "ct1",  "text": "遇到问题时，我喜欢尝试不同或有创意的解决方式。",                     "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct2",  "text": "面对任务时，我会将大问题拆成若干小步骤。",                           "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct3",  "text": "写代码前，我通常会先理清逻辑或流程。",                               "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct4",  "text": "看到一段代码时，我能大致判断其功能。",                               "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct5",  "text": "遇到困难时，我愿意与同伴合作解决问题。",                             "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct6",  "text": "面对 AI 或他人提供的代码，我会先判断是否合理。",                     "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "ct7",  "text": "程序运行失败时，我会逐步排查错误原因。",                             "dimension": "CT",  "type": "likert5", "reverse_scored": False},
            {"id": "se1",  "text": "我相信自己能够在本课程中取得好成绩。",                               "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "se2",  "text": "即使很难，我也有信心理解课程中的内容。",                             "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "se3",  "text": "我确信自己能理解课程的关键概念。",                                   "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "se4",  "text": "我能在作业和测验中表现良好。",                                       "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "se5",  "text": "我觉得自己能够掌握本课程教授的技能。",                               "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "se6",  "text": "我相信只要努力我可以学好本课程。",                                   "dimension": "SE",  "type": "likert5", "reverse_scored": False},
            {"id": "lm1",  "text": "我喜欢具有挑战性的学习内容。",                                       "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "lm2",  "text": "即使内容困难，只要能激发好奇心我也愿意学。",                         "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "lm3",  "text": "比起得高分，我更看重是否学到东西。",                                 "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "lm4",  "text": "在本课程中取得好成绩对我很重要。",                                   "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "lm5",  "text": "我希望自己的表现优于多数同学。",                                     "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "lm6",  "text": "我希望通过本课程的表现展示自己的能力。",                             "dimension": "LM",  "type": "likert5", "reverse_scored": False},
            {"id": "cps1", "text": "面对复杂问题时，我会先分析问题的真正原因。",                         "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps2", "text": "当一种方法失败时，我会思考失败的原因。",                             "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps3", "text": "遇到难题时，我通常能想到多种解决方案。",                             "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps4", "text": "面对复杂问题时，我会制定分步骤的计划。",                             "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps5", "text": "遇到问题时，我有时会不加思考直接执行。",                             "dimension": "CPS", "type": "likert5", "reverse_scored": True},
            {"id": "cps6", "text": "我愿意查资料或请教他人来解决问题。",                                 "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps7", "text": "连续失败时，我仍然相信自己能找到解决方案。",                         "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "cps8", "text": "解决问题后，我会回顾哪些做法有效。",                                 "dimension": "CPS", "type": "likert5", "reverse_scored": False},
            {"id": "pa1",  "text": "我能独立实现课程项目要求的主要功能。",                               "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "pa2",  "text": "我写的代码结构清晰、容易理解。",                                     "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "pa3",  "text": "遇到错误时，我能通过调试定位问题。",                                 "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "pa4",  "text": "我能把课堂上学到的知识运用到新的任务中。",                           "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "pa5",  "text": "与 AI 协作时，我能判断哪些建议适合任务。",                           "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "pa6",  "text": "我能够清楚解释我的程序是如何工作的。",                               "dimension": "PA",  "type": "likert5", "reverse_scored": False},
            {"id": "ail1", "text": "我大致了解常见 AI 技术（如大模型、图像识别）的工作方式。",           "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail2", "text": "我能举出 AI 在生活或学习中的应用实例。",                             "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail3", "text": "我知道如何向 AI 清晰表达需求。",                                     "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail4", "text": "当 AI 的回答可能有误时，我会进行查证或比对。",                       "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail5", "text": "我意识到 AI 输出中可能存在偏见或不公平。",                           "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail6", "text": "处理敏感信息时，我会谨慎输入 AI。",                                   "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail7", "text": "我能区分哪些内容是我完成的、哪些是 AI 生成的。",                     "dimension": "AIL", "type": "likert5", "reverse_scored": False},
            {"id": "ail8", "text": "我认为自己具备基本且负责任的 AI 使用能力。",                         "dimension": "AIL", "type": "likert5", "reverse_scored": False},
        ],
        "likert_scale": {
            "min": 1, "max": 5,
            "labels": {"1": "非常不同意", "2": "不同意", "3": "一般", "4": "同意", "5": "非常同意"}
        }
    }
    scoring_json = {
        "method": "dimension_average",
        "dimensions": ["CT", "SE", "LM", "CPS", "PA", "AIL"],
        "mapping": {
            "CT":  ["ct1","ct2","ct3","ct4","ct5","ct6","ct7"],
            "SE":  ["se1","se2","se3","se4","se5","se6"],
            "LM":  ["lm1","lm2","lm3","lm4","lm5","lm6"],
            "CPS": ["cps1","cps2","cps3","cps4","cps5","cps6","cps7","cps8"],
            "PA":  ["pa1","pa2","pa3","pa4","pa5","pa6"],
            "AIL": ["ail1","ail2","ail3","ail4","ail5","ail6","ail7","ail8"],
        },
        "reverse_items": ["cps5"],
        "score_range": [0, 100]
    }
    mapping_json = {
        "cognition": {"source_dimensions": ["CT","CPS","AIL"], "weights": [0.35, 0.35, 0.30]},
        "affect":    {"source_dimensions": ["SE","LM"],        "weights": [0.50, 0.50]},
        "behavior":  {"source_dimensions": ["PA"],             "weights": [1.0]},
    }

    now = datetime.now(UTC)
    async with engine.begin() as conn:
        result = await conn.execute(
            text("SELECT id FROM scale_templates WHERE name = :name LIMIT 1"),
            {"name": TEMPLATE_NAME}
        )
        if result.fetchone():
            logger.info(f"✅ Default scale '{TEMPLATE_NAME}' already exists, skipping")
            return

        await conn.execute(
            text("""
                INSERT INTO scale_templates
                    (id, name, version, status, schema_json, scoring_json, mapping_json, created_at, updated_at, activated_at)
                VALUES
                    (:id, :name, 1, 'ACTIVE',
                     CAST(:schema_json AS jsonb),
                     CAST(:scoring_json AS jsonb),
                     CAST(:mapping_json AS jsonb),
                     :now, :now, :now)
            """),
            {
                "id": _uuid.uuid4(),
                "name": TEMPLATE_NAME,
                "schema_json": json.dumps(schema_json, ensure_ascii=False),
                "scoring_json": json.dumps(scoring_json, ensure_ascii=False),
                "mapping_json": json.dumps(mapping_json, ensure_ascii=False),
                "now": now,
            }
        )
    logger.info(f"✅ Default scale created: '{TEMPLATE_NAME}' (42 questions, ACTIVE)")
