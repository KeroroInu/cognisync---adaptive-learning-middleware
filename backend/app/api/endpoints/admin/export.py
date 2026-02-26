"""
Admin 数据导出 API 端点
"""
import csv
import io
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import json
from datetime import datetime

from app.core.security import verify_admin_key
from app.db.postgres import get_db

router = APIRouter(tags=["Admin - Data Export"])

# 白名单：允许导出的表
ALLOWED_TABLES = ["users", "chat_messages", "chat_sessions", "profile_snapshots",
                  "calibration_logs", "scale_templates", "scale_responses", "onboarding_sessions"]

# 敏感字段黑名单
SENSITIVE_FIELDS = ["hashed_password", "password", "token", "api_key", "secret", "refresh_token"]


def validate_column_name(column_name: str, table_name: str) -> bool:
    """验证列名是否安全（仅包含字母、数字、下划线）"""
    if not column_name:
        return False
    return column_name.replace("_", "").isalnum()


def build_filter_clause(filters_json: Optional[str], table_name: str) -> tuple[str, dict]:
    """
    构建过滤 WHERE 子句

    支持的过滤格式：
    {
        "email": {"op": "eq", "value": "test@example.com"},
        "created_at": {"op": "gte", "value": "2024-01-01"}
    }

    支持的操作符：eq, ne, gt, gte, lt, lte, like
    """
    if not filters_json:
        return "", {}

    try:
        filters = json.loads(filters_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in filters")

    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="Filters must be a JSON object")

    conditions = []
    params = {}

    for i, (column, filter_spec) in enumerate(filters.items()):
        # 验证列名
        if not validate_column_name(column, table_name):
            raise HTTPException(status_code=400, detail=f"Invalid column name: {column}")

        # 跳过敏感字段
        if column in SENSITIVE_FIELDS:
            continue

        if not isinstance(filter_spec, dict) or "op" not in filter_spec or "value" not in filter_spec:
            raise HTTPException(status_code=400, detail=f"Invalid filter spec for column: {column}")

        op = filter_spec["op"]
        value = filter_spec["value"]
        param_name = f"filter_{i}"

        # 构建条件
        if op == "eq":
            conditions.append(f"{column} = :{param_name}")
            params[param_name] = value
        elif op == "ne":
            conditions.append(f"{column} != :{param_name}")
            params[param_name] = value
        elif op == "gt":
            conditions.append(f"{column} > :{param_name}")
            params[param_name] = value
        elif op == "gte":
            conditions.append(f"{column} >= :{param_name}")
            params[param_name] = value
        elif op == "lt":
            conditions.append(f"{column} < :{param_name}")
            params[param_name] = value
        elif op == "lte":
            conditions.append(f"{column} <= :{param_name}")
            params[param_name] = value
        elif op == "like":
            conditions.append(f"{column} ILIKE :{param_name}")
            params[param_name] = f"%{value}%"
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported operator: {op}")

    if conditions:
        return "WHERE " + " AND ".join(conditions), params
    return "", {}


@router.get("/db/export", dependencies=[Depends(verify_admin_key)])
async def export_table_data(
    table: str = Query(..., description="表名"),
    format: str = Query("json", description="导出格式（仅支持 json）"),
    filters: Optional[str] = Query(None, description="过滤条件（JSON）"),
    order_by: Optional[str] = Query(None, description="排序字段"),
    order: str = Query("desc", description="排序方向：asc | desc"),
    db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """
    导出表数据

    支持过滤和排序

    Args:
        table: 表名（必须在白名单中）
        format: 导出格式（目前仅支持 json）
        filters: 过滤条件 JSON
        order_by: 排序字段
        order: 排序方向

    Returns:
        JSON 格式的数据

    Examples:
        /api/admin/db/export?table=users&filters={"email":{"op":"like","value":"test"}}
        /api/admin/db/export?table=chat_messages&filters={"created_at":{"op":"gte","value":"2024-01-01"}}&order_by=created_at&order=desc
    """
    # 验证表名
    if table not in ALLOWED_TABLES:
        raise HTTPException(
            status_code=403,
            detail=f"Table '{table}' is not allowed for export"
        )

    if format != "json":
        raise HTTPException(status_code=400, detail="Only 'json' format is supported")

    # 构建过滤条件
    filter_clause, filter_params = build_filter_clause(filters, table)

    # 构建排序
    order_clause = ""
    if order_by:
        if not validate_column_name(order_by, table):
            raise HTTPException(status_code=400, detail=f"Invalid order_by column: {order_by}")
        if order_by not in SENSITIVE_FIELDS:
            direction = "ASC" if order.lower() == "asc" else "DESC"
            order_clause = f"ORDER BY {order_by} {direction}"

    # 构建查询
    query = f"SELECT * FROM {table} {filter_clause} {order_clause}"

    # 执行查询
    result = await db.execute(text(query), filter_params)
    rows = [dict(row._mapping) for row in result]

    # 过滤敏感字段并转换为可序列化格式
    rows_filtered = [
        {
            k: (v.isoformat() if isinstance(v, datetime) else str(v) if not isinstance(v, (int, float, bool, type(None), dict, list)) else v)
            for k, v in row.items()
            if k not in SENSITIVE_FIELDS
        }
        for row in rows
    ]

    return JSONResponse(content={
        "table": table,
        "filters": filters,
        "order_by": order_by,
        "order": order,
        "rowCount": len(rows_filtered),
        "data": rows_filtered,
        "exported_at": datetime.utcnow().isoformat()
    })


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
async def export_learner_profiles(db: AsyncSession = Depends(get_db)):
    """
    导出学习者画像综合数据集（CSV）

    社科研究维度：
    - 学习者基础信息（匿名 ID、注册时间）
    - 初始量表得分（认知/情感/行为三维度）
    - 最新画像得分及变化次数
    - 对话参与行为指标（会话数、消息数）
    """
    sql = text("""
        SELECT
            u.id                                                AS user_id,
            u.email                                             AS email,
            u.name                                              AS name,
            u.created_at                                        AS registered_at,
            u.is_active                                         AS is_active,
            -- 最初画像（第一条 profile_snapshot）
            first_ps.cognition                                  AS initial_cognition,
            first_ps.affect                                     AS initial_affect,
            first_ps.behavior                                   AS initial_behavior,
            first_ps.created_at                                 AS initial_profile_at,
            -- 最新画像（最后一条 profile_snapshot）
            last_ps.cognition                                   AS current_cognition,
            last_ps.affect                                      AS current_affect,
            last_ps.behavior                                    AS current_behavior,
            last_ps.created_at                                  AS last_profile_update,
            -- 画像更新次数
            COALESCE(ps_count.total, 0)                         AS profile_update_count,
            -- 对话行为
            COALESCE(sess_count.total, 0)                       AS total_sessions,
            COALESCE(msg_count.total, 0)                        AS total_messages,
            -- 量表填写次数
            COALESCE(sr_count.total, 0)                         AS scale_completions
        FROM users u
        -- 最初画像
        LEFT JOIN LATERAL (
            SELECT cognition, affect, behavior, created_at
            FROM profile_snapshots
            WHERE user_id = u.id
            ORDER BY created_at ASC LIMIT 1
        ) first_ps ON TRUE
        -- 最新画像
        LEFT JOIN LATERAL (
            SELECT cognition, affect, behavior, created_at
            FROM profile_snapshots
            WHERE user_id = u.id
            ORDER BY created_at DESC LIMIT 1
        ) last_ps ON TRUE
        -- 画像更新次数
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS total
            FROM profile_snapshots GROUP BY user_id
        ) ps_count ON ps_count.user_id = u.id
        -- 会话数
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS total
            FROM chat_sessions GROUP BY user_id
        ) sess_count ON sess_count.user_id = u.id
        -- 消息数
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS total
            FROM chat_messages GROUP BY user_id
        ) msg_count ON msg_count.user_id = u.id
        -- 量表完成次数
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS total
            FROM scale_responses GROUP BY user_id
        ) sr_count ON sr_count.user_id = u.id
        ORDER BY u.created_at DESC
    """)
    result = await db.execute(sql)
    rows = [dict(r._mapping) for r in result]
    # 序列化
    for row in rows:
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"learner_profiles_{date_str}.csv")


@router.get("/export/csv/scale-responses", dependencies=[Depends(verify_admin_key)])
async def export_scale_responses(db: AsyncSession = Depends(get_db)):
    """
    导出量表响应数据集（CSV）

    社科研究维度：
    - 用户-量表匹配信息
    - 各题原始得分（item_1 ~ item_N）
    - 三维度汇总得分（认知/情感/行为）
    - 填写时间（可用于分析量表完成时机）
    """
    sql = text("""
        SELECT
            sr.id                               AS response_id,
            u.id                                AS user_id,
            u.email                             AS user_email,
            st.name                             AS scale_name,
            st.id                               AS template_id,
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
        ORDER BY sr.created_at DESC
    """)
    result = await db.execute(sql)
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
        for k, v in row.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
        rows.append(row)
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
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
    """
    sql = text("""
        SELECT
            cm.id                               AS message_id,
            u.id                                AS user_id,
            u.email                             AS user_email,
            cm.role                             AS role,
            cm.timestamp                        AS message_time,
            EXTRACT(HOUR FROM cm.timestamp)::int AS hour_of_day,
            EXTRACT(DOW FROM cm.timestamp)::int  AS day_of_week,
            LENGTH(cm.text)                     AS message_length_chars,
            cm.analysis->>'detectedConcepts'    AS extracted_concepts_raw,
            COALESCE(jsonb_array_length(cm.analysis->'detectedConcepts'), 0) AS concept_count
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
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
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
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"learning_trajectory_{date_str}.csv")


@router.get("/export/csv/user/{user_id}", dependencies=[Depends(verify_admin_key)])
async def export_single_user(user_id: str, db: AsyncSession = Depends(get_db)):
    """单个用户的完整对话数据导出（消息记录 + 画像快照，统一列结构）"""
    # 1. 获取用户基本信息
    user_sql = text("SELECT id, email, name, created_at FROM users WHERE id = :uid")
    user_result = await db.execute(user_sql, {"uid": user_id})
    user_row = user_result.mappings().first()
    if not user_row:
        raise HTTPException(status_code=404, detail="User not found")

    email = user_row["email"]
    name = user_row["name"] or ""

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
            COALESCE(jsonb_array_length(cm.analysis->'detectedConcepts'), 0) AS concept_count
        FROM chat_messages cm
        WHERE cm.user_id = :uid
        ORDER BY cm.timestamp ASC
    """)
    msg_result = await db.execute(msg_sql, {"uid": user_id})

    rows = []
    for r in msg_result:
        row = dict(r._mapping)
        row["user_id"] = user_id
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
            "message_id", "user_id", "user_email", "user_name",
            "role", "message_text", "message_time",
            "message_length_chars", "hour_of_day", "day_of_week",
            "concepts_raw", "concept_count"
        ]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        output.seek(0)
        date_str = datetime.utcnow().strftime("%Y-%m-%d")
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": f'attachment; filename="user_{user_id[:8]}_conversations_{date_str}.csv"'}
        )

    # 统一列顺序
    ordered_fieldnames = [
        "message_id", "user_id", "user_email", "user_name",
        "role", "message_text", "message_time",
        "message_length_chars", "hour_of_day", "day_of_week",
        "concepts_raw", "concept_count"
    ]
    # 过滤 rows 只保留已知列
    rows_clean = [{k: row.get(k, "") for k in ordered_fieldnames} for row in rows]

    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return _make_csv_response(rows_clean, f"user_{user_id[:8]}_conversations_{date_str}.csv")


@router.get("/export/csv/user/{user_id}/trajectory", dependencies=[Depends(verify_admin_key)])
async def export_user_trajectory(user_id: str, db: AsyncSession = Depends(get_db)):
    """单个用户的学习轨迹导出（画像快照时间序列 + 校准日志）"""
    # 画像快照
    snap_sql = text("""
        SELECT
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
        "user_email", "user_name",
        "cognition", "affect", "behavior",
        "dimension", "ai_value", "user_value_calib", "delta",
        "conflict_level", "user_comment", "likert_trust",
    ]
    rows_clean = [{k: row.get(k, "") for k in ordered} for row in rows]
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return _make_csv_response(rows_clean, f"user_{user_id[:8]}_trajectory_{date_str}.csv")
async def export_single_scale_responses(scale_id: str, db: AsyncSession = Depends(get_db)):
    """单个量表的所有用户填写数据（含 user_email + 各题得分展开）"""
    sql = text("""
        SELECT
            sr.id                                       AS response_id,
            u.id                                        AS user_id,
            u.email                                     AS user_email,
            u.name                                      AS user_name,
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
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    return _make_csv_response(rows, f"scale_{scale_id[:8]}_responses_{date_str}.csv")
