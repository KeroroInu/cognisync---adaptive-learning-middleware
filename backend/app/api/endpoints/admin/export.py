"""
Admin 数据导出 API 端点
"""
import csv
import io
import json
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.core.security import verify_admin_key
from app.db.postgres import get_db
from app.services.research_package import csv_cell

router = APIRouter(tags=["Admin - Data Export"])

def _make_csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    """将 rows 转成 CSV StreamingResponse"""
    if not rows:
        output = io.StringIO()
        output.write("")
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(dict.fromkeys(key for row in rows for key in row)))
    writer.writeheader()
    writer.writerows({key: csv_cell(value) for key, value in row.items()} for row in rows)
    output.seek(0)
    return StreamingResponse(
        iter(["\ufeff" + output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/export/csv/learner-profiles", dependencies=[Depends(verify_admin_key)])
async def export_learner_profiles(
    db: AsyncSession = Depends(get_db),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户 UUID，不传则导出全部"),
):
    """
    导出学习者画像综合数据集（CSV）

    社科研究维度：
    - 学习者基础信息（匿名 ID、注册时间）
    - 初始量表得分（认知/情感/行为三维度）
    - 最新画像得分及变化次数
    - 对话参与行为指标（会话数、消息数）
    """
    uid_list = [u.strip() for u in user_ids.split(",") if u.strip()] if user_ids else None
    where_clause = "WHERE u.id = ANY(:user_ids::uuid[])" if uid_list else ""
    sql = text(f"""
        SELECT
            u.id                                                AS user_id,
            u.student_id                                        AS student_id,
            u.name                                              AS name,
            u.email                                             AS email,
            u.created_at                                        AS registered_at,
            u.is_active                                         AS is_active,
            first_ps.cognition                                  AS initial_cognition,
            first_ps.affect                                     AS initial_affect,
            first_ps.behavior                                   AS initial_behavior,
            first_ps.created_at                                 AS initial_profile_at,
            last_ps.cognition                                   AS current_cognition,
            last_ps.affect                                      AS current_affect,
            last_ps.behavior                                    AS current_behavior,
            last_ps.created_at                                  AS last_profile_update,
            COALESCE(ps_count.total, 0)                         AS profile_update_count,
            COALESCE(sess_count.total, 0)                       AS total_sessions,
            COALESCE(msg_count.total, 0)                        AS total_messages,
            COALESCE(sr_count.total, 0)                         AS scale_completions
        FROM users u
        LEFT JOIN LATERAL (
            SELECT cognition, affect, behavior, created_at
            FROM profile_snapshots WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1
        ) first_ps ON TRUE
        LEFT JOIN LATERAL (
            SELECT cognition, affect, behavior, created_at
            FROM profile_snapshots WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
        ) last_ps ON TRUE
        LEFT JOIN (SELECT user_id, COUNT(*) AS total FROM profile_snapshots GROUP BY user_id) ps_count ON ps_count.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) AS total FROM chat_sessions GROUP BY user_id) sess_count ON sess_count.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) AS total FROM chat_messages GROUP BY user_id) msg_count ON msg_count.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) AS total FROM scale_responses GROUP BY user_id) sr_count ON sr_count.user_id = u.id
        {where_clause}
        ORDER BY u.created_at DESC
    """)
    result = await db.execute(sql, {"user_ids": uid_list} if uid_list else {})
    rows = [dict(r._mapping) for r in result]
    # 序列化
    for row in rows:
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"learner_profiles_{date_str}.csv")


@router.get("/export/csv/scale-responses", dependencies=[Depends(verify_admin_key)])
async def export_scale_responses(
    db: AsyncSession = Depends(get_db),
    user_ids: Optional[str] = Query(None, description="逗号分隔的用户 UUID，不传则导出全部"),
):
    """
    导出量表响应数据集（CSV）

    社科研究维度：
    - 用户-量表匹配信息
    - 各题原始得分（item_1 ~ item_N）
    - 三维度汇总得分（认知/情感/行为）
    - 填写时间（可用于分析量表完成时机）
    """
    uid_list = [u.strip() for u in user_ids.split(",") if u.strip()] if user_ids else None
    where_clause = "WHERE u.id = ANY(:user_ids::uuid[])" if uid_list else ""
    sql = text(f"""
        SELECT
            sr.id                               AS response_id,
            u.id                                AS user_id,
            u.student_id                        AS student_id,
            u.name                              AS user_name,
            u.email                             AS user_email,
            st.name                             AS scale_name,
            st.id                               AS template_id,
            sr.started_at                       AS started_at,
            sr.created_at                       AS responded_at,
            sr.answers_json                     AS raw_answers,
            (sr.scores_json->>'cognition')::float   AS cognition_score,
            (sr.scores_json->>'affect')::float      AS affect_score,
            (sr.scores_json->>'behavior')::float    AS behavior_score,
            (sr.scores_json->>'total_score')::float AS total_score,
            (sr.scores_json->>'max_score')::float   AS max_score
        FROM scale_responses sr
        JOIN users u ON u.id = sr.user_id
        JOIN scale_templates st ON st.id = sr.template_id
        {where_clause}
        ORDER BY sr.created_at DESC
    """)
    result = await db.execute(sql, {"user_ids": uid_list} if uid_list else {})
    rows = []
    for r in result:
        row = dict(r._mapping)
        # 展开各题得分到独立列
        raw = row.pop("raw_answers", {}) or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}
        for item_key, item_val in sorted(raw.items()):
            row[item_key] = item_val
        # 计算所用时间（秒）
        started = row.get("started_at")
        responded = row.get("responded_at")
        if isinstance(started, datetime) and isinstance(responded, datetime):
            diff = (responded - started).total_seconds()
            row["time_spent_seconds"] = int(diff) if diff >= 0 else ""
        else:
            row["time_spent_seconds"] = ""
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"scale_responses_{date_str}.csv")


@router.get("/export/csv/conversations", dependencies=[Depends(verify_admin_key)])
async def export_conversations(db: AsyncSession = Depends(get_db)):
    """
    导出对话行为数据集（CSV）

    社科研究维度：
    - 消息级别数据（用户ID、角色、时间）
    - 消息长度（字符数，反映学习者参与深度）
    - AI 分析结果中的提取概念（反映知识领域分布）
    - 时段分布（小时）用于学习行为时间分析
    - 项目支架阶段、L0-L3、触发方式、画像快照与代码/测试上下文
    """
    sql = text("""
        SELECT
            cm.id                               AS message_id,
            u.id                                AS user_id,
            u.student_id                        AS student_id,
            u.name                              AS user_name,
            u.email                             AS user_email,
            cm.role                             AS role,
            cm.timestamp                        AS message_time,
            EXTRACT(HOUR FROM cm.timestamp)::int AS hour_of_day,
            EXTRACT(DOW FROM cm.timestamp)::int  AS day_of_week,
            LENGTH(cm.text)                     AS message_length_chars,
            cm.text                             AS message_text,
            cm.analysis->>'detectedConcepts'    AS extracted_concepts_raw,
            COALESCE(jsonb_array_length(cm.analysis->'detectedConcepts'), 0) AS concept_count,
            cm.analysis->'scaffoldContext'->>'requestId'          AS scaffold_request_id,
            cm.analysis->'scaffoldContext'->>'taskId'             AS scaffold_task_id,
            cm.analysis->'scaffoldContext'->>'stage'              AS scaffold_stage,
            cm.analysis->'scaffoldContext'->>'requestedLevel'     AS scaffold_requested_level,
            cm.analysis->'scaffoldContext'->>'level'              AS scaffold_level,
            cm.analysis->'scaffoldContext'->>'levelLabel'         AS scaffold_level_label,
            cm.analysis->'scaffoldContext'->>'trigger'            AS scaffold_trigger,
            cm.analysis->'scaffoldContext'->>'blueprintVersionId' AS scaffold_blueprint_version_id,
            cm.analysis->'scaffoldContext'->>'policySource'       AS scaffold_policy_source,
            cm.analysis->'scaffoldContext'->>'policyGoal'         AS scaffold_policy_goal,
            cm.analysis->'scaffoldContext'->>'policyAllowedHelp'  AS scaffold_policy_allowed_help,
            cm.analysis->'scaffoldContext'->>'policyMaxCodeLines' AS scaffold_policy_max_code_lines,
            cm.analysis->'scaffoldContext'->>'policyWasClamped'   AS scaffold_policy_was_clamped,
            cm.analysis->'scaffoldContext'->>'requireAttemptBeforeUpgrade' AS scaffold_require_attempt,
            cm.analysis->'scaffoldContext'->>'artifactSummary'    AS scaffold_artifact_summary,
            cm.analysis->'scaffoldContext'->>'currentModule'      AS scaffold_current_module,
            cm.analysis->'scaffoldContext'->>'testFeedback'       AS scaffold_test_feedback,
            cm.analysis->'scaffoldContext'->>'codeLength'         AS scaffold_code_length,
            cm.analysis->'scaffoldContext'->>'codeFingerprint'    AS scaffold_code_fingerprint,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'cognition' AS scaffold_profile_cognition,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'affect'    AS scaffold_profile_affect,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'behavior'  AS scaffold_profile_behavior,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'cognitionBand' AS scaffold_cognition_band,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'affectBand'    AS scaffold_affect_band,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'behaviorBand'  AS scaffold_behavior_band,
            cm.analysis->'scaffoldContext'->'learnerSupport'->>'contextVersion' AS learner_support_version,
            cm.analysis->'scaffoldContext'->'learnerSupport'->>'templateDensity' AS template_density,
            COALESCE(cm.analysis->'scaffoldContext'->'learnerSupport'->'textbookSources', cm.analysis->'textbookSources')::text AS textbook_sources
        FROM chat_messages cm
        JOIN users u ON u.id = cm.user_id
        ORDER BY cm.timestamp DESC
        LIMIT 50000
    """)
    result = await db.execute(sql)
    rows = []
    for r in result:
        row = dict(r._mapping)
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"conversation_data_{date_str}.csv")


@router.get("/export/csv/knowledge-graph", dependencies=[Depends(verify_admin_key)])
async def export_knowledge_graph(db: AsyncSession = Depends(get_db)):
    """
    导出知识图谱节点数据集（CSV）

    社科研究维度：
    - 用户-概念交互记录（概念掌握度、交互频次）
    - 自我评估校准记录（AI评估 vs 用户自评，差异指数）
    - 知识领域分布（category）
    - 是否被质疑标记（isFlagged）
    """
    sql = text("""
        SELECT
            u.id                                AS user_id,
            u.student_id                        AS student_id,
            u.name                              AS user_name,
            u.email                             AS user_email,
            -- 通过 Neo4j 无法直接 JOIN，改为导出 profile_snapshots 中的校准日志
            ps.cognition                        AS snapshot_cognition,
            ps.affect                           AS snapshot_affect,
            ps.behavior                         AS snapshot_behavior,
            ps.created_at                       AS snapshot_time,
            ps.source                           AS snapshot_source
        FROM profile_snapshots ps
        JOIN users u ON u.id = ps.user_id
        ORDER BY ps.created_at DESC
    """)
    result = await db.execute(sql)
    rows = []
    for r in result:
        row = dict(r._mapping)
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"learning_trajectory_{date_str}.csv")


@router.get("/export/csv/user/{user_id}", dependencies=[Depends(verify_admin_key)])
async def export_single_user(user_id: str, db: AsyncSession = Depends(get_db)):
    """单个用户的完整对话数据导出（消息记录 + 画像快照，统一列结构）"""
    # 1. 获取用户基本信息
    user_sql = text("SELECT id, student_id, email, name, created_at FROM users WHERE id = :uid")
    user_result = await db.execute(user_sql, {"uid": user_id})
    user_row = user_result.mappings().first()
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found")

    email = user_row["email"]
    name = user_row["name"] or ""
    student_id = user_row["student_id"] or ""

    # 2. 获取对话消息（含完整文本）
    msg_sql = text("""
        SELECT
            cm.id                                                           AS message_id,
            cm.role                                                         AS role,
            cm.text                                                         AS message_text,
            cm.timestamp                                                    AS message_time,
            LENGTH(cm.text)                                                 AS message_length_chars,
            EXTRACT(HOUR FROM cm.timestamp)::int                            AS hour_of_day,
            EXTRACT(DOW FROM cm.timestamp)::int                             AS day_of_week,
            cm.analysis->>'detectedConcepts'                                AS concepts_raw,
            COALESCE(jsonb_array_length(cm.analysis->'detectedConcepts'), 0) AS concept_count,
            cm.analysis->'scaffoldContext'->>'requestId'                     AS scaffold_request_id,
            cm.analysis->'scaffoldContext'->>'taskId'                        AS scaffold_task_id,
            cm.analysis->'scaffoldContext'->>'stage'                         AS scaffold_stage,
            cm.analysis->'scaffoldContext'->>'requestedLevel'                AS scaffold_requested_level,
            cm.analysis->'scaffoldContext'->>'level'                         AS scaffold_level,
            cm.analysis->'scaffoldContext'->>'levelLabel'                    AS scaffold_level_label,
            cm.analysis->'scaffoldContext'->>'trigger'                       AS scaffold_trigger,
            cm.analysis->'scaffoldContext'->>'blueprintVersionId'            AS scaffold_blueprint_version_id,
            cm.analysis->'scaffoldContext'->>'policySource'                  AS scaffold_policy_source,
            cm.analysis->'scaffoldContext'->>'policyGoal'                    AS scaffold_policy_goal,
            cm.analysis->'scaffoldContext'->>'policyAllowedHelp'             AS scaffold_policy_allowed_help,
            cm.analysis->'scaffoldContext'->>'policyMaxCodeLines'            AS scaffold_policy_max_code_lines,
            cm.analysis->'scaffoldContext'->>'policyWasClamped'              AS scaffold_policy_was_clamped,
            cm.analysis->'scaffoldContext'->>'requireAttemptBeforeUpgrade'   AS scaffold_require_attempt,
            cm.analysis->'scaffoldContext'->>'artifactSummary'               AS scaffold_artifact_summary,
            cm.analysis->'scaffoldContext'->>'currentModule'                 AS scaffold_current_module,
            cm.analysis->'scaffoldContext'->>'testFeedback'                  AS scaffold_test_feedback,
            cm.analysis->'scaffoldContext'->>'codeLength'                    AS scaffold_code_length,
            cm.analysis->'scaffoldContext'->>'codeFingerprint'               AS scaffold_code_fingerprint,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'cognition'  AS scaffold_profile_cognition,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'affect'     AS scaffold_profile_affect,
            cm.analysis->'scaffoldContext'->'profileSnapshot'->>'behavior'   AS scaffold_profile_behavior,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'cognitionBand' AS scaffold_cognition_band,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'affectBand'    AS scaffold_affect_band,
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'behaviorBand'  AS scaffold_behavior_band,
            cm.analysis->'scaffoldContext'->'learnerSupport'->>'contextVersion' AS learner_support_version,
            cm.analysis->'scaffoldContext'->'learnerSupport'->>'templateDensity' AS template_density,
            COALESCE(cm.analysis->'scaffoldContext'->'learnerSupport'->'textbookSources', cm.analysis->'textbookSources')::text AS textbook_sources
        FROM chat_messages cm
        WHERE cm.user_id = :uid
        ORDER BY cm.timestamp ASC
    """)
    msg_result = await db.execute(msg_sql, {"uid": user_id})

    rows = []
    for r in msg_result:
        row = dict(r._mapping)
        row["user_id"] = user_id
        row["student_id"] = student_id
        row["user_email"] = email
        row["user_name"] = name
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)

    # 3. 如果没有对话数据，仍返回带表头的空 CSV
    if not rows:
        fieldnames = [
            "message_id", "user_id", "student_id", "user_email", "user_name",
            "role", "message_text", "message_time",
            "message_length_chars", "hour_of_day", "day_of_week",
            "concepts_raw", "concept_count",
            "scaffold_request_id", "scaffold_task_id", "scaffold_stage",
            "scaffold_requested_level", "scaffold_level", "scaffold_level_label", "scaffold_trigger",
            "scaffold_blueprint_version_id", "scaffold_policy_source", "scaffold_policy_goal",
            "scaffold_policy_allowed_help", "scaffold_policy_max_code_lines",
            "scaffold_policy_was_clamped", "scaffold_require_attempt",
            "scaffold_artifact_summary", "scaffold_current_module", "scaffold_test_feedback",
            "scaffold_code_length", "scaffold_code_fingerprint", "scaffold_profile_cognition", "scaffold_profile_affect",
            "scaffold_profile_behavior", "scaffold_cognition_band", "scaffold_affect_band",
            "scaffold_behavior_band", "learner_support_version", "template_density", "textbook_sources"
        ]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        output.seek(0)
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f'attachment; filename="user_{user_id[:8]}_conversations_{date_str}.csv"'}
        )

    # 统一列顺序
    ordered_fieldnames = [
        "message_id", "user_id", "student_id", "user_email", "user_name",
        "role", "message_text", "message_time",
        "message_length_chars", "hour_of_day", "day_of_week",
        "concepts_raw", "concept_count",
        "scaffold_request_id", "scaffold_task_id", "scaffold_stage",
        "scaffold_requested_level", "scaffold_level", "scaffold_level_label", "scaffold_trigger",
        "scaffold_blueprint_version_id", "scaffold_policy_source", "scaffold_policy_goal",
        "scaffold_policy_allowed_help", "scaffold_policy_max_code_lines",
        "scaffold_policy_was_clamped", "scaffold_require_attempt",
        "scaffold_artifact_summary", "scaffold_current_module", "scaffold_test_feedback",
        "scaffold_code_length", "scaffold_code_fingerprint", "scaffold_profile_cognition", "scaffold_profile_affect",
        "scaffold_profile_behavior", "scaffold_cognition_band", "scaffold_affect_band",
        "scaffold_behavior_band", "learner_support_version", "template_density", "textbook_sources"
    ]
    # 过滤 rows 只保留已知列
    rows_clean = [{k: row.get(k, "") for k in ordered_fieldnames} for row in rows]

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows_clean, f"user_{user_id[:8]}_conversations_{date_str}.csv")


@router.get("/export/csv/user/{user_id}/trajectory", dependencies=[Depends(verify_admin_key)])
async def export_user_trajectory(user_id: str, db: AsyncSession = Depends(get_db)):
    """单个用户的学习轨迹导出（画像快照时间序列 + 校准日志）"""
    # 画像快照
    snap_sql = text("""
        SELECT
            u.student_id            AS student_id,
            u.email                 AS user_email,
            u.name                  AS user_name,
            ps.created_at           AS snapshot_time,
            ps.source               AS source,
            ps.cognition            AS cognition,
            ps.affect               AS affect,
            ps.behavior             AS behavior
        FROM profile_snapshots ps
        JOIN users u ON u.id = ps.user_id
        WHERE ps.user_id = :uid
        ORDER BY ps.created_at ASC
    """)
    snap_result = await db.execute(snap_sql, {"uid": user_id})

    # 校准日志
    calib_sql = text("""
        SELECT
            cl.timestamp            AS log_time,
            cl.dimension            AS dimension,
            cl.system_value         AS ai_value,
            cl.user_value           AS user_value,
            (cl.user_value - cl.system_value) AS delta,
            cl.conflict_level       AS conflict_level,
            cl.user_comment         AS user_comment,
            cl.likert_trust         AS likert_trust
        FROM calibration_logs cl
        WHERE cl.user_id = :uid
        ORDER BY cl.timestamp ASC
    """)
    calib_result = await db.execute(calib_sql, {"uid": user_id})

    rows = []
    for r in snap_result:
        row = dict(r._mapping)
        row["record_type"] = "profile_snapshot"
        row["dimension"] = ""
        row["ai_value"] = ""
        row["user_value_calib"] = ""
        row["delta"] = ""
        row["conflict_level"] = ""
        row["user_comment"] = ""
        row["likert_trust"] = ""
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)

    for r in calib_result:
        row = dict(r._mapping)
        row["record_type"] = "calibration"
        row["snapshot_time"] = row.pop("log_time", "")
        row["source"] = "user_calibration"
        row["student_id"] = ""
        row["user_email"] = ""
        row["user_name"] = ""
        row["cognition"] = ""
        row["affect"] = ""
        row["behavior"] = ""
        row["user_value_calib"] = row.pop("user_value", "")
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)

    ordered = [
        "record_type", "snapshot_time", "source",
        "student_id", "user_email", "user_name",
        "cognition", "affect", "behavior",
        "dimension", "ai_value", "user_value_calib", "delta",
        "conflict_level", "user_comment", "likert_trust",
    ]
    rows_clean = [{k: row.get(k, "") for k in ordered} for row in rows]
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows_clean, f"user_{user_id[:8]}_trajectory_{date_str}.csv")


# 路径刻意与不带参数的 /export/csv/scale-responses 并存：后者按 user_ids 横切
# 所有量表，这里按单个量表纵切所有作答者，两种取数方向研究中都会用到。
@router.get("/export/csv/scale-responses/{scale_id}", dependencies=[Depends(verify_admin_key)])
async def export_single_scale_responses(scale_id: str, db: AsyncSession = Depends(get_db)):
    """单个量表的所有用户填写数据（含 user_email + 各题得分展开）"""
    sql = text("""
        SELECT
            sr.id                                       AS response_id,
            u.id                                        AS user_id,
            u.student_id                                AS student_id,
            u.name                                      AS user_name,
            u.email                                     AS user_email,
            sr.created_at                               AS responded_at,
            sr.answers_json                             AS raw_answers,
            (sr.scores_json->>'cognition')::float       AS cognition_score,
            (sr.scores_json->>'affect')::float          AS affect_score,
            (sr.scores_json->>'behavior')::float        AS behavior_score,
            (sr.scores_json->>'total_score')::float     AS total_score,
            (sr.scores_json->>'max_score')::float       AS max_score
        FROM scale_responses sr
        JOIN users u ON u.id = sr.user_id
        WHERE sr.template_id = :tid
        ORDER BY sr.created_at DESC
    """)
    result = await db.execute(sql, {"tid": scale_id})
    rows = []
    for r in result:
        row = dict(r._mapping)
        raw = row.pop("raw_answers", {}) or {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}
        for item_key, item_val in sorted(raw.items()):
            row[item_key] = item_val
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"scale_{scale_id[:8]}_responses_{date_str}.csv")


def _normalize_export_row(row: dict) -> dict:
    for key, value in row.items():
        if isinstance(value, datetime):
            row[key] = value.isoformat()
        elif value is None:
            row[key] = ""
    return row


def _summarize_change(previous: Optional[dict], current: Optional[dict]) -> str:
    """在导出时计算相邻版本的字段级差异。

    版本表保存的是每个产物的完整快照（便于任意时点还原），差异不作为独立数据源
    存储，而是在这里按需计算，避免"增量 diff 是唯一真相"带来的还原风险。
    """
    if not isinstance(current, dict):
        return ""
    if not isinstance(previous, dict):
        return "created"

    changed: list[str] = []
    for key in sorted(set(previous) | set(current)):
        before = previous.get(key)
        after = current.get(key)
        if before == after:
            continue
        if key not in previous:
            changed.append(f"+{key}")
        elif key not in current:
            changed.append(f"-{key}")
        else:
            changed.append(key)
    return "|".join(changed)


@router.get("/export/csv/artifact-versions", dependencies=[Depends(verify_admin_key)])
async def export_artifact_versions(
    db: AsyncSession = Depends(get_db),
    task_id: Optional[str] = Query(None, description="限定研究任务 UUID"),
):
    """导出阶段产物的修订链（CSV）。

    每行是一个产物版本，附带与上一版本的字段级差异摘要。可用于分析
    "学生的某张功能卡改了几次、每次改了什么、因何而改"。
    """
    where_clause = ""
    params: dict = {}
    if task_id:
        try:
            params["task_id"] = str(uuid.UUID(task_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid task_id") from exc
        where_clause = "WHERE sa.task_id = CAST(:task_id AS uuid)"

    sql = text(f"""
        SELECT
            u.student_id            AS student_id,
            u.name                  AS user_name,
            u.experiment_group      AS experiment_group,
            rt.title                AS task_title,
            sa.stage                AS stage,
            sa.artifact_type        AS artifact_type,
            sa.artifact_key         AS artifact_key,
            av.version              AS version,
            av.change_source        AS change_source,
            av.change_reason        AS change_reason,
            av.content              AS content,
            av.content_hash         AS content_hash,
            av.created_at           AS created_at,
            sa.blueprint_version_id AS blueprint_version_id,
            prev.content            AS previous_content
        FROM artifact_versions av
        JOIN stage_artifacts sa ON sa.id = av.artifact_id
        JOIN users u ON u.id = sa.user_id
        JOIN research_tasks rt ON rt.id = sa.task_id
        LEFT JOIN artifact_versions prev ON prev.id = av.previous_version_id
        {where_clause}
        ORDER BY u.student_id, sa.artifact_type, sa.artifact_key, av.version
    """)

    result = await db.execute(sql, params)
    rows = []
    for record in result:
        row = dict(record._mapping)
        previous = row.pop("previous_content", None)
        content = row.get("content")
        row["changed_fields"] = _summarize_change(previous, content)
        row["content"] = json.dumps(content, ensure_ascii=False) if content is not None else ""
        rows.append(_normalize_export_row(row))

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"artifact_versions_{date_str}.csv")


@router.get("/export/csv/stage-events", dependencies=[Depends(verify_admin_key)])
async def export_stage_events(
    db: AsyncSession = Depends(get_db),
    task_id: Optional[str] = Query(None, description="限定研究任务 UUID"),
):
    """导出关键教学事件时间线（CSV）。

    只包含阶段确认、结构修改、模块测试、主动求助和最终提交；不含拖拽坐标与游戏帧。

    一次事件可能同时涉及多个产物（例如一次阶段确认里同时确认了功能卡、关系图和
    路径），因此按 ``stage_event_artifacts`` 关联表展开：**一个产物一行**，
    同一事件的多行共享 ``event_id`` 与 ``request_id``，可据此重新聚合。
    没有关联任何产物的事件（如纯粹的求助）仍输出一行，产物列为空。
    """
    where_clause = ""
    params: dict = {}
    if task_id:
        try:
            params["task_id"] = str(uuid.UUID(task_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid task_id") from exc
        where_clause = "WHERE se.task_id = CAST(:task_id AS uuid)"

    sql = text(f"""
        SELECT
            u.student_id             AS student_id,
            u.name                   AS user_name,
            u.experiment_group       AS experiment_group,
            rt.title                 AS task_title,
            se.id                    AS event_id,
            se.request_id            AS request_id,
            se.stage                 AS stage,
            se.event_type            AS event_type,
            sea.position             AS artifact_position,
            sa.artifact_type         AS artifact_type,
            sa.artifact_key          AS artifact_key,
            av.version               AS artifact_version,
            sea.version_created      AS artifact_version_created,
            se.detail                AS detail,
            se.blueprint_version_id  AS blueprint_version_id,
            se.created_at            AS created_at
        FROM stage_events se
        JOIN users u ON u.id = se.user_id
        JOIN research_tasks rt ON rt.id = se.task_id
        LEFT JOIN stage_event_artifacts sea ON sea.event_id = se.id
        LEFT JOIN stage_artifacts sa ON sa.id = sea.artifact_id
        LEFT JOIN artifact_versions av ON av.id = sea.artifact_version_id
        {where_clause}
        ORDER BY u.student_id, se.created_at, sea.position
    """)

    result = await db.execute(sql, params)
    rows = []
    for record in result:
        row = dict(record._mapping)
        detail = row.get("detail")
        row["detail"] = json.dumps(detail, ensure_ascii=False) if detail else ""
        rows.append(_normalize_export_row(row))

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"stage_events_{date_str}.csv")


@router.get("/export/csv/scaffold-events", dependencies=[Depends(verify_admin_key)])
async def export_scaffold_events(
    db: AsyncSession = Depends(get_db),
    task_id: Optional[str] = Query(None, description="限定研究任务 UUID"),
):
    """导出 L0–L3 支架事件（CSV）。

    数据源为 ``scaffold_events`` 规范表，并关联 ``chat_messages`` 输出学生提问
    原文与 AI 建议原文——只有消息 ID 无法回答「AI 到底给了什么建议、学生当时问的
    是什么」，而这正是支架依赖分析的核心材料。文本不在 ``scaffold_events`` 里
    重复存储，``chat_messages`` 仍是原文的唯一来源；被引用的会话已禁止物理删除，
    因此这条关联不会断。

    ``adopted`` 列在任务 5 建立「求助—建议—采用—修改—结果」链路前保持为空，
    不依据不完整字段推测学生是否采用了建议。既有的对话 CSV 仍从
    ``chat_messages.analysis`` 导出，两者当前并存。

    本表只记录**成功送达**的建议。学生发起求助但 AI 失败的情况不会出现在这里，
    而是记录在 stage-events 的 ``help_request`` 中；分析支架依赖时应同时读取两者。

    注意：导出内容包含学生原始提问，属于可识别的过程数据，对外共享前需按研究
    伦理要求脱敏。
    """
    where_clause = ""
    params: dict = {}
    if task_id:
        try:
            params["task_id"] = str(uuid.UUID(task_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid task_id") from exc
        where_clause = "WHERE sc.task_id = CAST(:task_id AS uuid)"

    sql = text(f"""
        SELECT
            u.student_id            AS student_id,
            u.name                  AS user_name,
            u.experiment_group      AS experiment_group,
            sc.user_id              AS user_id,
            sc.task_id              AS task_id,
            rt.title                AS task_title,
            sc.stage                AS stage,
            sc.trigger              AS trigger,
            sc.requested_level      AS requested_level,
            sc.applied_level        AS applied_level,
            sc.was_clamped          AS was_clamped,
            sc.delivery_status      AS delivery_status,
            sc.policy_source        AS policy_source,
            sc.policy_max_code_lines AS policy_max_code_lines,
            sc.current_module       AS current_module,
            sc.profile_cognition    AS profile_cognition,
            sc.profile_affect       AS profile_affect,
            sc.profile_behavior     AS profile_behavior,
            sc.code_length          AS code_length,
            sc.code_fingerprint     AS code_fingerprint,
            sc.adopted              AS adopted,
            sc.blueprint_version_id AS blueprint_version_id,
            sc.request_id           AS request_id,
            sc.student_message_id   AS student_message_id,
            sc.assistant_message_id AS assistant_message_id,
            sm.text                 AS student_message_text,
            am.text                 AS assistant_suggestion_text,
            sc.created_at           AS created_at
        FROM scaffold_events sc
        JOIN users u ON u.id = sc.user_id
        LEFT JOIN research_tasks rt ON rt.id = sc.task_id
        LEFT JOIN chat_messages sm ON sm.id = sc.student_message_id
        LEFT JOIN chat_messages am ON am.id = sc.assistant_message_id
        {where_clause}
        ORDER BY u.student_id, sc.created_at
    """)

    result = await db.execute(sql, params)
    rows = [_normalize_export_row(dict(record._mapping)) for record in result]

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"scaffold_events_{date_str}.csv")
