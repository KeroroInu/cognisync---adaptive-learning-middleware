-- 只读检查：本库中 Task 1 相关表的存在性与结构版本
--
-- 用途：在任何数据库上部署 Task 1 之前，判断这五张表是「不存在」「已经是
-- 当前结构」还是「上一版的旧结构」。应用启动时的迁移函数只补索引、约束与
-- 外键动作，**不会**给既有表加列或改列名，因此旧结构必须先处理。
--
-- 本脚本不修改任何数据，可以安全地在生产库上运行。
-- 在五表全无、部分存在、全部存在这三种状态下都能干净跑完，不产生
-- "relation does not exist" 错误——所有涉及表内容的查询都先经过存在性判断。
--
--   psql "$DATABASE_URL" -f scripts/inspect_task1_schema.sql
--
-- 判读方式见文件末尾。

\set ON_ERROR_STOP on
\pset pager off

\echo '=== 1. Task 1 相关表是否存在 ==='
SELECT
    expected.table_name,
    (t.table_name IS NOT NULL) AS present
FROM (VALUES
    ('stage_artifacts'),
    ('artifact_versions'),
    ('stage_events'),
    ('stage_event_artifacts'),
    ('scaffold_events')
) AS expected(table_name)
LEFT JOIN information_schema.tables t
       ON t.table_name = expected.table_name
      AND t.table_schema = current_schema()
ORDER BY expected.table_name;

\echo ''
\echo '=== 2. 结构版本判别（当前结构应全部为 true；缺表时也返回 false 而不报错） ==='
SELECT marker, present FROM (VALUES
    ('stage_events.request_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'stage_events' AND column_name = 'request_id')),
    ('stage_events.request_fingerprint',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'stage_events' AND column_name = 'request_fingerprint')),
    ('stage_event_artifacts (table)',
     EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = current_schema()
                AND table_name = 'stage_event_artifacts')),
    ('scaffold_events.student_message_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'scaffold_events' AND column_name = 'student_message_id')),
    ('scaffold_events.delivery_status',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'scaffold_events' AND column_name = 'delivery_status'))
) AS checks(marker, present);

\echo ''
\echo '=== 3. 旧结构残留列（当前结构应全部为 false） ==='
SELECT marker, present FROM (VALUES
    ('stage_events.artifact_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'stage_events' AND column_name = 'artifact_id')),
    ('stage_events.artifact_version_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'stage_events' AND column_name = 'artifact_version_id')),
    ('scaffold_events.message_id',
     EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'scaffold_events' AND column_name = 'message_id'))
) AS checks(marker, present);

\echo ''
\echo '=== 4. 外键删除动作 ==='
\echo '    指向 users / research_tasks / chat_messages 的应为 r (RESTRICT)'
\echo '    a=NO ACTION  r=RESTRICT  c=CASCADE  n=SET NULL  d=SET DEFAULT'
SELECT
    t.relname          AS child_table,
    a.attname          AS child_column,
    pt.relname         AS parent_table,
    c.confdeltype      AS on_delete
FROM pg_constraint c
JOIN pg_class t   ON t.oid = c.conrelid
JOIN pg_class pt  ON pt.oid = c.confrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND n.nspname = current_schema()
  AND t.relname IN ('stage_artifacts', 'artifact_versions', 'stage_events',
                    'stage_event_artifacts', 'scaffold_events')
  AND pt.relname IN ('users', 'research_tasks', 'chat_messages')
ORDER BY child_table, child_column;

\echo ''
\echo '=== 5. 枚举取值是否为小写（应为 decompose / stage_confirm 这类） ==='
-- stage_events 可能不存在，因此用 DO 块动态执行，缺表时只打印提示。
DO $$
DECLARE
    sample text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'stage_events'
    ) THEN
        RAISE NOTICE '  stage_events 不存在，跳过枚举检查。';
        RETURN;
    END IF;

    EXECUTE 'SELECT string_agg(DISTINCT stage::text, '', '' ORDER BY stage::text) FROM stage_events'
       INTO sample;
    RAISE NOTICE '  stage 取值: %', COALESCE(sample, '(无数据)');

    EXECUTE 'SELECT string_agg(DISTINCT event_type::text, '', '' ORDER BY event_type::text) FROM stage_events'
       INTO sample;
    RAISE NOTICE '  event_type 取值: %', COALESCE(sample, '(无数据)');
END $$;

\echo ''
\echo '=== 6. 现有数据量（决定是否可以直接重建） ==='
-- 逐表判断存在性后再统计真实行数，缺表输出 NULL 而不是报错。
DO $$
DECLARE
    names text[] := ARRAY['stage_artifacts', 'artifact_versions', 'stage_events',
                          'stage_event_artifacts', 'scaffold_events'];
    name text;
    amount bigint;
BEGIN
    FOREACH name IN ARRAY names LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = name
        ) THEN
            EXECUTE format('SELECT count(*) FROM %I', name) INTO amount;
            RAISE NOTICE '  %-24s % 行', name, amount;
        ELSE
            RAISE NOTICE '  %-24s (表不存在)', name;
        END IF;
    END LOOP;
END $$;

\echo ''
\echo '=== 7. research_task_submissions 是否存在重复（迁移会因此中止） ==='
SELECT task_id, user_id, count(*) AS duplicates
FROM research_task_submissions
GROUP BY task_id, user_id
HAVING count(*) > 1
ORDER BY duplicates DESC;

\echo ''
\echo '=== 8. 综合判定 ==='
DO $$
DECLARE
    present_count int;
    has_new_marker boolean;
    has_old_marker boolean;
    dup_count int;
BEGIN
    SELECT count(*) INTO present_count
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('stage_artifacts', 'artifact_versions', 'stage_events',
                         'stage_event_artifacts', 'scaffold_events');

    has_new_marker := EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'stage_events' AND column_name = 'request_fingerprint');

    has_old_marker := EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('stage_events', 'scaffold_events')
          AND column_name IN ('artifact_id', 'artifact_version_id', 'message_id'));

    SELECT count(*) INTO dup_count FROM (
        SELECT 1 FROM research_task_submissions
        GROUP BY task_id, user_id HAVING count(*) > 1
    ) d;

    IF present_count = 0 THEN
        RAISE NOTICE '  情况 A：五张表都不存在。直接启动应用，create_all 会按当前模型建表。';
    ELSIF present_count = 5 AND has_new_marker AND NOT has_old_marker THEN
        RAISE NOTICE '  情况 B：已经是当前结构。直接启动。';
    ELSE
        RAISE NOTICE '  情况 C：结构不完整或是旧版（present=%/5, new_marker=%, old_marker=%）。', present_count, has_new_marker, has_old_marker;
        RAISE NOTICE '          若第 6 节行数为 0 或数据确认可丢弃，运行 scripts/drop_task1_tables.sql 后重启；';
        RAISE NOTICE '          若有需要保留的数据，必须先编写显式的旧→新迁移，不要直接删表。';
    END IF;

    IF dup_count > 0 THEN
        RAISE NOTICE '  情况 D：存在 % 组重复 submission，迁移会主动中止。', dup_count;
        RAISE NOTICE '          按 scripts/repair_duplicate_submissions.sql 人工合并后再重试。';
    END IF;
END $$;
