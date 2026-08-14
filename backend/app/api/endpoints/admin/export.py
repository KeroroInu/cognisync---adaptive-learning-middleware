"""
Admin 数据导出 API 端点
"""
import csv
import io
import json
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timezone

from app.core.security import verify_admin_key
from app.db.postgres import get_db

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
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
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
            cm.analysis->'scaffoldContext'->>'level'              AS scaffold_level,
            cm.analysis->'scaffoldContext'->>'levelLabel'         AS scaffold_level_label,
            cm.analysis->'scaffoldContext'->>'trigger'            AS scaffold_trigger,
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
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'behaviorBand'  AS scaffold_behavior_band
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
            cm.analysis->'scaffoldContext'->>'level'                         AS scaffold_level,
            cm.analysis->'scaffoldContext'->>'levelLabel'                    AS scaffold_level_label,
            cm.analysis->'scaffoldContext'->>'trigger'                       AS scaffold_trigger,
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
            cm.analysis->'scaffoldContext'->'profileAdaptation'->>'behaviorBand'  AS scaffold_behavior_band
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
            "scaffold_level", "scaffold_level_label", "scaffold_trigger",
            "scaffold_artifact_summary", "scaffold_current_module", "scaffold_test_feedback",
            "scaffold_code_length", "scaffold_code_fingerprint", "scaffold_profile_cognition", "scaffold_profile_affect",
            "scaffold_profile_behavior", "scaffold_cognition_band", "scaffold_affect_band",
            "scaffold_behavior_band"
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
        "scaffold_level", "scaffold_level_label", "scaffold_trigger",
        "scaffold_artifact_summary", "scaffold_current_module", "scaffold_test_feedback",
        "scaffold_code_length", "scaffold_code_fingerprint", "scaffold_profile_cognition", "scaffold_profile_affect",
        "scaffold_profile_behavior", "scaffold_cognition_band", "scaffold_affect_band",
        "scaffold_behavior_band"
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
