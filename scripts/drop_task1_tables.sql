-- 只删除 Task 1 新增的五张表，用于把旧结构重建为当前结构。
--
-- ⚠️ 这是**破坏性**脚本，必须人工执行，绝不会被应用启动流程调用。
--
-- 适用前提（全部满足才可执行）：
--   1. 已运行 scripts/inspect_task1_schema.sql 并判定为「情况 C：旧结构」；
--   2. 第 6 节显示这五张表的数据可以丢弃（例如本机开发库）；
--   3. 已经做过数据库备份。
--
-- 本脚本**不会**触碰 users / research_tasks / research_task_submissions /
-- chat_sessions / chat_messages / 画像 / 量表 等任何既有业务数据，
-- 也不会删除整个数据库。
--
-- 执行：
--   pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql   # 先备份
--   psql "$DATABASE_URL" -f scripts/drop_task1_tables.sql          # 演练，只报告
--   psql "$DATABASE_URL" -v dry_run=false -f scripts/drop_task1_tables.sql  # 真正执行
--   # 然后重启后端，create_all 会按当前模型重新建表
--
-- ON_ERROR_STOP 保证安全断言失败后立刻中止，不会继续执行 DROP。

\set ON_ERROR_STOP on
\pset pager off

-- 默认演练。命令行 -v dry_run=false 可覆盖本行（psql 的 -v 先于脚本生效时，
-- 下面的 :{?dry_run} 判断会保留命令行传入的值）。
\if :{?dry_run}
\else
\set dry_run true
\endif

\echo '=== 将要删除的表及其真实行数 ==='
DO $$
DECLARE
    names text[] := ARRAY['stage_event_artifacts', 'artifact_versions',
                          'stage_events', 'scaffold_events', 'stage_artifacts'];
    name text;
    amount bigint;
    total bigint := 0;
BEGIN
    FOREACH name IN ARRAY names LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = name
        ) THEN
            EXECUTE format('SELECT count(*) FROM %I', name) INTO amount;
            total := total + amount;
            RAISE NOTICE '  %-24s % 行  (%)', name, amount,
                pg_size_pretty(pg_total_relation_size(format('%I', name)::regclass));
        ELSE
            RAISE NOTICE '  %-24s (表不存在，跳过)', name;
        END IF;
    END LOOP;
    RAISE NOTICE '  ------------------------------------';
    RAISE NOTICE '  合计将丢失 % 行研究证据。', total;
    IF total > 0 THEN
        RAISE NOTICE '  ⚠️ 行数不为 0：确认这些数据确实可以丢弃后再执行。';
    END IF;
END $$;

\echo ''
\echo '=== 安全断言：确认这是 CogniSync 库，且不会误删业务表 ==='
DO $$
DECLARE
    protected text[] := ARRAY[
        'users', 'research_tasks', 'research_task_submissions',
        'chat_sessions', 'chat_messages', 'project_blueprint_versions'
    ];
    name text;
BEGIN
    FOREACH name IN ARRAY protected LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = name
        ) THEN
            RAISE EXCEPTION
                'Aborting: expected business table "%" is missing. '
                'This does not look like a CogniSync database.', name;
        END IF;
    END LOOP;
    RAISE NOTICE '  全部 % 张业务表在位，本脚本不会触碰它们。', array_length(protected, 1);
END $$;

\if :dry_run
\echo ''
\echo '*** 演练模式：未执行任何删除。'
\echo '*** 确认无误后执行：psql "$DATABASE_URL" -v dry_run=false -f scripts/drop_task1_tables.sql'
\else

\echo ''
\echo '=== 执行删除 ==='
BEGIN;

-- stage_artifacts 与 artifact_versions 之间是循环外键，
-- 必须先断开指针列上的那条，再按依赖顺序删除。
ALTER TABLE IF EXISTS stage_artifacts
    DROP CONSTRAINT IF EXISTS fk_stage_artifact_current_version;

DROP TABLE IF EXISTS stage_event_artifacts;
DROP TABLE IF EXISTS scaffold_events;
DROP TABLE IF EXISTS stage_events;
DROP TABLE IF EXISTS artifact_versions;
DROP TABLE IF EXISTS stage_artifacts;

-- 再次确认业务表毫发无损，否则整个事务回滚。
DO $$
DECLARE
    protected text[] := ARRAY[
        'users', 'research_tasks', 'research_task_submissions',
        'chat_sessions', 'chat_messages', 'project_blueprint_versions'
    ];
    name text;
BEGIN
    FOREACH name IN ARRAY protected LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = name
        ) THEN
            RAISE EXCEPTION
                'Aborting and rolling back: business table "%" disappeared.', name;
        END IF;
    END LOOP;
END $$;

COMMIT;

\echo '=== 完成。重启后端后 create_all 会按当前模型重新建表。 ==='
\endif
