-- 人工合并 research_task_submissions 中的重复记录。
--
-- 什么时候需要它：应用启动时迁移主动中止，报
--   'research_task_submissions has N duplicated (task_id, user_id) group(s)'
--
-- 为什么不自动做：重复行可能各自持有不同的 workspace_data、code_submitted、
-- started_at 和已冻结的 blueprint_version_id。「updated_at 最新」不等于
-- 「内容最完整」——自动按时间删除会不可逆地丢掉学生的过程证据，
-- 这与 Task 1 保护研究证据的目标直接冲突。合并必须逐组人工判断。
--
-- **本脚本自身只读**：第 1、2、4 节是查询，第 3 节是需要你手工取消注释并
-- 填入具体 ID 的模板。直接运行本文件不会修改或删除任何一行。
--
-- ⚠️ 执行第 3 节前务必备份：
--   pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql

\set ON_ERROR_STOP on
\pset pager off

\echo '=== 第 1 步：列出所有重复组 ==='
SELECT task_id, user_id, count(*) AS rows
FROM research_task_submissions
GROUP BY task_id, user_id
HAVING count(*) > 1
ORDER BY rows DESC, task_id, user_id;

\echo ''
\echo '=== 第 2 步：逐字段对比每组的差异，判断哪些内容需要保留 ==='
SELECT
    s.id,
    s.task_id,
    s.user_id,
    s.blueprint_version_id,
    s.is_completed,
    s.started_at,
    s.submitted_at,
    s.updated_at,
    length(coalesce(s.code_submitted, ''))            AS code_len,
    jsonb_array_length(
        coalesce(s.workspace_data -> 'functionCards', '[]'::jsonb)
    )                                                  AS function_cards,
    octet_length(coalesce(s.workspace_data::text, '')) AS workspace_bytes
FROM research_task_submissions s
JOIN (
    SELECT task_id, user_id
    FROM research_task_submissions
    GROUP BY task_id, user_id
    HAVING count(*) > 1
) d ON d.task_id = s.task_id AND d.user_id = s.user_id
ORDER BY s.task_id, s.user_id, s.updated_at;

-- ── 第 3 步：人工合并（模板，默认不执行） ──────────────────────────────────
--
-- 对**每一组**重复，根据上面的对比自行决定保留哪一行、以及是否需要把另一行的
-- 字段并入。下面是模板，请逐组替换 <KEEP_ID> / <DROP_ID> 后执行，不要批量套用。
--
-- 合并要点：
--   * blueprint_version_id：保留**最早**冻结的那个，这决定了学生的研究条件；
--     若两行都非空且不同，说明此前发生过版本漂移，必须记录在案再决定。
--   * workspace_data：保留内容更完整的一份（function_cards / workspace_bytes 更大）；
--   * code_submitted：保留更长、更接近学生最终状态的一份；
--   * started_at：取最早值；submitted_at / is_completed：取已提交的那一份。
--
-- 事务内的断言保证：若 KEEP/DROP 不属于同一组，或 DROP 行不存在，整个操作回滚。
--
-- BEGIN;
--
-- DO $$
-- DECLARE
--     keep_id uuid := '<KEEP_ID>';
--     drop_id uuid := '<DROP_ID>';
--     k record;
--     d record;
-- BEGIN
--     SELECT * INTO k FROM research_task_submissions WHERE id = keep_id;
--     SELECT * INTO d FROM research_task_submissions WHERE id = drop_id;
--     IF k IS NULL OR d IS NULL THEN
--         RAISE EXCEPTION 'KEEP 或 DROP 行不存在，已中止。';
--     END IF;
--     IF k.task_id <> d.task_id OR k.user_id <> d.user_id THEN
--         RAISE EXCEPTION
--             'KEEP 与 DROP 不属于同一 (task_id,user_id) 组，已中止。'
--             '这几乎肯定是复制粘贴错误。';
--     END IF;
-- END $$;
--
-- -- 把需要的字段并入保留行（按实际判断增删这几行）：
-- UPDATE research_task_submissions AS keep
-- SET workspace_data       = drop_row.workspace_data,
--     code_submitted       = drop_row.code_submitted,
--     started_at           = LEAST(keep.started_at, drop_row.started_at),
--     blueprint_version_id = COALESCE(keep.blueprint_version_id,
--                                     drop_row.blueprint_version_id)
-- FROM research_task_submissions AS drop_row
-- WHERE keep.id = '<KEEP_ID>'::uuid
--   AND drop_row.id = '<DROP_ID>'::uuid;
--
-- -- 确认无误后再删除多余行：
-- DELETE FROM research_task_submissions WHERE id = '<DROP_ID>'::uuid;
--
-- COMMIT;

\echo ''
\echo '=== 第 4 步：合并完成后复核，应返回 0 行 ==='
SELECT task_id, user_id, count(*)
FROM research_task_submissions
GROUP BY task_id, user_id
HAVING count(*) > 1;

\echo ''
\echo '复核通过后重启后端，迁移会自动补建 uq_research_submission_task_user。'
