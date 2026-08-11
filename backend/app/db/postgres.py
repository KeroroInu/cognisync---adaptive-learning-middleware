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
    settings.database_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
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

        # 迁移：为 research_task_submissions 添加项目解构工作台过程数据
        await _migrate_research_workspace_data()

        # 迁移：为 scale_templates 添加 activated_at 列
        await _migrate_scale_activated_at()

        # 迁移：为 chat_messages 添加 session_id 关联
        await _migrate_chat_message_session_link()

        # 迁移：为 emotion_logs.created_at 添加时间窗口统计索引
        await _migrate_emotion_log_created_index()

        # 迁移：实验班级、实验条件与分组任务
        await _migrate_experiment_groups()

        # 打印已创建的表
        async with engine.begin() as conn:
            def get_table_names(sync_conn):
                from sqlalchemy import inspect
                return inspect(sync_conn).get_table_names()

            tables = await conn.run_sync(get_table_names)
            logger.info(f"📊 Created tables: {', '.join(tables)}")

        # 种子：首次启动自动创建默认管理员（幂等，已存在则跳过）
        if settings.SEED_DEFAULT_ADMIN:
            await _seed_default_admin()
        # 种子：测试学生账号 kero/kero（幂等）
        if settings.SEED_TEST_DATA:
            await _seed_test_student()
        # 种子：默认量表 v1.0（幂等，已存在则跳过）
        await _seed_default_scale()

    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")
        raise


async def _run_migration_sql(sql: str, label: str, critical: bool = True) -> bool:
    """
    执行单条幂等 DDL，独立事务提交，避免单步失败导致整体回滚。

    Args:
        sql: 要执行的 SQL
        label: 日志标签
        critical: 是否为启动所需的迁移。默认为 True，失败时中断启动；
                  只有确认不影响 schema 一致性的可选步骤才应显式传 False。

    关于 critical 的取舍：
    历史实现把所有 DDL 异常都吞成 warning，服务仍继续启动。
    `IF NOT EXISTS` 语句在对象已存在时会正常成功，不需要靠吞异常实现幂等。
    因此当建表、加列、索引或约束真正失败时，默认应拒绝带着不一致
    schema 启动，避免运行期写入脏数据或持续返回 500。

    Returns:
        True 表示执行成功，False 表示失败但被容忍。
    """
    from sqlalchemy import text

    try:
        async with engine.begin() as conn:
            await conn.execute(text(sql))
        logger.info(f"  ✅ {label}")
        return True
    except Exception as e:
        if critical:
            logger.error(f"  ❌ {label} FAILED (critical): {e}")
            raise RuntimeError(
                f"Critical migration step failed: {label}. "
                f"Database schema is inconsistent with the ORM models; refusing to start. "
                f"Original error: {e}"
            ) from e
        logger.warning(f"  ⚠️ {label} (skipped): {e}")
        return False


async def _migrate_student_id():
    """
    幂等迁移：为 users 表添加 student_id 列，email 改为可空。
    每条 DDL 独立事务执行，避免单步失败导致整体回滚。
    """
    run_sql = _run_migration_sql

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

    # 9. name 设为非空
    #    必须紧跟步骤 7（补全 NULL 值）之后执行——若存量数据仍有 NULL，
    #    该语句会失败。此前这两条语句被误放在 _migrate_scale_started_at() 中，
    #    跨函数拆散了顺序依赖，一旦失败会让 DB 与 user.py 的 nullable=False
    #    声明永久不一致，直到运行期某次 INSERT 才暴露。
    await run_sql(
        "ALTER TABLE users ALTER COLUMN name SET NOT NULL;",
        "ALTER name SET NOT NULL",
        critical=True,
    )

    logger.info("✅ student_id migration completed")


async def _migrate_scale_started_at():
    """幂等迁移：为 scale_responses 添加 started_at 列"""
    await _run_migration_sql(
        "ALTER TABLE scale_responses ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN started_at to scale_responses"
    )


async def _migrate_research_ai_prompt():
    """幂等迁移：为 research_tasks 添加 ai_prompt 列"""
    run_sql = _run_migration_sql

    await run_sql(
        "ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS ai_prompt TEXT;",
        "ADD COLUMN ai_prompt to research_tasks"
    )


async def _migrate_research_started_at():
    """幂等迁移：为 research_task_submissions 添加 started_at 列"""
    run_sql = _run_migration_sql

    await run_sql(
        "ALTER TABLE research_task_submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN started_at to research_task_submissions"
    )


async def _migrate_research_workspace_data():
    """幂等迁移：保存项目解构工作台的结构化过程数据。"""
    await _run_migration_sql(
        "ALTER TABLE research_task_submissions "
        "ADD COLUMN IF NOT EXISTS workspace_data JSONB;",
        "ADD COLUMN workspace_data to research_task_submissions"
    )


async def _migrate_scale_activated_at():
    """幂等迁移：为 scale_templates 添加 activated_at 列（支持前测/后测轮次判断）"""
    run_sql = _run_migration_sql

    await run_sql(
        "ALTER TABLE scale_templates ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;",
        "ADD COLUMN activated_at to scale_templates"
    )


async def _migrate_chat_message_session_link():
    """幂等迁移：为 chat_messages 添加 session_id 列与索引"""
    run_sql = _run_migration_sql

    await run_sql(
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS session_id UUID;",
        "ADD COLUMN session_id to chat_messages"
    )

    await run_sql(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'fk_chat_messages_session_id_chat_sessions'
            ) THEN
                ALTER TABLE chat_messages
                ADD CONSTRAINT fk_chat_messages_session_id_chat_sessions
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """,
        "ADD FOREIGN KEY chat_messages.session_id -> chat_sessions.id",
        # 关键：外键缺失会让 chat_messages.session_id 静默产生孤儿引用，
        # 而管理后台的会话详情依赖该关联，失败必须立即暴露。
        critical=True,
    )

    await run_sql(
        "CREATE INDEX IF NOT EXISTS ix_chat_messages_session_timestamp ON chat_messages (session_id, timestamp);",
        "CREATE INDEX chat_messages(session_id, timestamp)"
    )


async def _migrate_emotion_log_created_index():
    """幂等迁移：为 emotion_logs.created_at 添加索引"""
    run_sql = _run_migration_sql

    await run_sql(
        "CREATE INDEX IF NOT EXISTS ix_emotion_logs_created_at ON emotion_logs (created_at);",
        "CREATE INDEX emotion_logs(created_at)"
    )


async def _migrate_experiment_groups():
    """幂等迁移：增加实验班级/条件，并允许研究任务按条件投放。"""
    statements = (
        ("ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(100);", "ADD users.class_name"),
        ("ALTER TABLE users ADD COLUMN IF NOT EXISTS experiment_group VARCHAR(20) NOT NULL DEFAULT 'unassigned';", "ADD users.experiment_group"),
        ("CREATE INDEX IF NOT EXISTS ix_users_class_name ON users (class_name);", "INDEX users.class_name"),
        ("CREATE INDEX IF NOT EXISTS ix_users_experiment_group ON users (experiment_group);", "INDEX users.experiment_group"),
        ("ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS target_group VARCHAR(20) NOT NULL DEFAULT 'all';", "ADD research_tasks.target_group"),
        ("CREATE INDEX IF NOT EXISTS ix_research_tasks_target_group_status ON research_tasks (target_group, status);", "INDEX research task target/status"),
    )
    for sql, label in statements:
        await _run_migration_sql(sql, label)


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
            logger.info("Default admin already exists; credentials were not changed")
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
        logger.info("✅ Default admin created: student_id='%s'", settings.ADMIN_DEFAULT_STUDENT_ID)


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
        existing = result.scalar_one_or_none()
        if existing:
            logger.info("Test student already exists; credentials were not changed")
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
        logger.info("✅ Test student created: student_id='%s'", TEST_STUDENT_ID)


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
