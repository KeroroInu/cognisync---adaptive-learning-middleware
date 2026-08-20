#!/usr/bin/env bash
# Task 1 数据库脚本的可重复验收。
#
# 三个 SQL 脚本必须在真实 PostgreSQL 的多种 schema 状态下都干净运行——
# 「在我的库上没报错」不构成证据，因为开发库通常只处于其中一种状态。
#
# 本脚本在一个**一次性**数据库上依次构造四种状态并逐一验证：
#
#   1. 五表全无            → inspect 干净跑完，判定为情况 A
#   2. 五表完整且无数据    → inspect 判定为情况 B；drop 演练不删任何东西
#   3. 存在重复 submission → inspect 判定出情况 D；repair 只读、不改数据
#   4. 安全断言失败        → drop 中止，后续 DROP 不执行（ON_ERROR_STOP 生效）
#
# 用法：
#   export ADMIN_DATABASE_URL='postgresql://user:pass@localhost:5432/postgres'
#   ./scripts/verify_task1_scripts.sh
#
# 会创建并在结束时删除数据库 cognisync_script_check。
# 不会触碰 cognisync_db 或 cognisync_test。

set -euo pipefail

ADMIN_URL="${ADMIN_DATABASE_URL:-postgresql://cognisync:cognisync_dev_password_2024@localhost:5432/postgres}"
CHECK_DB="cognisync_script_check"
BASE_URL="${ADMIN_URL%/*}"
CHECK_URL="${BASE_URL}/${CHECK_DB}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass=0
fail=0

ok()   { echo "  ✔ $1"; pass=$((pass+1)); }
bad()  { echo "  ✘ $1"; fail=$((fail+1)); }

cleanup() {
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${CHECK_DB}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "在一次性数据库 ${CHECK_DB} 上验收，结束后自动删除。"
cleanup
psql "$ADMIN_URL" -q -c "CREATE DATABASE ${CHECK_DB}"

# ── 业务表骨架：安全断言依赖它们存在 ─────────────────────────────────────────
psql "$CHECK_URL" -q <<'SQL'
CREATE TABLE users                     (id uuid PRIMARY KEY);
CREATE TABLE research_tasks            (id uuid PRIMARY KEY);
CREATE TABLE chat_sessions             (id uuid PRIMARY KEY);
CREATE TABLE chat_messages             (id uuid PRIMARY KEY);
CREATE TABLE project_blueprint_versions(id uuid PRIMARY KEY);
CREATE TABLE research_task_submissions (
    id uuid PRIMARY KEY,
    task_id uuid,
    user_id uuid,
    code_submitted text,
    workspace_data jsonb,
    blueprint_version_id uuid,
    is_completed boolean,
    started_at timestamptz,
    submitted_at timestamptz,
    updated_at timestamptz
);
SQL

echo
echo "── 状态 1：五表全无 ──────────────────────────────────────────────"
if out=$(psql "$CHECK_URL" -f "$SCRIPT_DIR/inspect_task1_schema.sql" 2>&1); then
    ok "inspect 退出码 0"
else
    bad "inspect 退出码非 0"; echo "$out" | tail -5
fi
grep -q "does not exist" <<<"$out" && bad "inspect 输出含 'does not exist'" || ok "inspect 无缺表报错"
grep -q "情况 A" <<<"$out" && ok "判定为情况 A" || bad "未判定为情况 A"

echo
echo "── 状态 2：五表完整且无数据 ──────────────────────────────────────"
psql "$CHECK_URL" -q <<'SQL'
CREATE TABLE stage_artifacts (
    id uuid PRIMARY KEY, task_id uuid REFERENCES research_tasks(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT, current_version_id uuid);
CREATE TABLE artifact_versions (
    id uuid PRIMARY KEY,
    artifact_id uuid REFERENCES stage_artifacts(id) ON DELETE CASCADE, version int);
ALTER TABLE stage_artifacts ADD CONSTRAINT fk_stage_artifact_current_version
    FOREIGN KEY (current_version_id) REFERENCES artifact_versions(id) ON DELETE SET NULL;
CREATE TABLE stage_events (
    id uuid PRIMARY KEY, task_id uuid REFERENCES research_tasks(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    request_id text, request_fingerprint text, stage text, event_type text);
CREATE TABLE stage_event_artifacts (
    id uuid PRIMARY KEY, event_id uuid REFERENCES stage_events(id) ON DELETE CASCADE,
    artifact_id uuid REFERENCES stage_artifacts(id) ON DELETE RESTRICT);
CREATE TABLE scaffold_events (
    id uuid PRIMARY KEY, task_id uuid REFERENCES research_tasks(id) ON DELETE RESTRICT,
    user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    student_message_id uuid REFERENCES chat_messages(id) ON DELETE RESTRICT,
    assistant_message_id uuid REFERENCES chat_messages(id) ON DELETE RESTRICT,
    delivery_status text);
SQL

out=$(psql "$CHECK_URL" -f "$SCRIPT_DIR/inspect_task1_schema.sql" 2>&1) \
    && ok "inspect 退出码 0" || bad "inspect 退出码非 0"
grep -q "情况 B" <<<"$out" && ok "判定为情况 B" || { bad "未判定为情况 B"; echo "$out" | tail -8; }

out=$(psql "$CHECK_URL" -f "$SCRIPT_DIR/drop_task1_tables.sql" 2>&1) \
    && ok "drop 演练退出码 0" || bad "drop 演练退出码非 0"
grep -q "演练模式" <<<"$out" && ok "drop 默认演练" || bad "drop 未进入演练模式"
remaining=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
    ('stage_artifacts','artifact_versions','stage_events','stage_event_artifacts','scaffold_events')")
[ "$remaining" = "5" ] && ok "演练未删除任何表（仍有 5 张）" || bad "演练删掉了表，只剩 $remaining 张"

echo
echo "── 状态 3：存在重复 submission ───────────────────────────────────"
psql "$CHECK_URL" -q <<'SQL'
INSERT INTO users (id) VALUES ('11111111-1111-1111-1111-111111111111');
INSERT INTO research_tasks (id) VALUES ('22222222-2222-2222-2222-222222222222');
INSERT INTO research_task_submissions (id, task_id, user_id, code_submitted, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'first',  now() - interval '1 hour'),
       ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'second', now());
SQL

out=$(psql "$CHECK_URL" -f "$SCRIPT_DIR/inspect_task1_schema.sql" 2>&1)
grep -q "情况 D" <<<"$out" && ok "inspect 判定出情况 D" || bad "inspect 未报出重复"

before=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM research_task_submissions")
out=$(psql "$CHECK_URL" -f "$SCRIPT_DIR/repair_duplicate_submissions.sql" 2>&1) \
    && ok "repair 退出码 0" || bad "repair 退出码非 0"
after=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM research_task_submissions")
[ "$before" = "$after" ] && ok "repair 只读，未改动数据（$before 行不变）" \
    || bad "repair 改动了数据：$before → $after"

echo
echo "── 状态 4：安全断言失败时不得继续 DROP ───────────────────────────"
psql "$CHECK_URL" -q -c "ALTER TABLE chat_messages RENAME TO chat_messages_moved"
set +e
out=$(psql "$CHECK_URL" -v dry_run=false -f "$SCRIPT_DIR/drop_task1_tables.sql" 2>&1)
code=$?
set -e
[ "$code" -ne 0 ] && ok "drop 因断言失败而中止（退出码 $code）" || bad "drop 未中止，退出码 0"
grep -q "does not look like a CogniSync database" <<<"$out" \
    && ok "给出明确诊断" || bad "缺少诊断信息"
remaining=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
    ('stage_artifacts','artifact_versions','stage_events','stage_event_artifacts','scaffold_events')")
[ "$remaining" = "5" ] && ok "断言失败后 5 张表原封未动（ON_ERROR_STOP 生效）" \
    || bad "断言失败后仍删掉了表，只剩 $remaining 张"

echo
echo "── 补充：断言通过时确实能删 ──────────────────────────────────────"
psql "$CHECK_URL" -q -c "ALTER TABLE chat_messages_moved RENAME TO chat_messages"
psql "$CHECK_URL" -v dry_run=false -f "$SCRIPT_DIR/drop_task1_tables.sql" >/dev/null 2>&1 \
    && ok "drop 真实执行退出码 0" || bad "drop 真实执行失败"
remaining=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
    ('stage_artifacts','artifact_versions','stage_events','stage_event_artifacts','scaffold_events')")
[ "$remaining" = "0" ] && ok "五张表已删除" || bad "仍剩 $remaining 张表"
business=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
    ('users','research_tasks','research_task_submissions','chat_sessions','chat_messages','project_blueprint_versions')")
[ "$business" = "6" ] && ok "6 张业务表毫发无损" || bad "业务表被误删，只剩 $business 张"
rows=$(psql "$CHECK_URL" -tAc "SELECT count(*) FROM research_task_submissions")
[ "$rows" = "2" ] && ok "业务数据未丢失（$rows 行）" || bad "业务数据丢失，只剩 $rows 行"

echo
echo "════════════════════════════════════════"
echo "通过 $pass 项，失败 $fail 项"
[ "$fail" -eq 0 ] || exit 1
