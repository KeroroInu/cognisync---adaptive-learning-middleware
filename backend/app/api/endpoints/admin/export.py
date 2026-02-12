"""
Admin 数据导出 API 端点
"""
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse
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
