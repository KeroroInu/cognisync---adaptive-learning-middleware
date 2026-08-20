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

        # 迁移：教师项目蓝图版本与学生任务版本冻结
        await _migrate_project_blueprint_links()

        # 迁移：为 scale_templates 添加 activated_at 列
        await _migrate_scale_activated_at()

        # 迁移：为 chat_messages 添加 session_id 关联
        await _migrate_chat_message_session_link()

        # 迁移：为 emotion_logs.created_at 添加时间窗口统计索引
        await _migrate_emotion_log_created_index()

        # 迁移：实验班级、实验条件与分组任务
        await _migrate_experiment_groups()

        # 迁移：阶段产物版本与关键教学事件
        await _migrate_research_process_events()

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


async def _migrate_project_blueprint_links():
    """幂等迁移：关联任务当前蓝图与学生实际使用的蓝图版本。"""

    statements = (
        (
            "ALTER TABLE research_tasks "
            "ADD COLUMN IF NOT EXISTS current_blueprint_version_id UUID;",
            "ADD research_tasks.current_blueprint_version_id",
        ),
        (
            "ALTER TABLE research_task_submissions "
            "ADD COLUMN IF NOT EXISTS blueprint_version_id UUID;",
            "ADD research_task_submissions.blueprint_version_id",
        ),
        (
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_research_tasks_current_blueprint_version'
                ) THEN
                    ALTER TABLE research_tasks
                    ADD CONSTRAINT fk_research_tasks_current_blueprint_version
                    FOREIGN KEY (current_blueprint_version_id)
                    REFERENCES project_blueprint_versions(id)
                    ON DELETE SET NULL;
                END IF;
            END $$;
            """,
            "FK research_tasks.current_blueprint_version_id",
        ),
        (
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'fk_research_submissions_blueprint_version'
                ) THEN
                    ALTER TABLE research_task_submissions
                    ADD CONSTRAINT fk_research_submissions_blueprint_version
                    FOREIGN KEY (blueprint_version_id)
                    REFERENCES project_blueprint_versions(id)
                    ON DELETE SET NULL;
                END IF;
            END $$;
            """,
            "FK research_task_submissions.blueprint_version_id",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_research_tasks_current_blueprint_version_id "
            "ON research_tasks (current_blueprint_version_id);",
            "INDEX research task current blueprint",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_research_task_submissions_blueprint_version_id "
            "ON research_task_submissions (blueprint_version_id);",
            "INDEX research submission blueprint",
        ),
    )
    for sql, label in statements:
        await _run_migration_sql(sql, label)


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


async def _migrate_research_process_events():
    """幂等迁移：阶段产物版本链与关键教学事件。

    ``stage_artifacts`` / ``artifact_versions`` / ``stage_events`` /
    ``stage_event_artifacts`` / ``scaffold_events`` 五张表本身由
    ``Base.metadata.create_all`` 创建（与 ``project_blueprint_versions`` 的引入
    方式一致）。本函数只做 ``create_all`` 无法保证的三件事：

    1. 对既有库补建查询索引——研究导出会按「学生 × 任务 × 时间」和
       「任务 × 事件类型 × 时间」扫描，缺索引会在 40–50 人课堂数据量下
       变成顺序扫描；
    2. 补建事件表的请求幂等唯一约束——同一次交互若因客户端重试写入两条，
       会直接污染「求助次数 / 阶段确认数」这类核心研究指标；
    3. 为 ``research_task_submissions`` 补建 ``(task_id, user_id)`` 唯一约束。
       该表此前只有普通索引，但所有读取路径都用 ``scalar_one_or_none()``，
       并发保存产生的重复行会让后续请求直接抛 ``MultipleResultsFound``。
       补建前**只做只读检测**：发现重复就中止启动并打印诊断，不自动删除任何行
       （重复行可能各自持有不同的工作区、代码与冻结蓝图，合并需要人工判断，
       见 ``scripts/repair_duplicate_submissions.sql``）。

    本函数不执行任何 DROP，也不执行任何删除数据的 DELETE。

    **旧 Task 1 schema 前提**：本函数假定这五张表要么不存在（由 ``create_all``
    按当前模型创建），要么已经是当前结构。它**不是**通用的 schema migration，
    不会给既有表加列、改列名或改写外键动作。已由 Codex 在本机核验：
    ``cognisync_db`` 与 ``cognisync_test`` 中都不存在旧版 Task 1 表，因此无需
    兼容旧结构。若在其他数据库部署且怀疑存在旧版表，先运行
    ``scripts/inspect_task1_schema.sql`` 检查，再决定是重建还是编写显式迁移。

    这些语句在表刚由 create_all 建好时会因对象已存在而正常跳过，
    因此保持默认 critical=True 不会影响正常启动。

    **部署假设**：本迁移在应用启动时执行，假定同一时刻只有一个后端实例在做
    DDL。DO 块虽已限定 schema 与表名，但「检查后再 ALTER」在多实例同时冷启动时
    仍存在竞争窗口（其中一个会因约束已存在而失败）。若部署为多副本同时启动，
    应改用独立的一次性 migration job 或数据库咨询锁，而不是让每个副本竞争 DDL。
    """
    statements = (
        (
            "CREATE INDEX IF NOT EXISTS ix_stage_artifacts_user_task "
            "ON stage_artifacts (user_id, task_id);",
            "INDEX stage_artifacts(user_id, task_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_stage_artifacts_task_stage "
            "ON stage_artifacts (task_id, stage);",
            "INDEX stage_artifacts(task_id, stage)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_artifact_versions_artifact_created "
            "ON artifact_versions (artifact_id, created_at);",
            "INDEX artifact_versions(artifact_id, created_at)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_stage_events_user_task_created "
            "ON stage_events (user_id, task_id, created_at);",
            "INDEX stage_events(user_id, task_id, created_at)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_stage_events_task_type_created "
            "ON stage_events (task_id, event_type, created_at);",
            "INDEX stage_events(task_id, event_type, created_at)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_stage_event_artifacts_artifact "
            "ON stage_event_artifacts (artifact_id);",
            "INDEX stage_event_artifacts(artifact_id)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_scaffold_events_user_task_created "
            "ON scaffold_events (user_id, task_id, created_at);",
            "INDEX scaffold_events(user_id, task_id, created_at)",
        ),
        (
            "CREATE INDEX IF NOT EXISTS ix_scaffold_events_stage_level "
            "ON scaffold_events (stage, applied_level);",
            "INDEX scaffold_events(stage, applied_level)",
        ),
        (
            _constraint_guard(
                table="scaffold_events",
                constraint="uq_scaffold_event_request",
                ddl="ALTER TABLE scaffold_events "
                    "ADD CONSTRAINT uq_scaffold_event_request UNIQUE (user_id, request_id);",
            ),
            "UNIQUE scaffold_events(user_id, request_id)",
        ),
        (
            _constraint_guard(
                table="stage_events",
                constraint="uq_stage_event_request",
                ddl="ALTER TABLE stage_events "
                    "ADD CONSTRAINT uq_stage_event_request UNIQUE (user_id, request_id);",
            ),
            "UNIQUE stage_events(user_id, request_id)",
        ),
        (
            _constraint_guard(
                table="stage_event_artifacts",
                constraint="uq_stage_event_artifact",
                ddl="ALTER TABLE stage_event_artifacts "
                    "ADD CONSTRAINT uq_stage_event_artifact UNIQUE (event_id, artifact_id);",
            ),
            "UNIQUE stage_event_artifacts(event_id, artifact_id)",
        ),
        (
            _constraint_guard(
                table="stage_artifacts",
                constraint="uq_stage_artifact_identity",
                ddl="ALTER TABLE stage_artifacts ADD CONSTRAINT uq_stage_artifact_identity "
                    "UNIQUE (task_id, user_id, artifact_type, artifact_key);",
            ),
            "UNIQUE stage_artifacts identity",
        ),
        (
            _constraint_guard(
                table="artifact_versions",
                constraint="uq_artifact_version_seq",
                ddl="ALTER TABLE artifact_versions "
                    "ADD CONSTRAINT uq_artifact_version_seq UNIQUE (artifact_id, version);",
            ),
            "UNIQUE artifact_versions(artifact_id, version)",
        ),
        # 加唯一约束前只做**只读检测**，绝不自动删行。
        #
        # 重复的提交记录可能分别持有不同的 workspace、代码、开始时间和已冻结
        # 蓝图版本。「updated_at 最新」并不等于「数据最完整、最可信」——按它
        # 自动删除会让研究过程证据不可逆地丢失，与本任务保护证据的目标相反。
        # 因此这里让启动失败并给出可执行的诊断，由人工合并后再重试。
        (
            """
            DO $$
            DECLARE
                dup_count integer;
            BEGIN
                SELECT count(*) INTO dup_count FROM (
                    SELECT task_id, user_id
                    FROM research_task_submissions
                    GROUP BY task_id, user_id
                    HAVING count(*) > 1
                ) AS duplicates;

                IF dup_count > 0 THEN
                    RAISE EXCEPTION
                        'research_task_submissions has % duplicated (task_id, user_id) group(s). '
                        'Refusing to add the unique constraint automatically because merging '
                        'requires human judgement: duplicated rows may hold different workspace '
                        'snapshots, code and frozen blueprint versions. '
                        'Inspect with: SELECT task_id, user_id, count(*) '
                        'FROM research_task_submissions GROUP BY 1,2 HAVING count(*) > 1; '
                        'then merge manually (see scripts/repair_duplicate_submissions.sql).',
                        dup_count;
                END IF;
            END $$;
            """,
            "Detect duplicate research_task_submissions (read-only)",
        ),
        (
            _constraint_guard(
                table="research_task_submissions",
                constraint="uq_research_submission_task_user",
                ddl="ALTER TABLE research_task_submissions "
                    "ADD CONSTRAINT uq_research_submission_task_user UNIQUE (task_id, user_id);",
            ),
            "UNIQUE research_task_submissions(task_id, user_id)",
        ),
        # 把支架事件指向聊天消息的外键从 SET NULL 升级为 RESTRICT。
        #
        # 应用层的「先 count 再 delete」有竞态：检查通过之后、删除发生之前
        # 仍可插入新的支架事件，最终原文引用照样被置空；其他删除路径
        # （直接 SQL、未来新增的端点）也绕得过 API 检查。保护必须落在约束上。
        #
        # 这段只改约束动作，不删除任何聊天或支架数据。
        (
            _fk_action_guard(
                table="scaffold_events",
                column="student_message_id",
                target="chat_messages",
                constraint="fk_scaffold_event_student_message",
            ),
            "RESTRICT scaffold_events.student_message_id",
        ),
        (
            _fk_action_guard(
                table="scaffold_events",
                column="assistant_message_id",
                target="chat_messages",
                constraint="fk_scaffold_event_assistant_message",
            ),
            "RESTRICT scaffold_events.assistant_message_id",
        ),
    )
    for sql, label in statements:
        await _run_migration_sql(sql, label)


def _fk_action_guard(
    table: str,
    column: str,
    target: str,
    constraint: str,
) -> str:
    """生成「把某列的外键删除动作改成 RESTRICT」的幂等 DO 块。

    ``create_all`` 只在表不存在时按当前模型建约束；已经建成 ``SET NULL`` 的
    既有库不会被自动改写。这里先查出该列上实际存在的外键（不依赖约束名，
    因为 SQLAlchemy 的自动命名与手写名可能不同），若其 ``confdeltype`` 不是
    ``'r'``（RESTRICT）就重建。

    只操作约束，不触碰任何行数据。
    """
    return f"""
        DO $$
        DECLARE
            existing_name text;
            existing_action "char";
        BEGIN
            SELECT c.conname, c.confdeltype
              INTO existing_name, existing_action
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a
              ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
            WHERE c.contype = 'f'
              AND n.nspname = current_schema()
              AND t.relname = '{table}'
              AND a.attname = '{column}'
              AND array_length(c.conkey, 1) = 1
            LIMIT 1;

            IF existing_name IS NULL THEN
                -- 表或列尚不存在（首次由 create_all 建表时即为 RESTRICT），无需处理。
                RETURN;
            END IF;

            IF existing_action = 'r' THEN
                RETURN;  -- 已经是 RESTRICT
            END IF;

            EXECUTE format(
                'ALTER TABLE {table} DROP CONSTRAINT %I', existing_name
            );
            EXECUTE
                'ALTER TABLE {table} ADD CONSTRAINT {constraint} '
                'FOREIGN KEY ({column}) REFERENCES {target}(id) ON DELETE RESTRICT';
        END $$;
    """


def _constraint_guard(table: str, constraint: str, ddl: str) -> str:
    """生成「约束不存在才创建」的幂等 DO 块。

    必须同时限定 schema 与表名：只按 ``pg_constraint.conname`` 判断时，
    其他 schema 或其他表上的同名约束会让本表误判为「已经存在」而静默跳过，
    导致约束实际缺失但迁移显示成功。
    """
    return f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE c.conname = '{constraint}'
                  AND t.relname = '{table}'
                  AND n.nspname = current_schema()
            ) THEN
                {ddl}
            END IF;
        END $$;
    """


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
